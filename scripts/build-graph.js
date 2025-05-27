const fs = require('fs');
const path = require('path');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'backend', 'data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const GRAPH_FILE = path.join(DATA_DIR, 'graph.json');

// Helper functions
const readJSON = (filePath) => {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return null;
    }
};

const writeJSON = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
};

// Main graph building function
function buildGraph() {
    console.log('🔧 Building social graph from scraped profiles...');
    
    const graph = {
        nodes: [],
        edges: [],
        metadata: {
            built_at: new Date().toISOString(),
            total_profiles: 0,
            depth_levels: {},
            connected_components: 0
        }
    };

    // Read all profile files
    const profileFiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
    console.log(`📁 Found ${profileFiles.length} profile files`);

    const nodeMap = new Map();
    const edgeSet = new Set();

    // Process each profile
    profileFiles.forEach((file, index) => {
        const profilePath = path.join(PROFILES_DIR, file);
        const profile = readJSON(profilePath);
        
        if (!profile || !profile.url) return;

        console.log(`⚙️  Processing profile ${index + 1}/${profileFiles.length}: ${profile.name || 'Unknown'}`);

        // Create or update node
        const nodeId = profile.url;
        if (!nodeMap.has(nodeId)) {
            const node = {
                id: nodeId,
                url: profile.url,
                name: profile.name || 'Unknown',
                depth: profile.depth || 1,
                profile_image: profile.profile_image || null,
                scraped_at: profile.scraped_at,
                data: {
                    about: profile.about || {},
                    type: profile.type || 'unknown',
                    scraped_sections: profile.scraped_sections || []
                },
                // Graph metrics (will be calculated later)
                degree: 0,
                betweenness: 0,
                closeness: 0,
                pagerank: 0
            };

            nodeMap.set(nodeId, node);
            
            // Track depth distribution
            const depth = node.depth;
            graph.metadata.depth_levels[depth] = (graph.metadata.depth_levels[depth] || 0) + 1;
        }

        // Process friends (edges)
        if (profile.friends && Array.isArray(profile.friends)) {
            profile.friends.forEach(friend => {
                if (friend.url && friend.url !== profile.url) {
                    const sourceId = profile.url;
                    const targetId = friend.url;
                    const edgeId = `${sourceId}|${targetId}`;
                    const reverseEdgeId = `${targetId}|${sourceId}`;

                    // Add edge if not already exists (undirected)
                    if (!edgeSet.has(edgeId) && !edgeSet.has(reverseEdgeId)) {
                        edgeSet.add(edgeId);
                        
                        graph.edges.push({
                            id: edgeId,
                            source: sourceId,
                            target: targetId,
                            type: 'friend',
                            weight: 1,
                            created_at: new Date().toISOString()
                        });

                        // Update degree count
                        if (nodeMap.has(sourceId)) {
                            nodeMap.get(sourceId).degree++;
                        }
                        if (nodeMap.has(targetId)) {
                            if (!nodeMap.has(targetId)) {
                                // Create placeholder node for friend
                                nodeMap.set(targetId, {
                                    id: targetId,
                                    url: targetId,
                                    name: friend.name || 'Unknown',
                                    depth: (profile.depth || 1) + 1,
                                    profile_image: null,
                                    scraped_at: null,
                                    data: {},
                                    degree: 1,
                                    betweenness: 0,
                                    closeness: 0,
                                    pagerank: 0
                                });
                            } else {
                                nodeMap.get(targetId).degree++;
                            }
                        }
                    }
                }
            });
        }
    });

    // Convert maps to arrays
    graph.nodes = Array.from(nodeMap.values());
    graph.metadata.total_profiles = graph.nodes.length;

    console.log(`📊 Graph built with ${graph.nodes.length} nodes and ${graph.edges.length} edges`);

    // Calculate advanced metrics
    console.log('🧮 Calculating graph metrics...');
    calculateGraphMetrics(graph);

    // Find connected components
    console.log('🔍 Finding connected components...');
    findConnectedComponents(graph);

    // Save graph
    if (writeJSON(GRAPH_FILE, graph)) {
        console.log(`✅ Graph saved to ${GRAPH_FILE}`);
        printGraphStats(graph);
        return graph;
    } else {
        console.error('❌ Failed to save graph');
        return null;
    }
}

// Calculate advanced graph metrics
function calculateGraphMetrics(graph) {
    const nodes = graph.nodes;
    const edges = graph.edges;
    
    // Build adjacency list
    const adjList = new Map();
    nodes.forEach(node => adjList.set(node.id, []));
    
    edges.forEach(edge => {
        if (adjList.has(edge.source)) adjList.get(edge.source).push(edge.target);
        if (adjList.has(edge.target)) adjList.get(edge.target).push(edge.source);
    });

    // Calculate betweenness centrality (simplified version)
    nodes.forEach(node => {
        node.betweenness = calculateBetweenness(node.id, adjList, nodes);
    });

    // Calculate closeness centrality
    nodes.forEach(node => {
        node.closeness = calculateCloseness(node.id, adjList, nodes);
    });

    // Calculate PageRank (simplified)
    calculatePageRank(graph);
}

