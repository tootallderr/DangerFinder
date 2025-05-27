const fs = require('fs');
const path = require('path');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'backend', 'data');
const GRAPH_FILE = path.join(DATA_DIR, 'graph.json');

// Community detection algorithms
class CommunityAnalyzer {
    constructor(graph) {
        this.graph = graph;
        this.nodes = graph.nodes;
        this.edges = graph.edges;
        this.adjList = this.buildAdjacencyList();
    }

    buildAdjacencyList() {
        const adjList = new Map();
        this.nodes.forEach(node => adjList.set(node.id, []));
        
        this.edges.forEach(edge => {
            if (adjList.has(edge.source)) adjList.get(edge.source).push(edge.target);
            if (adjList.has(edge.target)) adjList.get(edge.target).push(edge.source);
        });
        
        return adjList;
    }

    // Louvain algorithm for community detection (simplified)
    detectCommunities() {
        console.log('🔍 Detecting communities using Louvain algorithm...');
        
        // Initialize: each node in its own community
        const communities = new Map();
        this.nodes.forEach((node, index) => {
            communities.set(node.id, index);
        });

        let improved = true;
        let iteration = 0;
        const maxIterations = 10;

        while (improved && iteration < maxIterations) {
            improved = false;
            iteration++;
            console.log(`  Iteration ${iteration}...`);

            // For each node, try moving to neighbor communities
            for (const node of this.nodes) {
                const nodeId = node.id;
                const currentCommunity = communities.get(nodeId);
                const neighbors = this.adjList.get(nodeId) || [];
                
                // Calculate current modularity
                const currentModularity = this.calculateNodeModularity(nodeId, currentCommunity, communities);
                
                // Find best community among neighbors
                const neighborCommunities = new Set();
                neighbors.forEach(neighbor => {
                    neighborCommunities.add(communities.get(neighbor));
                });

                let bestCommunity = currentCommunity;
                let bestModularity = currentModularity;

                neighborCommunities.forEach(community => {
                    if (community !== currentCommunity) {
                        const modularity = this.calculateNodeModularity(nodeId, community, communities);
                        if (modularity > bestModularity) {
                            bestModularity = modularity;
                            bestCommunity = community;
                        }
                    }
                });

                // Move node to best community if improvement found
                if (bestCommunity !== currentCommunity) {
                    communities.set(nodeId, bestCommunity);
                    improved = true;
                }
            }
        }

        return this.organizeCommunities(communities);
    }

    calculateNodeModularity(nodeId, community, communities) {
        // Simplified modularity calculation
        const neighbors = this.adjList.get(nodeId) || [];
        const degree = neighbors.length;
        
        if (degree === 0) return 0;

        let internalEdges = 0;
        neighbors.forEach(neighbor => {
            if (communities.get(neighbor) === community) {
                internalEdges++;
            }
        });

        return internalEdges / degree;
    }

    organizeCommunities(communityAssignments) {
        const communities = new Map();
        
        // Group nodes by community
        communityAssignments.forEach((community, nodeId) => {
            if (!communities.has(community)) {
                communities.set(community, []);
            }
            communities.get(community).push(nodeId);
        });

        // Filter out small communities and renumber
        const validCommunities = [];
        let communityIndex = 0;

        communities.forEach((members, id) => {
            if (members.length >= 2) { // Minimum community size
                validCommunities.push({
                    id: communityIndex++,
                    members: members,
                    size: members.length
                });
            }
        });

        return validCommunities;
    }

    // Find bridge nodes (nodes connecting different communities)
    findBridgeNodes(communities) {
        console.log('🌉 Finding bridge nodes...');
        
        const nodeToComm = new Map();
        communities.forEach(comm => {
            comm.members.forEach(nodeId => {
                nodeToComm.set(nodeId, comm.id);
            });
        });

        const bridgeNodes = [];

        this.nodes.forEach(node => {
            const nodeId = node.id;
            const nodeComm = nodeToComm.get(nodeId);
            const neighbors = this.adjList.get(nodeId) || [];
            
            const connectedCommunities = new Set();
            neighbors.forEach(neighbor => {
                const neighborComm = nodeToComm.get(neighbor);
                if (neighborComm !== undefined && neighborComm !== nodeComm) {
                    connectedCommunities.add(neighborComm);
                }
            });

            if (connectedCommunities.size > 0) {
                bridgeNodes.push({
                    nodeId: nodeId,
                    name: node.name,
                    ownCommunity: nodeComm,
                    connectedCommunities: Array.from(connectedCommunities),
                    bridgeScore: connectedCommunities.size / neighbors.length
                });
            }
        });

        return bridgeNodes.sort((a, b) => b.bridgeScore - a.bridgeScore);
    }

