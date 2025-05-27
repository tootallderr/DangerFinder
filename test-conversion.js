const fs = require('fs');
const path = require('path');

const readJSON = (filePath) => {
    try {
        console.log('Reading file:', filePath);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        console.log('File read successfully');
        return data;
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error.message);
        return null;
    }
};

try {
    // Test the conversion logic
    const GRAPH_FILE = path.join(__dirname, 'backend', 'data', 'graph.json');
    console.log('Graph file path:', GRAPH_FILE);
    
    const graph = readJSON(GRAPH_FILE) || { nodes: [], edges: [] };

    console.log('Original format:');
    console.log('- Nodes count:', graph.nodes?.length || 0);
    console.log('- Edges count:', graph.edges?.length || 0);
    
    if (graph.nodes && graph.nodes.length > 0) {
        console.log('- First node:', JSON.stringify(graph.nodes[0], null, 2).substring(0, 200) + '...');
    }
    if (graph.edges && graph.edges.length > 0) {
        console.log('- First edge:', graph.edges[0]);
    }

    // Convert to format expected by visualizer
    const visualizerFormat = {
        nodes: {},
        adjacency_list: {}
    };

    // Convert nodes array to object
    if (graph.nodes) {
        graph.nodes.forEach(node => {
            visualizerFormat.nodes[node.id] = {
                name: node.name,
                url: node.url,
                profile_image: node.image || node.profile_image || '',
                depth: node.depth || 0,
                pagerank: node.pagerank || 0,
                betweenness: node.betweenness || 0,
                community: node.community || 0,
                ...node.data
            };
            
            // Initialize adjacency list
            visualizerFormat.adjacency_list[node.id] = [];
        });
    }

    // Convert edges to adjacency list
    if (graph.edges) {
        graph.edges.forEach(edge => {
            const source = edge.source;
            const target = edge.target;
            
            if (visualizerFormat.adjacency_list[source]) {
                visualizerFormat.adjacency_list[source].push(target);
            }
            
            // Add reverse edge for undirected graph
            if (visualizerFormat.adjacency_list[target]) {
                visualizerFormat.adjacency_list[target].push(source);
            }
        });
    }

    console.log('\nConverted format:');
    console.log('- Nodes object keys:', Object.keys(visualizerFormat.nodes).length);
    console.log('- Adjacency list keys:', Object.keys(visualizerFormat.adjacency_list).length);
    const firstNodeId = Object.keys(visualizerFormat.nodes)[0];
    if (firstNodeId) {
        console.log('- First node ID:', firstNodeId);
        console.log('- First node data:', JSON.stringify(visualizerFormat.nodes[firstNodeId], null, 2).substring(0, 200) + '...');
        console.log('- First adjacency count:', visualizerFormat.adjacency_list[firstNodeId].length);
        console.log('- First adjacency sample:', visualizerFormat.adjacency_list[firstNodeId].slice(0, 3));
    }
    
    console.log('\nConversion completed successfully!');
    
} catch (error) {
    console.error('Error in conversion:', error);
}