function calculateBetweenness(nodeId, adjList, allNodes) {
    // Simplified betweenness calculation
    // In a full implementation, you'd use algorithms like Brandes' algorithm
    let betweenness = 0;
    const neighbors = adjList.get(nodeId) || [];
    
    // Simple approximation: nodes with more connections have higher betweenness
    betweenness = neighbors.length / allNodes.length;
    
    return betweenness;
}

function calculateCloseness(nodeId, adjList, allNodes) {
    // Simplified closeness calculation using BFS
    const distances = bfs(nodeId, adjList);
    const reachableNodes = Object.keys(distances).length - 1; // excluding self
    
    if (reachableNodes === 0) return 0;
    
    const totalDistance = Object.values(distances).reduce((sum, dist) => sum + dist, 0);
    return reachableNodes / totalDistance;
}

function bfs(startNode, adjList) {
    const distances = {};
    const queue = [startNode];
    distances[startNode] = 0;
    
    while (queue.length > 0) {
        const current = queue.shift();
        const neighbors = adjList.get(current) || [];
        
        neighbors.forEach(neighbor => {
            if (!(neighbor in distances)) {
                distances[neighbor] = distances[current] + 1;
                queue.push(neighbor);
            }
        });
    }
    
    return distances;
}

function calculatePageRank(graph) {
    const nodes = graph.nodes;
    const edges = graph.edges;
    const damping = 0.85;
    const iterations = 10;
    
    // Initialize PageRank values
    const pagerank = {};
    const n = nodes.length;
    nodes.forEach(node => pagerank[node.id] = 1.0 / n);
    
    // Build adjacency list with outgoing links
    const outLinks = new Map();
    nodes.forEach(node => outLinks.set(node.id, []));
    
    edges.forEach(edge => {
        if (outLinks.has(edge.source)) {
            outLinks.get(edge.source).push(edge.target);
        }
    });
    
    // PageRank iterations
    for (let i = 0; i < iterations; i++) {
        const newPagerank = {};
        
        nodes.forEach(node => {
            newPagerank[node.id] = (1 - damping) / n;
            
            // Add contributions from incoming links
            edges.forEach(edge => {
                if (edge.target === node.id) {
                    const sourceOutDegree = outLinks.get(edge.source).length;
                    if (sourceOutDegree > 0) {
                        newPagerank[node.id] += damping * pagerank[edge.source] / sourceOutDegree;
                    }
                }
            });
        });
        
        Object.assign(pagerank, newPagerank);
    }
    
    // Update nodes with PageRank values
    nodes.forEach(node => {
        node.pagerank = pagerank[node.id] || 0;
    });
}

function findConnectedComponents(graph) {
    const nodes = graph.nodes;
    const edges = graph.edges;
    
    // Build adjacency list
    const adjList = new Map();
    nodes.forEach(node => adjList.set(node.id, []));
    
    edges.forEach(edge => {
        if (adjList.has(edge.source)) adjList.get(edge.source).push(edge.target);
        if (adjList.has(edge.target)) adjList.get(edge.target).push(edge.source);
    });
    
    const visited = new Set();
    const components = [];
    
    nodes.forEach(node => {
        if (!visited.has(node.id)) {
            const component = [];
            dfsComponent(node.id, adjList, visited, component);
            components.push(component);
        }
    });
    
    // Add component information to nodes
    components.forEach((component, index) => {
        component.forEach(nodeId => {
            const node = nodes.find(n => n.id === nodeId);
            if (node) {
                node.component = index;
                node.component_size = component.length;
            }
        });
    });
    
    graph.metadata.connected_components = components.length;
    graph.metadata.largest_component = Math.max(...components.map(c => c.length));
    
    console.log(`🔗 Found ${components.length} connected components`);
    console.log(`📏 Largest component has ${graph.metadata.largest_component} nodes`);
}

function dfsComponent(nodeId, adjList, visited, component) {
    visited.add(nodeId);
    component.push(nodeId);
    
    const neighbors = adjList.get(nodeId) || [];
    neighbors.forEach(neighbor => {
        if (!visited.has(neighbor)) {
            dfsComponent(neighbor, adjList, visited, component);
        }
    });
}