    // Calculate community statistics
    calculateCommunityStats(communities) {
        console.log('📊 Calculating community statistics...');
        
        const stats = communities.map(comm => {
            const members = comm.members.map(nodeId => 
                this.nodes.find(n => n.id === nodeId)
            ).filter(n => n);

            // Internal edges
            let internalEdges = 0;
            let externalEdges = 0;

            members.forEach(node => {
                const neighbors = this.adjList.get(node.id) || [];
                neighbors.forEach(neighbor => {
                    if (comm.members.includes(neighbor)) {
                        internalEdges++;
                    } else {
                        externalEdges++;
                    }
                });
            });

            internalEdges = internalEdges / 2; // Undirected edges counted twice

            // Calculate metrics
            const totalPossibleEdges = (comm.size * (comm.size - 1)) / 2;
            const density = totalPossibleEdges > 0 ? internalEdges / totalPossibleEdges : 0;
            const conductance = (internalEdges + externalEdges) > 0 ? 
                externalEdges / (internalEdges + externalEdges) : 0;

            // Average metrics
            const avgDegree = members.reduce((sum, node) => sum + node.degree, 0) / members.length;
            const avgPageRank = members.reduce((sum, node) => sum + (node.pagerank || 0), 0) / members.length;

            // Depth distribution
            const depthDist = {};
            members.forEach(node => {
                const depth = node.depth || 1;
                depthDist[depth] = (depthDist[depth] || 0) + 1;
            });

            return {
                id: comm.id,
                size: comm.size,
                members: members.map(n => ({ id: n.id, name: n.name, degree: n.degree })),
                internalEdges: internalEdges,
                externalEdges: externalEdges,
                density: density,
                conductance: conductance,
                avgDegree: avgDegree,
                avgPageRank: avgPageRank,
                depthDistribution: depthDist,
                topMembers: members.sort((a, b) => b.degree - a.degree).slice(0, 5)
            };
        });

        return stats.sort((a, b) => b.size - a.size);
    }

    // Find influential nodes within communities
    findInfluentialNodes(communities) {
        const influential = [];

        communities.forEach(comm => {
            const members = comm.members.map(nodeId => 
                this.nodes.find(n => n.id === nodeId)
            ).filter(n => n);

            // Sort by combined influence score
            const rankedMembers = members.map(node => {
                const degreeScore = node.degree / Math.max(...members.map(n => n.degree));
                const pageRankScore = (node.pagerank || 0) / Math.max(...members.map(n => n.pagerank || 0));
                const betweennessScore = (node.betweenness || 0) / Math.max(...members.map(n => n.betweenness || 0));
                
                return {
                    ...node,
                    community: comm.id,
                    influenceScore: (degreeScore + pageRankScore + betweennessScore) / 3
                };
            }).sort((a, b) => b.influenceScore - a.influenceScore);

            influential.push({
                communityId: comm.id,
                communitySize: comm.size,
                topInfluencers: rankedMembers.slice(0, 3)
            });
        });

        return influential;
    }

    // Detect overlapping communities (nodes that bridge communities)
    detectOverlappingCommunities(communities, bridgeNodes) {
        const overlapping = [];
        
        // Nodes that are bridges might belong to multiple communities
        bridgeNodes.forEach(bridge => {
            if (bridge.connectedCommunities.length >= 2) {
                overlapping.push({
                    nodeId: bridge.nodeId,
                    name: bridge.name,
                    primaryCommunity: bridge.ownCommunity,
                    secondaryCommunities: bridge.connectedCommunities,
                    overlapScore: bridge.bridgeScore
                });
            }
        });

        return overlapping.sort((a, b) => b.overlapScore - a.overlapScore);
    }
}

