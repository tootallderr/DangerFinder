class GraphVisualizer {
    constructor() {
        this.svg = d3.select('#graph-svg');
        this.width = 0;
        this.height = 0;
        this.nodes = [];
        this.links = [];
        this.simulation = null;
        this.selectedNode = null;
        this.communities = [];
        this.colorScale = d3.scaleOrdinal(d3.schemeCategory10);
        
        this.init();
    }

    init() {
        this.setupDimensions();
        this.setupEventListeners();
        this.loadData();
        window.addEventListener('resize', () => this.setupDimensions());
    }

    setupDimensions() {
        const container = document.querySelector('.graph-container');
        this.width = container.clientWidth;
        this.height = container.clientHeight;
        
        this.svg
            .attr('width', this.width)
            .attr('height', this.height);
    }

    setupEventListeners() {
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadData());
        document.getElementById('export-btn').addEventListener('click', () => this.exportGraph());
        document.getElementById('fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('layout-select').addEventListener('change', (e) => this.changeLayout(e.target.value));
        document.getElementById('search-input').addEventListener('input', (e) => this.filterNodes(e.target.value));
        document.getElementById('connection-filter').addEventListener('input', (e) => this.filterByConnections(e.target.value));
    }

    async loadData() {
        this.showLoading(true);
        
        try {
            // Load graph data from backend
            const [graphResponse, statsResponse] = await Promise.all([
                fetch('http://localhost:3000/api/graph'),
                fetch('http://localhost:3000/api/stats')
            ]);

            if (!graphResponse.ok || !statsResponse.ok) {
                throw new Error('Failed to load data from backend');
            }

            const graphData = await graphResponse.json();
            const statsData = await statsResponse.json();

            this.processData(graphData, statsData);
            this.updateStatistics(statsData);
            this.createVisualization();
            
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load graph data. Make sure the backend server is running.');
        } finally {
            this.showLoading(false);
        }
    }

    processData(graphData, statsData) {
        // Process nodes
        this.nodes = Object.entries(graphData.nodes || {}).map(([id, data]) => ({
            id,
            name: data.name || id,
            url: data.url || '',
            profile_image: data.profile_image || '',
            depth: data.depth || 0,
            degree: (graphData.adjacency_list[id] || []).length,
            pagerank: data.pagerank || 0,
            betweenness: data.betweenness || 0,
            community: data.community || 0,
            x: Math.random() * this.width,
            y: Math.random() * this.height
        }));

        // Process links
        this.links = [];
        Object.entries(graphData.adjacency_list || {}).forEach(([source, targets]) => {
            targets.forEach(target => {
                if (this.nodes.find(n => n.id === source) && this.nodes.find(n => n.id === target)) {
                    this.links.push({ source, target });
                }
            });
        });

        // Process communities
        this.communities = statsData.communities || [];
        
        console.log(`Loaded ${this.nodes.length} nodes and ${this.links.length} links`);
    }

    createVisualization() {
        this.svg.selectAll('*').remove();

        // Create zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.svg.select('g').attr('transform', event.transform);
            });

        this.svg.call(zoom);

        // Create main group
        const g = this.svg.append('g');

        // Create simulation
        this.simulation = d3.forceSimulation(this.nodes)
            .force('link', d3.forceLink(this.links).id(d => d.id).distance(80))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(d => this.getNodeRadius(d) + 2));

        // Create links
        const link = g.append('g')
            .selectAll('line')
            .data(this.links)
            .join('line')
            .attr('stroke', '#999')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 2);        // Create defs for clipping paths
        const defs = this.svg.select('defs').empty() ? this.svg.append('defs') : this.svg.select('defs');

        // Create nodes
        const nodeGroup = g.append('g').attr('class', 'nodes');
        
        const node = nodeGroup
            .selectAll('g.node')
            .data(this.nodes)
            .join('g')
            .attr('class', 'node')
            .style('cursor', 'pointer')
            .call(this.drag(this.simulation));

        const self = this;

        // Add clipping circles for each node
        node.each(function(d) {
            const clipId = `clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
            defs.append('clipPath')
                .attr('id', clipId)
                .append('circle')
                .attr('r', self.getNodeRadius(d));
        });

        // Add profile images or fallback circles
        node.each(function(d) {
            const nodeEl = d3.select(this);
            const radius = self.getNodeRadius(d);
            const clipId = `clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')}`;

            if (d.profile_image && d.profile_image.trim() !== '') {
                // Add profile image
                nodeEl.append('image')
                    .attr('href', d.profile_image)
                    .attr('x', -radius)
                    .attr('y', -radius)
                    .attr('width', radius * 2)
                    .attr('height', radius * 2)
                    .attr('clip-path', `url(#${clipId})`)
                    .on('error', function() {
                        // Fallback to colored circle if image fails to load
                        d3.select(this).remove();
                        nodeEl.append('circle')
                            .attr('r', radius)
                            .attr('fill', self.getNodeColor(d))
                            .attr('stroke', '#fff')
                            .attr('stroke-width', 1.5);
                    });
                
                // Add border circle over the image
                nodeEl.append('circle')
                    .attr('r', radius)
                    .attr('fill', 'none')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1.5);
            } else {
                // Fallback to colored circle
                nodeEl.append('circle')
                    .attr('r', radius)
                    .attr('fill', self.getNodeColor(d))
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1.5);
            }
        });

        // Add node labels
        const labels = g.append('g')
            .selectAll('text')
            .data(this.nodes)
            .join('text')
            .text(d => d.name)
            .attr('font-size', 10)
            .attr('font-family', 'Arial, sans-serif')
            .attr('fill', 'white')
            .attr('text-anchor', 'middle')
            .attr('dy', '.35em')
            .style('pointer-events', 'none');        // Add tooltips and click handlers
        node
            .on('mouseover', (event, d) => this.showTooltip(event, d))
            .on('mouseout', () => this.hideTooltip())
            .on('click', (event, d) => this.selectNode(d));        // Update positions on simulation tick
        this.simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node
                .attr('transform', d => `translate(${d.x}, ${d.y})`);

            labels
                .attr('x', d => d.x)
                .attr('y', d => d.y);
        });

        this.updateCommunityList();
    }

    getNodeRadius(node) {
        // Size based on PageRank or degree
        const baseSize = 8;
        const scaleFactor = Math.sqrt(node.pagerank * 100) || Math.sqrt(node.degree);
        return Math.max(baseSize, Math.min(20, baseSize + scaleFactor * 2));
    }

    getNodeColor(node) {
        // Color by community if available, otherwise by depth
        if (node.community !== undefined) {
            return this.colorScale(node.community);
        }
        
        // Color by node importance
        if (node.pagerank > 0.01) return '#4ecdc4'; // High PageRank
        if (node.degree === 0) return '#e74c3c'; // Isolated
        if (node.betweenness > 0.01) return '#f39c12'; // Bridge node
        return '#45b7d1'; // Regular node
    }

    drag(simulation) {
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }

        return d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended);
    }

    showTooltip(event, node) {
        const tooltip = document.getElementById('tooltip');
        tooltip.innerHTML = `
            <strong>${node.name}</strong><br>
            Connections: ${node.degree}<br>
            PageRank: ${(node.pagerank * 100).toFixed(2)}%<br>
            Depth: ${node.depth}<br>
            Community: ${node.community || 'N/A'}
        `;
        
        tooltip.style.left = (event.pageX + 10) + 'px';
        tooltip.style.top = (event.pageY - 10) + 'px';
        tooltip.style.opacity = 1;
    }

    hideTooltip() {
        document.getElementById('tooltip').style.opacity = 0;
    }    selectNode(node) {
        this.selectedNode = node;
        this.updateNodeDetails(node);
        
        // Highlight selected node
        this.svg.selectAll('g.node circle')
            .attr('stroke-width', d => d === node ? 3 : 1.5)
            .attr('stroke', d => d === node ? '#ff6b6b' : '#fff');
    }

    updateNodeDetails(node) {
        const detailsDiv = document.getElementById('node-details');
        detailsDiv.innerHTML = `
            <div style="text-align: center;">
                ${node.profile_image ? `<img src="${node.profile_image}" alt="${node.name}">` : ''}
                <h4>${node.name}</h4>
                <p style="font-size: 11px; opacity: 0.8; margin: 5px 0;">${node.url}</p>
            </div>
            <div style="margin-top: 15px;">
                <div><strong>Connections:</strong> ${node.degree}</div>
                <div><strong>PageRank:</strong> ${(node.pagerank * 100).toFixed(3)}%</div>
                <div><strong>Betweenness:</strong> ${(node.betweenness * 100).toFixed(3)}%</div>
                <div><strong>Depth:</strong> ${node.depth}</div>
                <div><strong>Community:</strong> ${node.community || 'N/A'}</div>
            </div>
        `;
    }

    updateStatistics(stats) {
        document.getElementById('total-nodes').textContent = stats.total_profiles || 0;
        document.getElementById('total-edges').textContent = stats.total_connections || 0;
        document.getElementById('avg-degree').textContent = (stats.average_connections || 0).toFixed(1);
        document.getElementById('communities').textContent = (stats.communities || []).length;
    }

    updateCommunityList() {
        const listDiv = document.getElementById('community-list');
        
        if (!this.communities.length) {
            listDiv.innerHTML = '<div style="text-align: center; opacity: 0.6; font-size: 12px;">No communities detected</div>';
            return;
        }

        listDiv.innerHTML = this.communities.map((community, index) => `
            <div class="community-item" style="border-left: 4px solid ${this.colorScale(index)};">
                <strong>Community ${index + 1}</strong> (${community.members.length} members)<br>
                <small>${community.members.slice(0, 3).join(', ')}${community.members.length > 3 ? '...' : ''}</small>
            </div>
        `).join('');
    }

    changeLayout(layout) {
        if (!this.simulation) return;

        this.simulation.stop();

        switch (layout) {
            case 'circular':
                this.applyCircularLayout();
                break;
            case 'hierarchical':
                this.applyHierarchicalLayout();
                break;
            default:
                this.applyForceLayout();
        }
    }

    applyCircularLayout() {
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        const radius = Math.min(this.width, this.height) / 3;

        this.nodes.forEach((node, i) => {
            const angle = (2 * Math.PI * i) / this.nodes.length;
            node.fx = centerX + radius * Math.cos(angle);
            node.fy = centerY + radius * Math.sin(angle);
        });

        this.simulation.alpha(1).restart();
    }

    applyHierarchicalLayout() {
        const levels = {};
        this.nodes.forEach(node => {
            if (!levels[node.depth]) levels[node.depth] = [];
            levels[node.depth].push(node);
        });

        const maxDepth = Math.max(...Object.keys(levels).map(Number));
        const levelHeight = this.height / (maxDepth + 1);

        Object.entries(levels).forEach(([depth, nodes]) => {
            const levelWidth = this.width / (nodes.length + 1);
            nodes.forEach((node, i) => {
                node.fx = levelWidth * (i + 1);
                node.fy = levelHeight * (parseInt(depth) + 1);
            });
        });

        this.simulation.alpha(1).restart();
    }

    applyForceLayout() {
        this.nodes.forEach(node => {
            node.fx = null;
            node.fy = null;
        });
        this.simulation.alpha(1).restart();
    }    filterNodes(searchTerm) {
        const term = searchTerm.toLowerCase();
        
        this.svg.selectAll('g.node')
            .style('opacity', d => {
                return !term || d.name.toLowerCase().includes(term) ? 1 : 0.2;
            });

        this.svg.selectAll('text')
            .style('opacity', d => {
                return !term || d.name.toLowerCase().includes(term) ? 1 : 0.2;
            });
    }

    filterByConnections(minConnections) {
        document.getElementById('connection-value').textContent = minConnections;
        
        this.svg.selectAll('g.node')
            .style('opacity', d => d.degree >= minConnections ? 1 : 0.2);

        this.svg.selectAll('text')
            .style('opacity', d => d.degree >= minConnections ? 1 : 0.2);
    }

    exportGraph() {
        const graphData = {
            nodes: this.nodes,
            links: this.links,
            communities: this.communities,
            timestamp: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(graphData, null, 2)], {
            type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `facebook-graph-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
    }

    showError(message) {
        const loading = document.getElementById('loading');
        loading.innerHTML = `
            <div style="color: #e74c3c; text-align: center;">
                <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
                <div>${message}</div>
                <button class="btn" onclick="location.reload()" style="margin-top: 15px;">
                    🔄 Retry
                </button>
            </div>
        `;
    }
}

// Initialize visualizer when page loads
document.addEventListener('DOMContentLoaded', () => {
    new GraphVisualizer();
});

// Auto-refresh every 30 seconds
setInterval(() => {
    if (window.visualizer) {
        window.visualizer.loadData();
    }
}, 30000);
