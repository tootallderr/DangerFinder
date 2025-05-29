class GraphVisualizer {
    constructor() {
        this.svg = d3.select('#graph-svg');
        this.width = 0;
        this.height = 0;
        this.nodes = [];
        this.links = [];
        this.simulation = null;
        this.selectedNode = null;
        this.selectedNodes = new Set(); // For bulk selection
        this.communities = [];
        this.annotations = {}; // Store all annotation data
        this.demographicAnnotations = {}; // Store demographic classifications
        this.colorScale = d3.scaleOrdinal(d3.schemeCategory10);
        this.isMultiSelecting = false;
        this.dragStart = null;
          // New properties for alias and connection features
        this.similarNames = [];
        this.confirmedAliases = [];
        this.manualConnections = [];
        this.aliasConnections = []; // Specific connections between alias and real accounts
        this.highlightedAliases = new Set();
        this.isConnectionMode = false;
        this.isAliasConnectionMode = false; // New alias-specific connection mode
        this.selectedForConnection = null;
        this.selectedAliasAccount = null; // For alias connections
        this.selectedRealAccount = null; // For alias connections
        this.sharedFriendsAnalysis = []; // Store shared friends analysis
        this.currentSettings = {
            similarityThreshold: 0.7,
            autoDetectAliases: true,
            showSimilarNames: true,
            showManualConnections: true
        };
        
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
    }    setupEventListeners() {
        // Add error handling for missing elements
        const addListener = (id, event, handler) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener(event, handler);
            } else {
                console.warn(`Element with id '${id}' not found, skipping event listener`);
            }
        };

        // Basic controls
        addListener('refresh-btn', 'click', () => this.loadData());
        addListener('export-btn', 'click', () => this.exportGraph());
        addListener('fullscreen-btn', 'click', () => this.toggleFullscreen());
        addListener('layout-select', 'change', (e) => this.changeLayout(e.target.value));
        addListener('search-input', 'input', (e) => this.filterNodes(e.target.value));
        addListener('connection-filter', 'input', (e) => this.filterByConnections(e.target.value));
        
        // Auto-refresh toggle handler
        addListener('auto-refresh-btn', 'click', () => toggleAutoRefresh());
        
        // Multi-selection and bulk operation handlers
        addListener('multi-select-btn', 'click', () => this.toggleMultiSelect());
        addListener('mark-kids', 'click', () => this.markSelectedAs('kids'));
        addListener('mark-adult', 'click', () => this.markSelectedAs('adult'));
        addListener('mark-unknown', 'click', () => this.markSelectedAs('unknown'));
        addListener('clear-selection', 'click', () => this.clearSelection());
        addListener('select-all-visible', 'click', () => this.selectAllVisible());

        // Alias and connection feature handlers
        addListener('detect-aliases-btn', 'click', () => this.detectSimilarNames());
        addListener('similarity-threshold', 'input', (e) => this.updateThresholdDisplay(e.target.value));
        addListener('alias-threshold', 'input', (e) => this.updateThresholdDisplay(e.target.value));
        addListener('highlight-aliases', 'click', () => this.toggleAliasHighlights());

        // Connection mode handlers
        addListener('manual-connection-mode', 'click', () => this.toggleConnectionMode());
        addListener('alias-connection-mode', 'click', () => this.toggleAliasConnectionMode());
        addListener('analyze-shared-friends', 'click', () => this.analyzeSharedFriends());
        addListener('save-alias-settings', 'click', () => this.saveAliasSettings());
        addListener('load-alias-settings', 'click', () => this.loadAliasSettings());
        addListener('clear-highlights', 'click', () => this.clearAllHighlights());
        addListener('detect-similar-names', 'click', () => this.detectSimilarNames());
    }    async loadData() {
        this.showLoading(true);
        
        try {
            console.log('Starting data load...');
            
            // Load graph data and annotations from backend
            const [graphResponse, statsResponse, annotationsResponse] = await Promise.all([
                fetch('http://localhost:3000/api/graph'),
                fetch('http://localhost:3000/api/stats'),
                fetch('http://localhost:3000/api/annotations')
            ]);

            console.log('Responses received:', {
                graph: graphResponse.status,
                stats: statsResponse.status,
                annotations: annotationsResponse.status
            });

            if (!graphResponse.ok || !statsResponse.ok) {
                throw new Error('Failed to load data from backend');
            }

            const graphData = await graphResponse.json();
            const statsData = await statsResponse.json();
            
            console.log('Data parsed successfully:', {
                graphKeys: Object.keys(graphData),
                statsKeys: Object.keys(statsData),
                nodeCount: Object.keys(graphData.nodes || {}).length
            });
            
            // Load annotation data if available
            if (annotationsResponse.ok) {
                const annotationsData = await annotationsResponse.json();
                this.annotations = annotationsData.annotations || {};
                this.demographicAnnotations = this.extractDemographicAnnotations(this.annotations);
                console.log(`Loaded ${Object.keys(this.annotations).length} annotations`);
            }            // Load alias data and settings
            await this.loadAliasData();
            
            this.processData(graphData, statsData);
            this.updateStatistics(statsData);
            
            console.log('About to create visualization...');
            this.createVisualization();
            console.log('Visualization created successfully');
            
            this.updateAliasDisplay();
            
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

    extractDemographicAnnotations(annotations) {
        const demographics = {};
        for (const [url, annotation] of Object.entries(annotations)) {
            if (annotation.demographic) {
                demographics[url] = annotation.demographic;
            }
        }
        return demographics;
    }

    getAnnotationForNode(node) {
        // Try to find annotation by URL or profile name
        const annotation = this.annotations[node.url] || 
                          Object.values(this.annotations).find(a => a.profileName === node.name);
        return annotation;
    }

    createVisualization() {
        this.svg.selectAll('*').remove();

        // Create zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.svg.select('g').attr('transform', event.transform);
            });        this.svg.call(zoom);

        // Add click away handler for multi-selection
        this.svg.on('click', () => {
            if (this.isMultiSelecting) {
                // Allow clicking away to clear selection
            }
        });

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
        });        // Add profile images or fallback circles
        node.each(function(d) {
            const nodeEl = d3.select(this);
            const radius = self.getNodeRadius(d);
            const clipId = `clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const borderStyle = self.getNodeBorderStyle(d);

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
                            .attr('stroke', borderStyle.color)
                            .attr('stroke-width', borderStyle.width);
                    });
                
                // Add border circle over the image
                nodeEl.append('circle')
                    .attr('r', radius)
                    .attr('fill', 'none')
                    .attr('stroke', borderStyle.color)
                    .attr('stroke-width', borderStyle.width);
            } else {
                // Fallback to colored circle
                nodeEl.append('circle')
                    .attr('r', radius)
                    .attr('fill', self.getNodeColor(d))
                    .attr('stroke', borderStyle.color)
                    .attr('stroke-width', borderStyle.width);
            }

            // Add special styling classes for convicted nodes
            const annotation = self.getAnnotationForNode(d);
            if (annotation && annotation.risk) {
                nodeEl.classed(`node-convicted-${annotation.risk}`, true);
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
            .on('click', (event, d) => {
                event.stopPropagation();
                if (this.isMultiSelecting) {
                    this.toggleNodeSelection(d);
                } else {
                    this.selectNode(d);
                }
            });// Update positions on simulation tick
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
    }    getNodeColor(node) {
        // Check for demographic classification first (highest priority)
        const demographic = this.demographicAnnotations[node.url];
        if (demographic) {
            switch (demographic) {
                case 'kids':
                    return '#ff6b9d'; // Pink for kids
                case 'adult':
                    return '#3498db'; // Blue for adults
                case 'unknown':
                    return '#95a5a6'; // Gray for can't tell
            }
        }
        
        // Check for conviction/annotation status second
        const annotation = this.getAnnotationForNode(node);
        if (annotation) {
            switch (annotation.risk) {
                case 'high':
                    return '#8e44ad'; // Purple for high risk
                case 'medium':
                    return '#d35400'; // Orange for medium risk
                case 'low':
                    return '#f1c40f'; // Yellow for low risk
            }
        }
        
        // Color by community if available, otherwise by importance
        if (node.community !== undefined) {
            return this.colorScale(node.community);
        }
        
        // Color by node importance
        if (node.pagerank > 0.01) return '#4ecdc4'; // High PageRank
        if (node.degree === 0) return '#e74c3c'; // Isolated
        if (node.betweenness > 0.01) return '#f39c12'; // Bridge node
        return '#45b7d1'; // Regular node
    }    getNodeBorderStyle(node) {
        // Check for demographic classification first
        const demographic = this.demographicAnnotations[node.url];
        if (demographic) {
            switch (demographic) {
                case 'kids':
                    return { width: 3, color: '#e91e63' }; // Bold pink border for kids
                case 'adult':
                    return { width: 2, color: '#2196f3' }; // Blue border for adults
                case 'unknown':
                    return { width: 2, color: '#607d8b' }; // Gray border for unknown
            }
        }
        
        // Check for conviction/annotation status
        const annotation = this.getAnnotationForNode(node);
        if (annotation) {
            switch (annotation.risk) {
                case 'high':
                    return { width: 3, color: '#ff0000' };
                case 'medium':
                    return { width: 2, color: '#ff6b35' };
                case 'low':
                    return { width: 1, color: '#e67e22' };
            }
        }
        return { width: 1.5, color: '#fff' };
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
    }    showTooltip(event, node) {
        const tooltip = document.getElementById('tooltip');
        const annotation = this.getAnnotationForNode(node);
        
        // Check for similar nodes
        const similarNodes = this.findSimilarNodes(node);
        
        let tooltipContent = `
            <strong>${node.name}</strong><br>
            Connections: ${node.degree}<br>
            PageRank: ${(node.pagerank * 100).toFixed(2)}%<br>
            Depth: ${node.depth}<br>
            Community: ${node.community || 'N/A'}
        `;
        
        // Add similar nodes info
        if (similarNodes.length > 0) {
            tooltipContent += `<br><br><strong>🔍 Similar Names</strong><br>`;
            tooltipContent += `${similarNodes.length} similar nodes found<br>`;
            tooltipContent += `<span style="font-size: 10px; opacity: 0.8;">Click to select all similar</span>`;
        }
        
        if (annotation) {
            tooltipContent += `<br><br><strong>⚠️ FLAGGED</strong><br>`;
            tooltipContent += `Risk: ${annotation.risk ? annotation.risk.toUpperCase() : 'Unknown'}<br>`;
            tooltipContent += `Category: ${annotation.category || 'N/A'}<br>`;
            if (annotation.convictionDetails && annotation.convictionDetails.crimeCategory) {
                tooltipContent += `Crime: ${annotation.convictionDetails.crimeCategory}<br>`;
            }
        }
        
        tooltip.innerHTML = tooltipContent;
        tooltip.style.left = (event.pageX + 10) + 'px';
        tooltip.style.top = (event.pageY - 10) + 'px';
        tooltip.style.opacity = 1;
    }

    hideTooltip() {
        document.getElementById('tooltip').style.opacity = 0;
    }    selectNode(node) {
        this.selectedNode = node;
        this.updateNodeDetails(node);
        
        // Find all similar nodes based on current threshold
        const similarNodes = this.findSimilarNodes(node);
        
        // Add the clicked node and all similar nodes to selection
        this.selectedNodes.clear();
        this.selectedNodes.add(node.id);
        similarNodes.forEach(similarNode => {
            this.selectedNodes.add(similarNode.id);
        });
        
        // Update visual selection
        this.updateSelectionVisuals();
        this.updateSelectedCount();
        
        // Highlight selected node with special color
        this.svg.selectAll('g.node circle')
            .attr('stroke-width', d => {
                const borderStyle = this.getNodeBorderStyle(d);
                if (d === node) return borderStyle.width + 3; // Primary selected node
                if (this.selectedNodes.has(d.id)) return borderStyle.width + 2; // Similar nodes
                return borderStyle.width;
            })
            .attr('stroke', d => {
                if (d === node) return '#ff6b6b'; // Red for primary selected
                if (this.selectedNodes.has(d.id)) return '#f39c12'; // Orange for similar nodes
                return this.getNodeBorderStyle(d).color;
            });
        
        // Show info about similar nodes found
        if (similarNodes.length > 0) {
            const names = similarNodes.map(n => n.name).join(', ');
            console.log(`Selected ${node.name} and ${similarNodes.length} similar nodes: ${names}`);
        }
    }

    toggleNodeSelection(node) {
        if (this.selectedNodes.has(node.id)) {
            this.selectedNodes.delete(node.id);
        } else {
            this.selectedNodes.add(node.id);
        }
        this.updateSelectionVisuals();
        this.updateSelectedCount();
    }

    updateSelectionVisuals() {
        this.svg.selectAll('g.node')
            .classed('node-selected', d => this.selectedNodes.has(d.id));
    }

    updateSelectedCount() {
        document.getElementById('selected-count').textContent = this.selectedNodes.size;
    }    updateNodeDetails(node) {
        const detailsDiv = document.getElementById('node-details');
        const annotation = this.getAnnotationForNode(node);
        const demographic = this.demographicAnnotations[node.url];
        
        // Find similar nodes for display
        const similarNodes = this.findSimilarNodes(node);
        
        let detailsContent = `
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
        `;
        
        if (demographic) {
            detailsContent += `<div><strong>Age Group:</strong> ${demographic}</div>`;
        }
        
        // Show similar nodes information
        if (similarNodes.length > 0) {
            detailsContent += `
                <div style="margin-top: 15px; padding: 10px; background: rgba(243, 156, 18, 0.2); border-radius: 6px;">
                    <div style="color: #f39c12; font-weight: bold;">🔍 Similar Names Found</div>
                    <div style="font-size: 11px; margin-top: 5px;"><strong>Auto-selected ${similarNodes.length} similar nodes:</strong></div>
            `;
            
            similarNodes.slice(0, 5).forEach(similarNode => {
                detailsContent += `
                    <div style="font-size: 10px; margin: 2px 0; padding: 2px 0; border-bottom: 1px solid rgba(243, 156, 18, 0.3);">
                        <strong>${similarNode.name}</strong> 
                        <span style="opacity: 0.7;">(${(similarNode.similarity * 100).toFixed(1)}% match)</span>
                    </div>
                `;
            });
            
            if (similarNodes.length > 5) {
                detailsContent += `<div style="font-size: 10px; opacity: 0.7; margin-top: 5px;">... and ${similarNodes.length - 5} more</div>`;
            }
            
            detailsContent += `
                    <div style="font-size: 10px; opacity: 0.7; margin-top: 5px;">
                        Threshold: ${(this.currentSettings.similarityThreshold * 100).toFixed(0)}%
                    </div>
                </div>
            `;
        }
        
        if (annotation) {
            detailsContent += `
                <div style="margin-top: 15px; padding: 10px; background: rgba(231, 76, 60, 0.2); border-radius: 6px;">
                    <div style="color: #e74c3c; font-weight: bold;">⚠️ FLAGGED</div>
                    <div><strong>Risk Level:</strong> ${annotation.risk ? annotation.risk.toUpperCase() : 'Unknown'}</div>
                    <div><strong>Category:</strong> ${annotation.category || 'N/A'}</div>
                    ${annotation.convictionDetails && annotation.convictionDetails.crimeCategory ? 
                        `<div><strong>Crime:</strong> ${annotation.convictionDetails.crimeCategory}</div>` : ''}
                    ${annotation.notes ? `<div><strong>Notes:</strong> ${annotation.notes}</div>` : ''}
                    ${annotation.lastUpdated ? 
                        `<div style="font-size: 10px; opacity: 0.7;">Updated: ${new Date(annotation.lastUpdated).toLocaleDateString()}</div>` : ''}
                </div>
            `;
        }
        
        detailsContent += '</div>';
        detailsDiv.innerHTML = detailsContent;
    }    updateStatistics(stats) {
        const updateElement = (id, value) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            } else {
                console.warn(`Element with id '${id}' not found for statistics update`);
            }
        };

        updateElement('total-nodes', stats.total_profiles || 0);
        updateElement('total-edges', stats.total_connections || 0);
        updateElement('avg-degree', (stats.average_connections || 0).toFixed(1));
        updateElement('communities', (stats.communities || []).length);
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

    // Bulk selection methods
    toggleMultiSelect() {
        this.isMultiSelecting = !this.isMultiSelecting;
        const btn = document.getElementById('multi-select-btn');
        
        if (this.isMultiSelecting) {
            btn.classList.add('multi-select-mode');
            btn.textContent = '📌 Multi-Select ON';
        } else {
            btn.classList.remove('multi-select-mode');
            btn.textContent = '📌 Multi-Select';
            this.clearSelection();
        }
    }

    clearSelection() {
        this.selectedNodes.clear();
        this.updateSelectionVisuals();
        this.updateSelectedCount();
    }

    selectAllVisible() {
        const visibleNodes = this.svg.selectAll('g.node')
            .filter(function() {
                return d3.select(this).style('opacity') == 1;
            })
            .data();
        
        visibleNodes.forEach(node => {
            this.selectedNodes.add(node.id);
        });
        
        this.updateSelectionVisuals();
        this.updateSelectedCount();
    }

    async markSelectedAs(demographic) {
        if (this.selectedNodes.size === 0) {
            alert('Please select nodes first');
            return;
        }

        const selectedNodeData = this.nodes.filter(n => this.selectedNodes.has(n.id));
        let successCount = 0;

        for (const node of selectedNodeData) {
            try {
                await this.saveDemographicAnnotation(node.url, demographic);
                successCount++;
            } catch (error) {
                console.error(`Failed to mark ${node.name} as ${demographic}:`, error);
            }
        }

        alert(`Successfully marked ${successCount} out of ${this.selectedNodes.size} nodes as "${demographic}"`);
        
        // Refresh demographic annotations
        await this.loadDemographicAnnotations();
        this.clearSelection();
    }

    async saveDemographicAnnotation(profileUrl, demographic) {
        const response = await fetch('http://localhost:3000/api/annotations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                profileUrl: profileUrl,
                annotation: {
                    demographic: demographic,
                    category: 'demographic-annotation',
                    timestamp: Date.now(),
                    lastUpdated: new Date().toISOString(),
                    source: 'graph-visualizer-bulk-selection'
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to save demographic annotation: ${response.statusText}`);
        }

        return response.json();
    }

    async loadDemographicAnnotations() {
        try {
            const response = await fetch('http://localhost:3000/api/annotations');
            if (response.ok) {
                const data = await response.json();
                this.annotations = data.annotations || {};
                this.demographicAnnotations = this.extractDemographicAnnotations(this.annotations);
            }
        } catch (error) {
            console.error('Error loading demographic annotations:', error);
        }
    }

    toggleAliasDetection() {
        this.currentSettings.autoDetectAliases = !this.currentSettings.autoDetectAliases;
        const btn = document.getElementById('toggle-alias-detection');
        btn.classList.toggle('active', this.currentSettings.autoDetectAliases);
        
        if (this.currentSettings.autoDetectAliases) {
            btn.textContent = '🔍 Alias Detection: ON';
            this.detectAliases();
        } else {
            btn.textContent = '🔍 Alias Detection: OFF';
            this.clearAliasHighlights();
        }
    }

    async detectAliases() {
        this.similarNames = [];
        this.highlightedAliases.clear();
        
        for (const node of this.nodes) {
            const similar = this.nodes.filter(n => n !== node && this.getSimilarity(n.name, node.name) >= this.currentSettings.similarityThreshold);
            this.similarNames.push({ node, similar });
            
            if (similar.length > 0) {
                this.highlightedAliases.add(node.id);
                similar.forEach(s => this.highlightedAliases.add(s.id));
            }
        }
        
        this.updateAliasHighlights();
    }

    getSimilarity(name1, name2) {
        const longer = name1.length > name2.length ? name1 : name2;
        if (longer.length === 0) return 0;
        const distance = this.levenshtein(longer, name1 === longer ? name2 : name1);
        return (1 - distance / longer.length);
    }    levenshtein(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        Math.min(
                            matrix[i][j - 1] + 1,
                            matrix[i - 1][j] + 1
                        )
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }

    findSimilarNodes(targetNode) {
        const similarNodes = [];
        
        for (const node of this.nodes) {
            if (node.id !== targetNode.id) {
                const similarity = this.getSimilarity(node.name, targetNode.name);
                if (similarity >= this.currentSettings.similarityThreshold) {
                    similarNodes.push({
                        ...node,
                        similarity: similarity
                    });
                }
            }
        }
        
        // Sort by similarity (highest first)
        return similarNodes.sort((a, b) => b.similarity - a.similarity);
    }

    updateAliasHighlights() {
        this.svg.selectAll('g.node')
            .classed('alias-highlight', d => this.highlightedAliases.has(d.id));
    }

    toggleConnectionMode() {
        this.isConnectionMode = !this.isConnectionMode;
        const button = document.getElementById('manual-connection-mode');
        const instructions = document.getElementById('connection-instructions');
        const info = document.getElementById('manual-connection-info');
        
        if (this.isConnectionMode) {
            button.classList.add('connection-mode-active');
            button.textContent = '🔗 Exit Connection Mode';
            instructions.style.display = 'block';
            this.enableConnectionMode();
        } else {
            button.classList.remove('connection-mode-active');
            button.textContent = '🔗 Connection Mode';
            instructions.style.display = 'none';
            info.style.display = 'none';
            this.disableConnectionMode();
        }
    }
    
    enableConnectionMode() {
        // Override node click behavior
        this.svg.selectAll('g.node')
            .on('click', (event, d) => {
                event.stopPropagation();
                this.handleConnectionModeClick(d);
            });
    }
    
    disableConnectionMode() {
        this.selectedForConnection = null;
        this.clearConnectionHighlights();
        
        // Restore normal node click behavior
        this.svg.selectAll('g.node')
            .on('click', (event, d) => {
                event.stopPropagation();
                if (this.isMultiSelecting) {
                    this.toggleNodeSelection(d);
                } else {
                    this.selectNode(d);
                }
            });
    }
    
    handleConnectionModeClick(node) {
        const info = document.getElementById('manual-connection-info');
        const selected = document.getElementById('selected-for-connection');
        
        if (!this.selectedForConnection) {
            // First node selection
            this.selectedForConnection = node;
            this.highlightNodeForConnection(node, true);
            info.style.display = 'block';
            selected.innerHTML = `Selected: <strong>${node.name}</strong><br>Click another node to create connection`;
        } else if (this.selectedForConnection.id === node.id) {
            // Deselect same node
            this.selectedForConnection = null;
            this.clearConnectionHighlights();
            info.style.display = 'none';
        } else {
            // Second node selection - create connection
            this.createManualConnection(this.selectedForConnection, node);
            this.selectedForConnection = null;
            this.clearConnectionHighlights();
            info.style.display = 'none';
        }
    }
    
    highlightNodeForConnection(node, highlight) {
        this.svg.selectAll('g.node circle')
            .classed('node-connection-selected', d => highlight && d.id === node.id);
    }
    
    clearConnectionHighlights() {
        this.svg.selectAll('g.node circle')
            .classed('node-connection-selected', false);
    }
    
    async createManualConnection(sourceNode, targetNode) {
        try {
            const response = await fetch('http://localhost:3000/api/connections/manual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    source: sourceNode.url,
                    target: targetNode.url,
                    connectionType: 'friend',
                    reason: 'Manual connection via visualizer'
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                
                // Add the connection to local data
                this.links.push({
                    source: sourceNode.id,
                    target: targetNode.id,
                    manual: true
                });
                
                // Update simulation
                this.simulation.force('link').links(this.links);
                this.simulation.alpha(0.3).restart();
                
                // Highlight the new connection
                this.highlightManualConnection(sourceNode, targetNode);
                
                alert(`Manual connection created between ${sourceNode.name} and ${targetNode.name}`);
            } else {
                const error = await response.json();
                alert(`Failed to create connection: ${error.error}`);
            }
        } catch (error) {
            console.error('Error creating manual connection:', error);
            alert('Error creating manual connection. Please check console for details.');
        }
    }
    
    highlightManualConnection(sourceNode, targetNode) {
        // Find and highlight the connection line
        this.svg.selectAll('line')
            .filter(d => 
                (d.source.id === sourceNode.id && d.target.id === targetNode.id) ||
                (d.source.id === targetNode.id && d.target.id === sourceNode.id)
            )
            .classed('manual-connection-line', true);
    }
    
    // Alias Connection Mode Methods
    
    toggleAliasConnectionMode() {
        this.isAliasConnectionMode = !this.isAliasConnectionMode;
        const button = document.getElementById('alias-connection-mode');
        const instructions = document.getElementById('connection-instructions');
        const info = document.getElementById('manual-connection-info');
        
        if (this.isAliasConnectionMode) {
            // Disable regular connection mode if active
            this.isConnectionMode = false;
            const regularButton = document.getElementById('manual-connection-mode');
            regularButton.classList.remove('connection-mode-active');
            regularButton.textContent = '🔗 Connection Mode';
            
            // Enable alias connection mode
            button.classList.add('alias-connection-mode-active');
            button.textContent = '🎭 Exit Alias Mode';
            instructions.style.display = 'block';
            instructions.innerHTML = '🎭 Alias Mode: Click FAKE account first, then REAL account to connect and analyze shared friends';
            this.enableAliasConnectionMode();
        } else {
            button.classList.remove('alias-connection-mode-active');
            button.textContent = '🎭 Alias Mode';
            instructions.style.display = 'none';
            info.style.display = 'none';
            this.disableAliasConnectionMode();
        }
    }
    
    enableAliasConnectionMode() {
        // Override node click behavior for alias connections
        this.svg.selectAll('g.node')
            .on('click', (event, d) => {
                event.stopPropagation();
                this.handleAliasConnectionModeClick(d);
            });
    }
    
    disableAliasConnectionMode() {
        this.selectedAliasAccount = null;
        this.selectedRealAccount = null;
        this.clearConnectionHighlights();
        
        // Restore normal node click behavior
        this.svg.selectAll('g.node')
            .on('click', (event, d) => {
                event.stopPropagation();
                if (this.isMultiSelecting) {
                    this.toggleNodeSelection(d);
                } else {
                    this.selectNode(d);
                }
            });
    }
    
    handleAliasConnectionModeClick(node) {
        const info = document.getElementById('manual-connection-info');
        const selected = document.getElementById('selected-for-connection');
        
        if (!this.selectedAliasAccount) {
            // First node selection - this should be the FAKE/ALIAS account
            this.selectedAliasAccount = node;
            this.highlightNodeForConnection(node, true);
            node.element.style.border = '3px solid #e74c3c';
            info.style.display = 'block';
            selected.innerHTML = `🎭 <strong>FAKE Account:</strong> ${node.name}<br>📍 Now click the <strong>REAL account</strong> to connect and analyze`;
        } else if (this.selectedAliasAccount.id === node.id) {
            // Deselect same node
            this.selectedAliasAccount = null;
            this.clearConnectionHighlights();
            info.style.display = 'none';
        } else if (!this.selectedRealAccount) {
            // Second node selection - this should be the REAL account
            this.selectedRealAccount = node;
            this.highlightNodeForConnection(node, true);
            node.element.style.border = '3px solid #27ae60';
            
            // Create alias connection and analyze shared friends
            this.createAliasConnection(this.selectedAliasAccount, this.selectedRealAccount);
            this.selectedAliasAccount = null;
            this.selectedRealAccount = null;
            this.clearConnectionHighlights();
            info.style.display = 'none';
        }
    }
    
    async createAliasConnection(fakeAccount, realAccount) {
        try {
            // Create the connection in backend
            const response = await fetch('http://localhost:3000/api/connections/manual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    source: fakeAccount.url,
                    target: realAccount.url,
                    connectionType: 'alias',
                    reason: `Alias connection: ${fakeAccount.name} (fake) → ${realAccount.name} (real)`
                })
            });
            
            if (response.ok) {
                // Add the connection to local data with special alias styling
                this.links.push({
                    source: fakeAccount.id,
                    target: realAccount.id,
                    alias: true,
                    manual: true
                });
                
                // Update simulation
                this.simulation.force('link').links(this.links);
                this.simulation.alpha(0.3).restart();
                
                // Highlight the new alias connection
                this.highlightAliasConnection(fakeAccount, realAccount);
                
                // Analyze shared friends immediately
                const sharedFriends = this.findSharedFriends(fakeAccount, realAccount);
                this.displaySharedFriendsAnalysis(fakeAccount, realAccount, sharedFriends);
                
                alert(`✅ Alias connection created!\n🎭 Fake: ${fakeAccount.name}\n👤 Real: ${realAccount.name}\n👥 Shared friends: ${sharedFriends.length}`);
            } else {
                const error = await response.json();
                alert(`Failed to create alias connection: ${error.error}`);
            }
        } catch (error) {
            console.error('Error creating alias connection:', error);
            alert('Error creating alias connection. Please check console for details.');
        }
    }
    
    highlightAliasConnection(fakeAccount, realAccount) {
        // Find and highlight the alias connection line with special styling
        this.svg.selectAll('line')
            .filter(d => 
                (d.source.id === fakeAccount.id && d.target.id === realAccount.id) ||
                (d.source.id === realAccount.id && d.target.id === fakeAccount.id)
            )
            .classed('alias-connection-line', true);
    }
    
    findSharedFriends(fakeAccount, realAccount) {
        const fakeConnections = this.links.filter(link => 
            link.source.id === fakeAccount.id || link.target.id === fakeAccount.id
        ).map(link => link.source.id === fakeAccount.id ? link.target.id : link.source.id);
        
        const realConnections = this.links.filter(link => 
            link.source.id === realAccount.id || link.target.id === realAccount.id
        ).map(link => link.source.id === realAccount.id ? link.target.id : link.source.id);
        
        // Find intersection (shared friends)
        const sharedFriendIds = fakeConnections.filter(id => realConnections.includes(id));
        
        // Get the actual node objects
        const sharedFriends = sharedFriendIds.map(id => this.nodes.find(node => node.id === id)).filter(node => node);
        
        return sharedFriends;
    }
    
    displaySharedFriendsAnalysis(fakeAccount, realAccount, sharedFriends) {
        // Highlight shared friends
        sharedFriends.forEach(friend => {
            this.svg.selectAll('g.node circle')
                .filter(d => d.id === friend.id)
                .classed('shared-friend-highlight', true);
        });
        
        // Update the alias list with analysis
        const listDiv = document.getElementById('alias-list');
        let analysisHtml = `
            <div style="background: rgba(231, 76, 60, 0.2); padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #e74c3c;">
                <h4 style="color: #e74c3c; margin: 0 0 8px 0;">🎭 Alias Connection Analysis</h4>
                <div><strong>Fake Account:</strong> ${fakeAccount.name}</div>
                <div><strong>Real Account:</strong> ${realAccount.name}</div>
                <div style="margin-top: 8px;"><strong>🔍 Shared Friends (${sharedFriends.length}):</strong></div>
        `;
        
        if (sharedFriends.length > 0) {
            analysisHtml += '<div style="max-height: 120px; overflow-y: auto; margin-top: 5px;">';
            sharedFriends.forEach(friend => {
                analysisHtml += `<div style="padding: 2px 0; font-size: 11px;">⚠️ ${friend.name}</div>`;
            });
            analysisHtml += '</div>';
            analysisHtml += `<div style="margin-top: 8px; color: #f39c12;"><strong>⚠️ LEAK DETECTED:</strong> These ${sharedFriends.length} friends connect both accounts!</div>`;
        } else {
            analysisHtml += '<div style="color: #27ae60; margin-top: 5px;">✅ No shared friends found - accounts appear isolated</div>';
        }
        
        analysisHtml += '</div>';
        listDiv.innerHTML = analysisHtml + listDiv.innerHTML;
    }
    
    analyzeSharedFriends() {
        // Clear previous highlights
        this.clearAllHighlights();
        
        // Find all alias connections and highlight their shared friends
        let totalAnalyzed = 0;
        let totalSharedFriends = 0;
        
        this.links.forEach(link => {
            if (link.alias) {
                const sourceNode = this.nodes.find(n => n.id === link.source.id || n.id === link.source);
                const targetNode = this.nodes.find(n => n.id === link.target.id || n.id === link.target);
                
                if (sourceNode && targetNode) {
                    const sharedFriends = this.findSharedFriends(sourceNode, targetNode);
                    totalSharedFriends += sharedFriends.length;
                    totalAnalyzed++;
                    
                    // Highlight the alias connection
                    this.highlightAliasConnection(sourceNode, targetNode);
                    
                    // Highlight shared friends
                    sharedFriends.forEach(friend => {
                        this.svg.selectAll('g.node circle')
                            .filter(d => d.id === friend.id)
                            .classed('shared-friend-highlight', true);
                    });
                }
            }
        });
        
        if (totalAnalyzed === 0) {
            alert('No alias connections found. Use Alias Mode to connect fake and real accounts first.');
        } else {
            alert(`📊 Analysis Complete!\n🎭 Analyzed ${totalAnalyzed} alias connections\n⚠️ Found ${totalSharedFriends} shared friends (potential leaks)\n\n💡 Yellow pulsing nodes are shared friends between fake and real accounts.`);
        }
    }
    
    // Missing utility methods
    
    clearAllHighlights() {
        // Clear all highlight classes
        this.svg.selectAll('g.node circle')
            .classed('shared-friend-highlight', false)
            .classed('alias-highlight', false)
            .classed('similar-name-highlight', false)
            .classed('node-connection-selected', false);
        
        this.svg.selectAll('line')
            .classed('alias-connection-line', false)
            .classed('manual-connection-line', false)
            .classed('similar-name-link', false)
            .classed('alias-link', false);
    }
    
    detectSimilarNames() {
        // Clear previous similar names
        this.similarNames = [];
        this.highlightedAliases.clear();
        
        // Find all similar name pairs
        const foundPairs = [];
        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = i + 1; j < this.nodes.length; j++) {
                const node1 = this.nodes[i];
                const node2 = this.nodes[j];
                const similarity = this.getSimilarity(node1.name, node2.name);
                
                if (similarity >= this.currentSettings.similarityThreshold) {
                    foundPairs.push({
                        node1: node1,
                        node2: node2,
                        similarity: similarity
                    });
                    
                    this.highlightedAliases.add(node1.id);
                    this.highlightedAliases.add(node2.id);
                }
            }
        }
        
        this.similarNames = foundPairs;
        this.updateSimilarNamesDisplay();
        this.updateAliasHighlights();
        
        alert(`🔍 Found ${foundPairs.length} similar name pairs with threshold ${(this.currentSettings.similarityThreshold * 100).toFixed(0)}%`);
    }
    
    updateThresholdDisplay(value) {
        this.currentSettings.similarityThreshold = parseFloat(value);
        
        // Update all threshold displays
        const displays = ['threshold-display', 'threshold-value'];
        displays.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        });
        
        // Re-detect similar names with new threshold
        if (this.currentSettings.autoDetectAliases) {
            this.detectSimilarNames();
        }
    }
    
    toggleAliasHighlights() {
        const button = document.getElementById('highlight-aliases');
        
        if (this.highlightedAliases.size === 0) {
            // No aliases to highlight, run detection first
            this.detectSimilarNames();
            button.textContent = '🚫 Clear Highlights';
        } else {
            // Toggle highlights
            const areHighlighted = this.svg.selectAll('g.node').classed('alias-highlight');
            
            if (areHighlighted) {
                this.clearAllHighlights();
                button.textContent = '✨ Highlight Aliases';
            } else {
                this.updateAliasHighlights();
                button.textContent = '🚫 Clear Highlights';
            }
        }
    }
    
    saveAliasSettings() {
        const settings = {
            similarityThreshold: this.currentSettings.similarityThreshold,
            autoDetectAliases: this.currentSettings.autoDetectAliases,
            showSimilarNames: this.currentSettings.showSimilarNames,
            showManualConnections: this.currentSettings.showManualConnections,
            confirmedAliases: this.confirmedAliases,
            manualConnections: this.manualConnections.map(conn => ({
                sourceUrl: conn.source.url,
                targetUrl: conn.target.url,
                reason: conn.reason
            })),
            aliasConnections: this.aliasConnections.map(conn => ({
                fakeUrl: conn.fake.url,
                realUrl: conn.real.url,
                sharedFriends: conn.sharedFriends
            }))
        };
        
        try {
            const settingsJson = JSON.stringify(settings, null, 2);
            const blob = new Blob([settingsJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `alias-settings-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            alert('✅ Alias settings saved successfully!');
        } catch (error) {
            console.error('Error saving alias settings:', error);
            alert('❌ Error saving alias settings. Check console for details.');
        }
    }
    
    loadAliasSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const settings = JSON.parse(e.target.result);
                    
                    // Restore settings
                    this.currentSettings.similarityThreshold = settings.similarityThreshold || 0.7;
                    this.currentSettings.autoDetectAliases = settings.autoDetectAliases !== false;
                    this.currentSettings.showSimilarNames = settings.showSimilarNames !== false;
                    this.currentSettings.showManualConnections = settings.showManualConnections !== false;
                    
                    // Update UI elements
                    const thresholdSlider = document.getElementById('alias-threshold');
                    if (thresholdSlider) {
                        thresholdSlider.value = this.currentSettings.similarityThreshold;
                        this.updateThresholdDisplay(this.currentSettings.similarityThreshold);
                    }
                    
                    // Restore alias data
                    this.confirmedAliases = settings.confirmedAliases || [];
                    
                    // Note: Manual connections and alias connections would need to be 
                    // recreated through the backend API in a real implementation
                    
                    alert(`✅ Alias settings loaded successfully!\n📊 Threshold: ${(this.currentSettings.similarityThreshold * 100).toFixed(0)}%\n🎭 Confirmed aliases: ${this.confirmedAliases.length}`);
                    
                    // Re-detect with new settings
                    if (this.currentSettings.autoDetectAliases) {
                        this.detectSimilarNames();
                    }
                    
                } catch (error) {
                    console.error('Error loading alias settings:', error);
                    alert('❌ Error loading alias settings. Please check the file format.');
                }
            };
            reader.readAsText(file);
        };
        
        input.click();
    }
    
    updateSimilarNamesDisplay() {
        // Update the similar names list in the UI
        const listElement = document.getElementById('similar-names-list');
        if (!listElement) return;
        
        if (this.similarNames.length === 0) {
            listElement.innerHTML = '<div style="padding: 10px; opacity: 0.7; text-align: center;">No similar names found</div>';
            return;
        }
        
        let html = '';
        this.similarNames.forEach((pair, index) => {
            const similarity = (pair.similarity * 100).toFixed(1);
            html += `
                <div class="alias-item">
                    <div>
                        <strong>${pair.node1.name}</strong> ↔ <strong>${pair.node2.name}</strong>
                        <div class="similarity-score">${similarity}% match</div>
                    </div>
                    <div class="alias-actions">
                        <button onclick="visualizer.confirmAlias(${index})" title="Confirm as alias">✓</button>
                        <button onclick="visualizer.rejectAlias(${index})" title="Reject">✗</button>
                    </div>
                </div>
            `;
        });
        
        listElement.innerHTML = html;
    }
    
    confirmAlias(index) {
        if (index >= 0 && index < this.similarNames.length) {
            const pair = this.similarNames[index];
            this.confirmedAliases.push({
                node1: pair.node1,
                node2: pair.node2,
                similarity: pair.similarity,
                confirmedAt: new Date().toISOString()
            });
            
            // Remove from similar names
            this.similarNames.splice(index, 1);
            this.updateSimilarNamesDisplay();
            
            alert(`✅ Confirmed alias: ${pair.node1.name} ↔ ${pair.node2.name}`);
        }
    }
    
    rejectAlias(index) {
        if (index >= 0 && index < this.similarNames.length) {
            const pair = this.similarNames[index];
            
            // Remove highlights for this pair
            this.highlightedAliases.delete(pair.node1.id);
            this.highlightedAliases.delete(pair.node2.id);
            
            // Remove from similar names
            this.similarNames.splice(index, 1);
            this.updateSimilarNamesDisplay();
            this.updateAliasHighlights();
              alert(`❌ Rejected alias: ${pair.node1.name} ↔ ${pair.node2.name}`);
        }
    }

    // Missing methods that are called in loadData()
    async loadAliasData() {
        // Initialize alias data arrays if they don't exist
        this.similarNames = this.similarNames || [];
        this.confirmedAliases = this.confirmedAliases || [];
        this.manualConnections = this.manualConnections || [];
        this.aliasConnections = this.aliasConnections || [];
        
        // Could load from backend API in the future
        console.log('Alias data initialized');
    }

    updateAliasDisplay() {
        // Update the similar names display if it exists
        if (document.getElementById('alias-list')) {
            this.updateSimilarNamesDisplay();
        }
        
        // Update alias highlights if enabled
        if (this.currentSettings.showSimilarNames && this.nodes.length > 0) {
            // Only detect if we have nodes loaded
            setTimeout(() => {
                if (this.currentSettings.autoDetectAliases) {
                    this.detectSimilarNames();
                }
            }, 100);
        }
    }
}

// Initialize visualizer when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.visualizer = new GraphVisualizer();
});

// Optional auto-refresh (disabled by default)
let autoRefreshInterval = null;

function toggleAutoRefresh() {
    if (autoRefreshInterval) {
        // Disable auto-refresh
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        document.getElementById('auto-refresh-btn').textContent = '🔄 Auto-Refresh: OFF';
        document.getElementById('auto-refresh-btn').style.backgroundColor = 'rgba(231, 76, 60, 0.8)';
        console.log('Auto-refresh disabled');
    } else {
        // Enable auto-refresh every 30 seconds
        autoRefreshInterval = setInterval(() => {
            if (window.visualizer) {
                console.log('Auto-refreshing graph data...');
                window.visualizer.loadData();
            }
        }, 30000);
        document.getElementById('auto-refresh-btn').textContent = '🔄 Auto-Refresh: ON';
        document.getElementById('auto-refresh-btn').style.backgroundColor = 'rgba(46, 204, 113, 0.8)';
        console.log('Auto-refresh enabled (every 30 seconds)');
    }
}