// Main analysis function
function analyzeCommunities() {
    console.log('🔬 Starting community analysis...');
    
    // Read graph data
    const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    if (!graph || !graph.nodes || !graph.edges) {
        console.error('❌ Invalid graph data');
        return null;
    }

    const analyzer = new CommunityAnalyzer(graph);
    
    // Detect communities
    const communities = analyzer.detectCommunities();
    console.log(`✅ Found ${communities.length} communities`);

    // Find bridge nodes
    const bridgeNodes = analyzer.findBridgeNodes(communities);
    console.log(`🌉 Found ${bridgeNodes.length} bridge nodes`);

    // Calculate statistics
    const communityStats = analyzer.calculateCommunityStats(communities);
    
    // Find influential nodes
    const influentialNodes = analyzer.findInfluentialNodes(communities);
    
    // Detect overlapping communities
    const overlappingNodes = analyzer.detectOverlappingCommunities(communities, bridgeNodes);

    // Compile analysis results
    const analysis = {
        metadata: {
            analyzed_at: new Date().toISOString(),
            total_communities: communities.length,
            total_bridge_nodes: bridgeNodes.length,
            total_overlapping_nodes: overlappingNodes.length,
            algorithm: 'Louvain (simplified)',
            graph_stats: {
                nodes: graph.nodes.length,
                edges: graph.edges.length
            }
        },
        communities: communityStats,
        bridge_nodes: bridgeNodes.slice(0, 20), // Top 20 bridge nodes
        influential_nodes: influentialNodes,
        overlapping_nodes: overlappingNodes.slice(0, 10), // Top 10 overlapping nodes
        network_insights: generateNetworkInsights(communityStats, bridgeNodes)
    };

    // Save analysis results
    const analysisFile = path.join(DATA_DIR, 'community_analysis.json');
    fs.writeFileSync(analysisFile, JSON.stringify(analysis, null, 2));
    console.log(`📄 Analysis saved to ${analysisFile}`);

    // Print summary
    printAnalysisSummary(analysis);
    
    return analysis;
}

function generateNetworkInsights(communities, bridgeNodes) {
    const insights = [];

    // Community size insights
    const largeCommunities = communities.filter(c => c.size >= 10);
    if (largeCommunities.length > 0) {
        insights.push({
            type: 'large_communities',
            description: `Found ${largeCommunities.length} large communities (10+ members)`,
            details: largeCommunities.map(c => ({ id: c.id, size: c.size }))
        });
    }

    // Density insights
    const denseCommunities = communities.filter(c => c.density > 0.5);
    if (denseCommunities.length > 0) {
        insights.push({
            type: 'dense_communities',
            description: `${denseCommunities.length} communities are highly connected (density > 0.5)`,
            details: denseCommunities.map(c => ({ id: c.id, density: c.density.toFixed(3) }))
        });
    }

    // Bridge insights
    const strongBridges = bridgeNodes.filter(b => b.bridgeScore > 0.3);
    if (strongBridges.length > 0) {
        insights.push({
            type: 'strong_bridges',
            description: `${strongBridges.length} nodes are strong bridges between communities`,
            details: strongBridges.slice(0, 5).map(b => ({ 
                name: b.name, 
                score: b.bridgeScore.toFixed(3) 
            }))
        });
    }

    // Community isolation
    const isolatedCommunities = communities.filter(c => c.conductance < 0.1);
    if (isolatedCommunities.length > 0) {
        insights.push({
            type: 'isolated_communities',
            description: `${isolatedCommunities.length} communities are relatively isolated`,
            details: isolatedCommunities.map(c => ({ id: c.id, conductance: c.conductance.toFixed(3) }))
        });
    }

    return insights;
}

function printAnalysisSummary(analysis) {
    console.log('\n🎯 COMMUNITY ANALYSIS SUMMARY');
    console.log('=============================');
    console.log(`Total Communities: ${analysis.metadata.total_communities}`);
    console.log(`Bridge Nodes: ${analysis.metadata.total_bridge_nodes}`);
    console.log(`Overlapping Nodes: ${analysis.metadata.total_overlapping_nodes}`);

    console.log('\n📏 Community Size Distribution:');
    analysis.communities.forEach((comm, index) => {
        if (index < 10) { // Show top 10
            console.log(`  Community ${comm.id}: ${comm.size} members (density: ${comm.density.toFixed(3)})`);
        }
    });

    console.log('\n🌉 Top Bridge Nodes:');
    analysis.bridge_nodes.slice(0, 5).forEach((bridge, index) => {
        console.log(`  ${index + 1}. ${bridge.name} (connects ${bridge.connectedCommunities.length} communities)`);
    });

    console.log('\n💡 Network Insights:');
    analysis.network_insights.forEach(insight => {
        console.log(`  • ${insight.description}`);
    });

    // Export summary report
    const report = generateTextReport(analysis);
    const reportFile = path.join(DATA_DIR, 'community_report.txt');
    fs.writeFileSync(reportFile, report);
    console.log(`\n📋 Detailed report saved to ${reportFile}`);
}