function printGraphStats(graph) {
    console.log('\n📈 GRAPH STATISTICS');
    console.log('==================');
    console.log(`Nodes: ${graph.nodes.length}`);
    console.log(`Edges: ${graph.edges.length}`);
    console.log(`Connected Components: ${graph.metadata.connected_components}`);
    console.log(`Largest Component: ${graph.metadata.largest_component} nodes`);
    console.log(`Average Degree: ${(graph.edges.length * 2 / graph.nodes.length).toFixed(2)}`);
    
    console.log('\nDepth Distribution:');
    Object.entries(graph.metadata.depth_levels).forEach(([depth, count]) => {
        console.log(`  Depth ${depth}: ${count} nodes`);
    });
    
    // Top nodes by metrics
    const topByDegree = graph.nodes.sort((a, b) => b.degree - a.degree).slice(0, 5);
    console.log('\nTop 5 nodes by degree:');
    topByDegree.forEach((node, i) => {
        console.log(`  ${i + 1}. ${node.name} (${node.degree} connections)`);
    });
    
    const topByPageRank = graph.nodes.sort((a, b) => b.pagerank - a.pagerank).slice(0, 5);
    console.log('\nTop 5 nodes by PageRank:');
    topByPageRank.forEach((node, i) => {
        console.log(`  ${i + 1}. ${node.name} (${node.pagerank.toFixed(4)})`);
    });
}

// Export functions
function exportGraph(format = 'json') {
    const graph = readJSON(GRAPH_FILE);
    if (!graph) {
        console.error('❌ No graph data found');
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    switch (format.toLowerCase()) {
        case 'json':
            const jsonFile = path.join(DATA_DIR, `graph_export_${timestamp}.json`);
            writeJSON(jsonFile, graph);
            console.log(`📤 Graph exported to ${jsonFile}`);
            break;
            
        case 'csv':
            exportToCSV(graph, timestamp);
            break;
            
        case 'gexf':
            exportToGEXF(graph, timestamp);
            break;
            
        default:
            console.error('❌ Unsupported format. Use: json, csv, or gexf');
    }
}

function exportToCSV(graph, timestamp) {
    // Export nodes
    const nodesCSV = 'id,name,depth,degree,pagerank,component\n' + 
        graph.nodes.map(node => 
            `"${node.id}","${node.name}",${node.depth},${node.degree},${node.pagerank},${node.component || 0}`
        ).join('\n');
    
    const nodesFile = path.join(DATA_DIR, `nodes_${timestamp}.csv`);
    fs.writeFileSync(nodesFile, nodesCSV);
    
    // Export edges
    const edgesCSV = 'source,target,type,weight\n' + 
        graph.edges.map(edge => 
            `"${edge.source}","${edge.target}","${edge.type}",${edge.weight || 1}`
        ).join('\n');
    
    const edgesFile = path.join(DATA_DIR, `edges_${timestamp}.csv`);
    fs.writeFileSync(edgesFile, edgesCSV);
    
    console.log(`📤 Graph exported to CSV: ${nodesFile} and ${edgesFile}`);
}

function exportToGEXF(graph, timestamp) {
    const gexf = `<?xml version="1.0" encoding="UTF-8"?>
<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">
    <meta lastmodifieddate="${new Date().toISOString()}">
        <creator>Facebook Social Graph Scraper</creator>
        <description>Social network graph extracted from Facebook</description>
    </meta>
    <graph mode="static" defaultedgetype="undirected">
        <attributes class="node">
            <attribute id="0" title="name" type="string"/>
            <attribute id="1" title="depth" type="integer"/>
            <attribute id="2" title="degree" type="integer"/>
            <attribute id="3" title="pagerank" type="float"/>
        </attributes>
        <nodes>
${graph.nodes.map(node => `            <node id="${node.id}" label="${node.name}">
                <attvalues>
                    <attvalue for="0" value="${node.name}"/>
                    <attvalue for="1" value="${node.depth}"/>
                    <attvalue for="2" value="${node.degree}"/>
                    <attvalue for="3" value="${node.pagerank}"/>
                </attvalues>
            </node>`).join('\n')}
        </nodes>
        <edges>
${graph.edges.map((edge, i) => `            <edge id="${i}" source="${edge.source}" target="${edge.target}"/>`).join('\n')}
        </edges>
    </graph>
</gexf>`;

    const gexfFile = path.join(DATA_DIR, `graph_${timestamp}.gexf`);
    fs.writeFileSync(gexfFile, gexf);
    console.log(`📤 Graph exported to GEXF: ${gexfFile}`);
}

// Main execution
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'build':
            buildGraph();
            break;
        case 'export':
            const format = process.argv[3] || 'json';
            exportGraph(format);
            break;
        case 'stats':
            const graph = readJSON(GRAPH_FILE);
            if (graph) printGraphStats(graph);
            break;
        default:
            console.log('Usage:');
            console.log('  node build-graph.js build    - Build graph from profiles');
            console.log('  node build-graph.js export [format]  - Export graph (json/csv/gexf)');
            console.log('  node build-graph.js stats    - Show graph statistics');
    }
}

module.exports = { buildGraph, exportGraph, printGraphStats };