function generateTextReport(analysis) {
    let report = 'FACEBOOK SOCIAL GRAPH - COMMUNITY ANALYSIS REPORT\n';
    report += '=================================================\n\n';
    report += `Analysis Date: ${analysis.metadata.analyzed_at}\n`;
    report += `Algorithm: ${analysis.metadata.algorithm}\n`;
    report += `Graph Size: ${analysis.metadata.graph_stats.nodes} nodes, ${analysis.metadata.graph_stats.edges} edges\n\n`;

    report += 'COMMUNITY OVERVIEW\n';
    report += '------------------\n';
    report += `Total Communities Found: ${analysis.metadata.total_communities}\n`;
    report += `Average Community Size: ${(analysis.communities.reduce((sum, c) => sum + c.size, 0) / analysis.communities.length).toFixed(1)}\n`;
    report += `Largest Community: ${Math.max(...analysis.communities.map(c => c.size))} members\n`;
    report += `Smallest Community: ${Math.min(...analysis.communities.map(c => c.size))} members\n\n`;

    report += 'TOP 10 COMMUNITIES BY SIZE\n';
    report += '-------------------------\n';
    analysis.communities.slice(0, 10).forEach((comm, index) => {
        report += `${index + 1}. Community ${comm.id}: ${comm.size} members\n`;
        report += `   Internal Edges: ${comm.internalEdges}, Density: ${comm.density.toFixed(3)}\n`;
        report += `   Top Members: ${comm.topMembers.map(m => m.name).join(', ')}\n\n`;
    });

    report += 'BRIDGE NODES (Top 15)\n';
    report += '--------------------\n';
    analysis.bridge_nodes.slice(0, 15).forEach((bridge, index) => {
        report += `${index + 1}. ${bridge.name}\n`;
        report += `   Bridge Score: ${bridge.bridgeScore.toFixed(3)}\n`;
        report += `   Connects Communities: ${bridge.connectedCommunities.join(', ')}\n\n`;
    });

    report += 'NETWORK INSIGHTS\n';
    report += '---------------\n';
    analysis.network_insights.forEach(insight => {
        report += `• ${insight.description}\n`;
    });

    return report;
}

// Export communities for visualization
function exportCommunities(format = 'json') {
    const analysisFile = path.join(DATA_DIR, 'community_analysis.json');
    if (!fs.existsSync(analysisFile)) {
        console.error('❌ No community analysis found. Run analysis first.');
        return;
    }

    const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    switch (format.toLowerCase()) {
        case 'json':
            // Already saved
            console.log(`📤 Communities available in ${analysisFile}`);
            break;
            
        case 'csv':
            exportCommunitiesToCSV(analysis, timestamp);
            break;
            
        case 'gephi':
            exportForGephi(analysis, timestamp);
            break;
            
        default:
            console.error('❌ Unsupported format. Use: json, csv, or gephi');
    }
}

function exportCommunitiesToCSV(analysis, timestamp) {
    // Community nodes CSV
    let csv = 'node_id,name,community,community_size,degree,pagerank,is_bridge\n';
    
    analysis.communities.forEach(comm => {
        comm.members.forEach(member => {
            const isBridge = analysis.bridge_nodes.some(b => b.nodeId === member.id);
            csv += `"${member.id}","${member.name}",${comm.id},${comm.size},${member.degree},${member.pagerank || 0},${isBridge}\n`;
        });
    });

    const csvFile = path.join(DATA_DIR, `communities_${timestamp}.csv`);
    fs.writeFileSync(csvFile, csv);
    console.log(`📤 Communities exported to ${csvFile}`);
}

function exportForGephi(analysis, timestamp) {
    // Create Gephi-compatible files with community attributes
    const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    
    // Add community info to nodes
    const nodeCommMap = new Map();
    analysis.communities.forEach(comm => {
        comm.members.forEach(member => {
            nodeCommMap.set(member.id, comm.id);
        });
    });

    graph.nodes.forEach(node => {
        node.community = nodeCommMap.get(node.id) || -1;
    });

    const gephiFile = path.join(DATA_DIR, `graph_with_communities_${timestamp}.json`);
    fs.writeFileSync(gephiFile, JSON.stringify(graph, null, 2));
    console.log(`📤 Gephi-ready graph exported to ${gephiFile}`);
}

// Main execution
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'analyze':
            analyzeCommunities();
            break;
        case 'export':
            const format = process.argv[3] || 'json';
            exportCommunities(format);
            break;
        case 'report':
            const analysisFile = path.join(DATA_DIR, 'community_analysis.json');
            if (fs.existsSync(analysisFile)) {
                const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
                printAnalysisSummary(analysis);
            } else {
                console.error('❌ No analysis found. Run analyze first.');
            }
            break;
        default:
            console.log('Usage:');
            console.log('  node analyze-communities.js analyze    - Analyze communities');
            console.log('  node analyze-communities.js export [format]  - Export results');
            console.log('  node analyze-communities.js report     - Show analysis summary');
    }
}

module.exports = { analyzeCommunities, exportCommunities };
