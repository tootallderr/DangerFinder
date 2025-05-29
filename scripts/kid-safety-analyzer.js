// Kid Safety Analyzer - Identifies dangerous patterns around children
const fs = require('fs');
const path = require('path');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'backend', 'data');
const GRAPH_FILE = path.join(DATA_DIR, 'graph.json');
const ANNOTATIONS_FILE = path.join(DATA_DIR, 'annotations.json');

class KidSafetyAnalyzer {
    constructor(graph, annotations) {
        this.graph = graph;
        this.annotations = annotations;
        this.nodes = graph.nodes;
        this.edges = graph.edges;
        this.adjList = this.buildAdjacencyList();
        
        // Safety thresholds
        this.DANGER_THRESHOLDS = {
            ADULT_KID_RATIO: 0.7,        // Adults with >70% kid friends
            KID_CONNECTIONS: 15,          // Kids connected to 15+ adults
            CONVICTED_CONNECTIONS: 3,     // Adults connected to 3+ convicted individuals
            ALIAS_KID_RATIO: 0.5,        // Aliases with >50% kid connections
            HIGH_RISK_PROXIMITY: 2       // Within 2 degrees of convicted predators
        };

        // Gravitational pull system for danger zones
        this.DANGER_PULL_CONFIG = {
            MAX_PULL_DISTANCE: 3,        // Maximum degrees of separation for danger pull
            CONVICTED_PULL_STRENGTH: 1.0, // Strongest pull from convicted predators
            HIGH_KID_RATIO_PULL: 0.8,    // Strong pull from adults targeting kids
            ALIAS_PREDATOR_PULL: 0.7,    // Pull from suspected alias predators
            NETWORK_AMPLIFIER: 1.5,      // Amplify pull when multiple dangers cluster
            DISTANCE_DECAY: 0.6          // How much pull decreases per degree of separation
        };
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

    // Main analysis function
    analyzeSafetyRisks() {
        console.log('🚨 Starting Kid Safety Analysis...');
        
        const analysis = {
            metadata: {
                analyzed_at: new Date().toISOString(),
                total_kids: 0,
                total_adults: 0,
                total_convicted: 0,
                total_flags: 0
            },
            danger_patterns: {
                adults_targeting_kids: [],
                vulnerable_kids: [],
                convicted_networks: [],
                alias_networks: [],
                high_risk_clusters: [],
                kids_in_danger_pull: [],
                danger_zones: []
            },
            safety_scores: new Map(),
            recommendations: []
        };

        // Categorize nodes by demographics and risk
        const categorizedNodes = this.categorizeNodes();
        analysis.metadata.total_kids = categorizedNodes.kids.length;
        analysis.metadata.total_adults = categorizedNodes.adults.length;
        analysis.metadata.total_convicted = categorizedNodes.convicted.length;

        // Analyze different danger patterns
        analysis.danger_patterns.adults_targeting_kids = this.findAdultsTargetingKids(categorizedNodes);
        analysis.danger_patterns.vulnerable_kids = this.findVulnerableKids(categorizedNodes);
        analysis.danger_patterns.convicted_networks = this.analyzeConvictedNetworks(categorizedNodes);
        analysis.danger_patterns.alias_networks = this.analyzeAliasNetworks(categorizedNodes);
        analysis.danger_patterns.high_risk_clusters = this.findHighRiskClusters(categorizedNodes);

        // NEW: Analyze gravitational pull from danger zones
        analysis.danger_patterns.kids_in_danger_pull = this.analyzeKidsInDangerPull(categorizedNodes);
        analysis.danger_patterns.danger_zones = this.mapDangerZones(categorizedNodes);

        // Calculate safety scores for all nodes
        this.calculateSafetyScores(categorizedNodes, analysis);

        // Generate recommendations
        analysis.recommendations = this.generateSafetyRecommendations(analysis);

        // Count total flags
        analysis.metadata.total_flags = Object.values(analysis.danger_patterns)
            .reduce((total, pattern) => total + (Array.isArray(pattern) ? pattern.length : 0), 0);

        return analysis;
    }

    categorizeNodes() {
        const categorized = {
            kids: [],
            adults: [],
            unknown: [],
            convicted: [],
            aliases: []
        };

        this.nodes.forEach(node => {
            const annotation = this.annotations[node.url];
            
            // Demographic classification
            if (annotation?.demographic === 'kids') {
                categorized.kids.push(node);
            } else if (annotation?.demographic === 'adult') {
                categorized.adults.push(node);
            } else {
                categorized.unknown.push(node);
            }

            // Risk classification
            if (annotation?.category === 'confirmed-conviction' || annotation?.risk === 'high') {
                categorized.convicted.push(node);
            }

            // Check for aliases (simplified - based on name similarity)
            const suspectedAlias = this.isSuspectedAlias(node);
            if (suspectedAlias) {
                categorized.aliases.push(node);
            }
        });

        return categorized;
    }

    isSuspectedAlias(node) {
        // Simple heuristics for alias detection
        const name = node.name?.toLowerCase() || '';
        
        // Common alias patterns
        const aliasPatterns = [
            /^\w+\s+\w+\s+\d{4}$/,           // FirstName LastName YYYY
            /^\w{3,}\s+[a-z]{1,3}$/,        // Word + short word
            /^[a-z]+\d+$/,                   // letters + numbers
            /^\w+\s+\w+\s+(jr|sr|ii|iii)$/i // Jr/Sr suffixes
        ];

        return aliasPatterns.some(pattern => pattern.test(name)) ||
               name.includes('fake') || name.includes('alias') ||
               node.profile_image === null || node.profile_image === '';
    }

    findAdultsTargetingKids(categorizedNodes) {
        console.log('🎯 Analyzing adults with high kid connection ratios...');
        
        const flaggedAdults = [];

        categorizedNodes.adults.forEach(adult => {
            const connections = this.adjList.get(adult.id) || [];
            if (connections.length < 5) return; // Skip low-connection accounts

            let kidConnections = 0;
            let adultConnections = 0;

            connections.forEach(connectionId => {
                const connectedNode = this.nodes.find(n => n.id === connectionId);
                if (!connectedNode) return;

                const annotation = this.annotations[connectedNode.url];
                if (annotation?.demographic === 'kids') {
                    kidConnections++;
                } else if (annotation?.demographic === 'adult') {
                    adultConnections++;
                }
            });

            const totalCategorized = kidConnections + adultConnections;
            if (totalCategorized < 3) return; // Skip if too few categorized connections

            const kidRatio = kidConnections / totalCategorized;
            const dangerScore = this.calculateDangerScore(adult, kidRatio, kidConnections);

            if (kidRatio >= this.DANGER_THRESHOLDS.ADULT_KID_RATIO) {
                flaggedAdults.push({
                    nodeId: adult.id,
                    name: adult.name,
                    url: adult.url,
                    kidConnections: kidConnections,
                    adultConnections: adultConnections,
                    kidRatio: kidRatio,
                    totalConnections: connections.length,
                    dangerScore: dangerScore,
                    riskLevel: dangerScore > 0.8 ? 'CRITICAL' : dangerScore > 0.6 ? 'HIGH' : 'MEDIUM',
                    flags: this.generateFlags(adult, kidRatio, kidConnections),
                    connectedKids: this.getConnectedKids(adult.id, categorizedNodes.kids)
                });
            }
        });

        return flaggedAdults.sort((a, b) => b.dangerScore - a.dangerScore);
    }

    findVulnerableKids(categorizedNodes) {
        console.log('👶 Analyzing vulnerable kids with high adult exposure...');
        
        const vulnerableKids = [];

        categorizedNodes.kids.forEach(kid => {
            const connections = this.adjList.get(kid.id) || [];
            let adultConnections = 0;
            let unknownConnections = 0;
            let convictedConnections = 0;

            const connectedAdults = [];

            connections.forEach(connectionId => {
                const connectedNode = this.nodes.find(n => n.id === connectionId);
                if (!connectedNode) return;

                const annotation = this.annotations[connectedNode.url];
                if (annotation?.demographic === 'adult') {
                    adultConnections++;
                    connectedAdults.push(connectedNode);
                    
                    if (annotation?.category === 'confirmed-conviction') {
                        convictedConnections++;
                    }
                } else if (!annotation?.demographic) {
                    unknownConnections++;
                }
            });

            const vulnerabilityScore = this.calculateVulnerabilityScore(
                adultConnections, unknownConnections, convictedConnections, connections.length
            );

            if (adultConnections >= this.DANGER_THRESHOLDS.KID_CONNECTIONS || 
                convictedConnections > 0 || 
                vulnerabilityScore > 0.6) {
                
                vulnerableKids.push({
                    nodeId: kid.id,
                    name: kid.name,
                    url: kid.url,
                    adultConnections: adultConnections,
                    unknownConnections: unknownConnections,
                    convictedConnections: convictedConnections,
                    totalConnections: connections.length,
                    vulnerabilityScore: vulnerabilityScore,
                    riskLevel: vulnerabilityScore > 0.8 ? 'CRITICAL' : vulnerabilityScore > 0.6 ? 'HIGH' : 'MEDIUM',
                    flags: this.generateKidFlags(kid, adultConnections, convictedConnections),
                    connectedAdults: connectedAdults.slice(0, 10) // Limit to top 10
                });
            }
        });

        return vulnerableKids.sort((a, b) => b.vulnerabilityScore - a.vulnerabilityScore);
    }

    analyzeConvictedNetworks(categorizedNodes) {
        console.log('⚖️ Analyzing networks around convicted individuals...');
        
        const convictedNetworks = [];

        categorizedNodes.convicted.forEach(convicted => {
            const network = this.analyzeConvictedPersonNetwork(convicted, categorizedNodes);
            if (network.totalRisk > 0.5) {
                convictedNetworks.push(network);
            }
        });

        return convictedNetworks.sort((a, b) => b.totalRisk - a.totalRisk);
    }

    analyzeConvictedPersonNetwork(convictedPerson, categorizedNodes) {
        const directConnections = this.adjList.get(convictedPerson.id) || [];
        const network = {
            convictedPerson: {
                id: convictedPerson.id,
                name: convictedPerson.name,
                url: convictedPerson.url,
                conviction: this.annotations[convictedPerson.url]
            },
            directConnections: {
                kids: [],
                adults: [],
                unknown: []
            },
            secondDegreeKids: [],
            totalRisk: 0,
            riskFactors: []
        };

        // Analyze direct connections
        directConnections.forEach(connectionId => {
            const connectedNode = this.nodes.find(n => n.id === connectionId);
            if (!connectedNode) return;

            const annotation = this.annotations[connectedNode.url];
            if (annotation?.demographic === 'kids') {
                network.directConnections.kids.push(connectedNode);
                network.riskFactors.push(`Direct connection to kid: ${connectedNode.name}`);
            } else if (annotation?.demographic === 'adult') {
                network.directConnections.adults.push(connectedNode);
                
                // Check if this adult is also connected to many kids
                const adultKidConnections = this.getConnectedKids(connectedNode.id, categorizedNodes.kids);
                if (adultKidConnections.length > 3) {
                    network.riskFactors.push(`Connected to adult with ${adultKidConnections.length} kid friends: ${connectedNode.name}`);
                }
            } else {
                network.directConnections.unknown.push(connectedNode);
            }
        });

        // Find second-degree kids (kids connected to adults connected to convicted person)
        network.directConnections.adults.forEach(adult => {
            const adultConnections = this.adjList.get(adult.id) || [];
            adultConnections.forEach(connectionId => {
                const connectedNode = this.nodes.find(n => n.id === connectionId);
                if (connectedNode && this.annotations[connectedNode.url]?.demographic === 'kids') {
                    network.secondDegreeKids.push({
                        kid: connectedNode,
                        throughAdult: adult
                    });
                }
            });
        });

        // Calculate total risk
        network.totalRisk = this.calculateNetworkRisk(network);

        return network;
    }

    analyzeAliasNetworks(categorizedNodes) {
        console.log('🎭 Analyzing alias networks with kid connections...');
        
        const aliasNetworks = [];

        categorizedNodes.aliases.forEach(alias => {
            const connections = this.adjList.get(alias.id) || [];
            let kidConnections = 0;
            let adultConnections = 0;

            connections.forEach(connectionId => {
                const connectedNode = this.nodes.find(n => n.id === connectionId);
                if (!connectedNode) return;

                const annotation = this.annotations[connectedNode.url];
                if (annotation?.demographic === 'kids') {
                    kidConnections++;
                } else if (annotation?.demographic === 'adult') {
                    adultConnections++;
                }
            });

            const totalCategorized = kidConnections + adultConnections;
            if (totalCategorized < 2) return;

            const kidRatio = kidConnections / totalCategorized;
            
            if (kidRatio >= this.DANGER_THRESHOLDS.ALIAS_KID_RATIO) {
                aliasNetworks.push({
                    aliasNode: alias,
                    kidConnections: kidConnections,
                    adultConnections: adultConnections,
                    kidRatio: kidRatio,
                    riskScore: kidRatio * (kidConnections / 10), // Higher score for more kids
                    riskLevel: kidRatio > 0.8 ? 'CRITICAL' : 'HIGH',
                    suspicionReasons: this.getAliasSuspicionReasons(alias)
                });
            }
        });

        return aliasNetworks.sort((a, b) => b.riskScore - a.riskScore);
    }

    findHighRiskClusters(categorizedNodes) {
        console.log('🕸️ Finding high-risk clusters...');
        
        const clusters = [];
        const processedNodes = new Set();

        categorizedNodes.convicted.forEach(convictedNode => {
            if (processedNodes.has(convictedNode.id)) return;

            const cluster = this.exploreRiskCluster(convictedNode, categorizedNodes, processedNodes);
            if (cluster.riskScore > 0.6) {
                clusters.push(cluster);
            }
        });

        return clusters.sort((a, b) => b.riskScore - a.riskScore);
    }

    exploreRiskCluster(startNode, categorizedNodes, processedNodes, visited = new Set(), depth = 0) {
        if (depth > 3 || visited.has(startNode.id)) {
            return { nodes: [], kids: [], riskScore: 0 };
        }

        visited.add(startNode.id);
        processedNodes.add(startNode.id);

        const cluster = {
            centerNode: startNode,
            nodes: [startNode],
            kids: [],
            adults: [],
            convicted: [],
            riskScore: 0
        };

        const connections = this.adjList.get(startNode.id) || [];
        
        connections.forEach(connectionId => {
            const connectedNode = this.nodes.find(n => n.id === connectionId);
            if (!connectedNode || visited.has(connectedNode.id)) return;

            const annotation = this.annotations[connectedNode.url];
            
            if (annotation?.demographic === 'kids') {
                cluster.kids.push(connectedNode);
                cluster.nodes.push(connectedNode);
            } else if (annotation?.demographic === 'adult') {
                cluster.adults.push(connectedNode);
                cluster.nodes.push(connectedNode);
                
                if (annotation?.category === 'confirmed-conviction') {
                    cluster.convicted.push(connectedNode);
                    
                    // Recursively explore convicted connections
                    const subCluster = this.exploreRiskCluster(connectedNode, categorizedNodes, processedNodes, visited, depth + 1);
                    cluster.nodes.push(...subCluster.nodes);
                    cluster.kids.push(...subCluster.kids);
                    cluster.adults.push(...subCluster.adults);
                    cluster.convicted.push(...subCluster.convicted);
                }
            }
        });

        // Calculate cluster risk score
        cluster.riskScore = this.calculateClusterRisk(cluster);

        return cluster;
    }

    calculateDangerScore(adult, kidRatio, kidConnections) {
        let score = kidRatio; // Base score from ratio
        
        // Increase score based on absolute number of kid connections
        score += Math.min(kidConnections / 20, 0.3); // Max 0.3 bonus
        
        // Check for conviction history
        const annotation = this.annotations[adult.url];
        if (annotation?.category === 'confirmed-conviction') {
            score += 0.4;
        } else if (annotation?.risk === 'high') {
            score += 0.2;
        }

        // Check for alias characteristics
        if (this.isSuspectedAlias(adult)) {
            score += 0.2;
        }

        // Age of account (if available)
        if (adult.depth > 3) { // Deeper profiles might be more suspicious
            score += 0.1;
        }

        return Math.min(score, 1.0);
    }

    calculateVulnerabilityScore(adultConnections, unknownConnections, convictedConnections, totalConnections) {
        let score = 0;

        // Base vulnerability from adult connections
        score += Math.min(adultConnections / 15, 0.5);

        // Heavy penalty for convicted connections
        score += convictedConnections * 0.3;

        // Penalty for unknown demographic connections
        score += Math.min(unknownConnections / 10, 0.2);

        // Factor in total exposure
        if (totalConnections > 50) {
            score += 0.1; // High exposure
        }

        return Math.min(score, 1.0);
    }

    calculateNetworkRisk(network) {
        let risk = 0;

        // Direct kid connections to convicted person
        risk += network.directConnections.kids.length * 0.3;

        // Second-degree kid exposure
        risk += network.secondDegreeKids.length * 0.1;

        // Adult connections that might be facilitators
        risk += Math.min(network.directConnections.adults.length / 10, 0.2);

        // Unknown connections (potential hidden risks)
        risk += Math.min(network.directConnections.unknown.length / 20, 0.1);

        return Math.min(risk, 1.0);
    }

    calculateClusterRisk(cluster) {
        let risk = 0;

        // Base risk from convicted individuals
        risk += cluster.convicted.length * 0.4;

        // Risk from kids in cluster
        risk += cluster.kids.length * 0.2;

        // Risk from density (interconnectedness)
        const totalNodes = cluster.nodes.length;
        if (totalNodes > 1) {
            const maxConnections = (totalNodes * (totalNodes - 1)) / 2;
            const actualConnections = this.countClusterConnections(cluster.nodes);
            const density = actualConnections / maxConnections;
            risk += density * 0.3;
        }

        return Math.min(risk, 1.0);
    }    calculateSafetyScores(categorizedNodes, analysis) {
        console.log('📊 Calculating safety scores for all nodes...');

        this.nodes.forEach(node => {
            let safetyScore = 0.5; // Neutral starting score
            const factors = [];

            // Demographic factors
            const annotation = this.annotations[node.url];
            if (annotation?.demographic === 'kids') {
                // Kids start with higher vulnerability
                safetyScore = 0.3;
                factors.push('Child profile');
                
                // Check for dangerous adult connections
                const adultConnections = this.getConnectedAdults(node.id, categorizedNodes.adults);
                if (adultConnections.length > 10) {
                    safetyScore -= 0.2;
                    factors.push(`${adultConnections.length} adult connections`);
                }

                // NEW: Apply gravitational pull effects for kids
                const kidInPull = analysis.danger_patterns.kids_in_danger_pull?.find(k => k.kid.id === node.id);
                if (kidInPull) {
                    const pullPenalty = kidInPull.totalPull * 0.5; // Convert pull to safety penalty
                    safetyScore -= pullPenalty;
                    factors.push(`Danger zone pull: ${kidInPull.totalPull.toFixed(2)} (${kidInPull.riskLevel})`);
                    
                    // Additional penalties for specific dangers
                    if (kidInPull.immediateDangers.length > 0) {
                        safetyScore -= 0.3;
                        factors.push(`${kidInPull.immediateDangers.length} immediate danger(s)`);
                    }
                    
                    if (kidInPull.flags.includes('DIRECT_CONVICTED_CONNECTION')) {
                        safetyScore -= 0.4;
                        factors.push('Directly connected to convicted predator');
                    }
                }
            } else if (annotation?.demographic === 'adult') {
                // Check if adult targets kids
                const kidConnections = this.getConnectedKids(node.id, categorizedNodes.kids);
                const totalConnections = (this.adjList.get(node.id) || []).length;
                
                if (totalConnections > 0) {
                    const kidRatio = kidConnections.length / totalConnections;
                    if (kidRatio > 0.5) {
                        safetyScore -= 0.4;
                        factors.push(`High kid connection ratio: ${(kidRatio * 100).toFixed(1)}%`);
                    }
                }

                // NEW: Check if this adult is a danger source
                const dangerSources = this.identifyDangerSources(categorizedNodes);
                const isDangerSource = dangerSources.find(d => d.nodeId === node.id);
                if (isDangerSource) {
                    safetyScore -= isDangerSource.basePullStrength * 0.6;
                    factors.push(`Danger source: ${isDangerSource.dangerType} (${isDangerSource.dangerLevel})`);
                }
            }

            // Conviction factors
            if (annotation?.category === 'confirmed-conviction') {
                safetyScore -= 0.5;
                factors.push('Confirmed conviction');
            } else if (annotation?.risk === 'high') {
                safetyScore -= 0.3;
                factors.push('High risk annotation');
            }

            // Proximity to convicted individuals
            const convictedProximity = this.getConvictedProximity(node.id, categorizedNodes.convicted);
            if (convictedProximity <= 2) {
                safetyScore -= (3 - convictedProximity) * 0.1;
                factors.push(`${convictedProximity} degrees from convicted individual`);
            }

            // Alias factors
            if (this.isSuspectedAlias(node)) {
                safetyScore -= 0.2;
                factors.push('Suspected alias account');
            }

            // Normalize score
            safetyScore = Math.max(0, Math.min(1, safetyScore));

            analysis.safety_scores.set(node.id, {
                score: safetyScore,
                level: safetyScore > 0.7 ? 'SAFE' : safetyScore > 0.4 ? 'CAUTION' : safetyScore > 0.2 ? 'DANGER' : 'CRITICAL',
                factors: factors
            });
        });
    }

    generateFlags(adult, kidRatio, kidConnections) {
        const flags = [];
        
        if (kidRatio > 0.8) flags.push('EXTREMELY_HIGH_KID_RATIO');
        if (kidConnections > 20) flags.push('EXCESSIVE_KID_CONNECTIONS');
        if (this.isSuspectedAlias(adult)) flags.push('SUSPECTED_ALIAS');
        
        const annotation = this.annotations[adult.url];
        if (annotation?.category === 'confirmed-conviction') flags.push('CONVICTED_PREDATOR');
        if (!adult.profile_image) flags.push('NO_PROFILE_IMAGE');
        
        return flags;
    }

    generateKidFlags(kid, adultConnections, convictedConnections) {
        const flags = [];
        
        if (convictedConnections > 0) flags.push('CONNECTED_TO_CONVICTED');
        if (adultConnections > 15) flags.push('HIGH_ADULT_EXPOSURE');
        if (adultConnections > 25) flags.push('EXCESSIVE_ADULT_EXPOSURE');
        
        return flags;
    }

    getAliasSuspicionReasons(alias) {
        const reasons = [];
        const name = alias.name?.toLowerCase() || '';
        
        if (/^\w+\s+\w+\s+\d{4}$/.test(name)) reasons.push('Name follows alias pattern (Name Year)');
        if (!alias.profile_image) reasons.push('No profile image');
        if (alias.depth > 2) reasons.push('Deep profile (might be fake)');
        if (name.length < 6) reasons.push('Very short name');
        
        return reasons;
    }    generateSafetyRecommendations(analysis) {
        const recommendations = [];

        // High-priority recommendations
        if (analysis.danger_patterns.adults_targeting_kids.length > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                type: 'INVESTIGATION',
                message: `${analysis.danger_patterns.adults_targeting_kids.length} adults show dangerous kid-targeting patterns`,
                action: 'Investigate these accounts immediately'
            });
        }

        // NEW: Danger pull recommendations
        if (analysis.danger_patterns.kids_in_danger_pull?.length > 0) {
            const criticalPullKids = analysis.danger_patterns.kids_in_danger_pull.filter(k => k.riskLevel === 'CRITICAL');
            const highPullKids = analysis.danger_patterns.kids_in_danger_pull.filter(k => k.riskLevel === 'HIGH');
            
            if (criticalPullKids.length > 0) {
                recommendations.push({
                    priority: 'CRITICAL',
                    type: 'IMMEDIATE_INTERVENTION',
                    message: `${criticalPullKids.length} children are in extreme danger zones`,
                    action: 'Immediate intervention required - children are being pulled toward multiple predators'
                });
            }
            
            if (highPullKids.length > 0) {
                recommendations.push({
                    priority: 'HIGH',
                    type: 'SAFETY_INTERVENTION',
                    message: `${highPullKids.length} children are in high-risk danger zones`,
                    action: 'Provide safety education and monitor connections closely'
                });
            }
        }

        // NEW: Danger zone mapping recommendations
        if (analysis.danger_patterns.danger_zones?.length > 0) {
            const highRiskZones = analysis.danger_patterns.danger_zones.filter(z => z.zoneRiskScore > 5);
            if (highRiskZones.length > 0) {
                recommendations.push({
                    priority: 'HIGH',
                    type: 'ZONE_MONITORING',
                    message: `${highRiskZones.length} high-risk danger zones identified`,
                    action: 'Monitor all activity within these zones and track new connections'
                });
            }
        }

        if (analysis.danger_patterns.vulnerable_kids.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                type: 'PROTECTION',
                message: `${analysis.danger_patterns.vulnerable_kids.length} children may be at risk`,
                action: 'Review these children\'s connections and consider safety interventions'
            });
        }

        if (analysis.danger_patterns.convicted_networks.length > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                type: 'MONITORING',
                message: `${analysis.danger_patterns.convicted_networks.length} active networks around convicted individuals`,
                action: 'Monitor these networks for ongoing activity'
            });
        }

        return recommendations;
    }

    // Helper methods
    getConnectedKids(nodeId, kids) {
        const connections = this.adjList.get(nodeId) || [];
        return kids.filter(kid => connections.includes(kid.id));
    }

    getConnectedAdults(nodeId, adults) {
        const connections = this.adjList.get(nodeId) || [];
        return adults.filter(adult => connections.includes(adult.id));
    }

    getConvictedProximity(nodeId, convicted) {
        // BFS to find shortest path to any convicted individual
        const queue = [{id: nodeId, distance: 0}];
        const visited = new Set([nodeId]);
        
        while (queue.length > 0) {
            const {id, distance} = queue.shift();
            
            if (distance > 3) break; // Limit search depth
            
            if (convicted.some(c => c.id === id) && id !== nodeId) {
                return distance;
            }
            
            const neighbors = this.adjList.get(id) || [];
            neighbors.forEach(neighborId => {
                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push({id: neighborId, distance: distance + 1});
                }
            });
        }
        
        return Infinity;
    }

    countClusterConnections(nodes) {
        const nodeIds = new Set(nodes.map(n => n.id));
        let connections = 0;
        
        nodes.forEach(node => {
            const neighbors = this.adjList.get(node.id) || [];
            neighbors.forEach(neighborId => {
                if (nodeIds.has(neighborId) && neighborId > node.id) { // Avoid double counting
                    connections++;
                }
            });
        });
        
        return connections;
    }

    // NEW: Analyze kids being pulled into danger zones
    analyzeKidsInDangerPull(categorizedNodes) {
        console.log('🌀 Analyzing gravitational pull from danger zones on children...');
        
        const kidsInDangerPull = [];
        
        // First, identify all danger sources (adults creating negative fields)
        const dangerSources = this.identifyDangerSources(categorizedNodes);
        
        categorizedNodes.kids.forEach(kid => {
            let totalPull = 0;
            const pullSources = [];
            
            // Calculate pull from each danger source
            dangerSources.forEach(dangerSource => {
                const distance = this.calculateShortestPath(kid.id, dangerSource.nodeId);
                
                if (distance <= this.DANGER_PULL_CONFIG.MAX_PULL_DISTANCE) {
                    // Calculate pull strength based on danger type and distance
                    const basePull = this.calculateBasePullStrength(dangerSource);
                    const distanceDecay = Math.pow(this.DANGER_PULL_CONFIG.DISTANCE_DECAY, distance - 1);
                    const pullStrength = basePull * distanceDecay;
                    
                    totalPull += pullStrength;
                    pullSources.push({
                        source: dangerSource,
                        distance: distance,
                        pullStrength: pullStrength,
                        pullType: dangerSource.dangerType
                    });
                }
            });
            
            // Apply network amplification if multiple dangers are close
            if (pullSources.length > 1) {
                totalPull *= this.DANGER_PULL_CONFIG.NETWORK_AMPLIFIER;
            }
            
            // Flag kids with significant danger pull
            if (totalPull > 0.3) { // Threshold for concerning pull
                const riskLevel = totalPull > 0.8 ? 'CRITICAL' : totalPull > 0.5 ? 'HIGH' : 'MEDIUM';
                
                kidsInDangerPull.push({
                    kid: kid,
                    totalPull: totalPull,
                    riskLevel: riskLevel,
                    pullSources: pullSources.sort((a, b) => b.pullStrength - a.pullStrength),
                    flags: this.generateKidPullFlags(kid, totalPull, pullSources),
                    escapeRoutes: this.findEscapeRoutes(kid, dangerSources),
                    immediateDangers: pullSources.filter(p => p.distance === 1)
                });
            }
        });
        
        return kidsInDangerPull.sort((a, b) => b.totalPull - a.totalPull);
    }

    // Identify sources of danger that create negative gravitational fields
    identifyDangerSources(categorizedNodes) {
        const dangerSources = [];
        
        // 1. Convicted predators (strongest danger field)
        categorizedNodes.convicted.forEach(convicted => {
            dangerSources.push({
                nodeId: convicted.id,
                node: convicted,
                dangerType: 'CONVICTED_PREDATOR',
                dangerLevel: 'CRITICAL',
                basePullStrength: this.DANGER_PULL_CONFIG.CONVICTED_PULL_STRENGTH,
                description: 'Confirmed predator conviction'
            });
        });
        
        // 2. Adults with high kid ratios (predatory targeting pattern)
        categorizedNodes.adults.forEach(adult => {
            const connections = this.adjList.get(adult.id) || [];
            if (connections.length < 5) return;
            
            const kidConnections = this.getConnectedKids(adult.id, categorizedNodes.kids).length;
            const adultConnections = this.getConnectedAdults(adult.id, categorizedNodes.adults).length;
            const totalCategorized = kidConnections + adultConnections;
            
            if (totalCategorized > 0) {
                const kidRatio = kidConnections / totalCategorized;
                
                if (kidRatio >= 0.7) { // High kid targeting
                    dangerSources.push({
                        nodeId: adult.id,
                        node: adult,
                        dangerType: 'HIGH_KID_TARGETING',
                        dangerLevel: kidRatio > 0.8 ? 'CRITICAL' : 'HIGH',
                        basePullStrength: this.DANGER_PULL_CONFIG.HIGH_KID_RATIO_PULL * kidRatio,
                        description: `${(kidRatio * 100).toFixed(1)}% kid connections (${kidConnections}/${totalCategorized})`,
                        kidCount: kidConnections
                    });
                }
            }
        });
        
        // 3. Suspected aliases targeting kids
        categorizedNodes.aliases.forEach(alias => {
            const connections = this.adjList.get(alias.id) || [];
            const kidConnections = this.getConnectedKids(alias.id, categorizedNodes.kids).length;
            const adultConnections = this.getConnectedAdults(alias.id, categorizedNodes.adults).length;
            const totalCategorized = kidConnections + adultConnections;
            
            if (totalCategorized > 0) {
                const kidRatio = kidConnections / totalCategorized;
                
                if (kidRatio >= 0.5) { // Alias targeting kids
                    dangerSources.push({
                        nodeId: alias.id,
                        node: alias,
                        dangerType: 'ALIAS_PREDATOR',
                        dangerLevel: kidRatio > 0.7 ? 'HIGH' : 'MEDIUM',
                        basePullStrength: this.DANGER_PULL_CONFIG.ALIAS_PREDATOR_PULL * kidRatio,
                        description: `Suspected alias with ${(kidRatio * 100).toFixed(1)}% kid connections`,
                        suspicionReasons: this.getAliasSuspicionReasons(alias)
                    });
                }
            }
        });
        
        // 4. Adults connected to multiple convicted individuals
        categorizedNodes.adults.forEach(adult => {
            const convictedConnections = categorizedNodes.convicted.filter(convicted => {
                const adultConnections = this.adjList.get(adult.id) || [];
                return adultConnections.includes(convicted.id);
            }).length;
            
            if (convictedConnections >= 2) { // Connected to multiple predators
                dangerSources.push({
                    nodeId: adult.id,
                    node: adult,
                    dangerType: 'PREDATOR_ASSOCIATE',
                    dangerLevel: convictedConnections >= 3 ? 'HIGH' : 'MEDIUM',
                    basePullStrength: 0.5 + (convictedConnections * 0.1),
                    description: `Connected to ${convictedConnections} convicted predators`,
                    convictedConnections: convictedConnections
                });
            }
        });
        
        return dangerSources.sort((a, b) => b.basePullStrength - a.basePullStrength);
    }

    // Calculate base pull strength for a danger source
    calculateBasePullStrength(dangerSource) {
        let basePull = dangerSource.basePullStrength;
        
        // Amplify based on danger level
        switch (dangerSource.dangerLevel) {
            case 'CRITICAL':
                basePull *= 1.2;
                break;
            case 'HIGH':
                basePull *= 1.0;
                break;
            case 'MEDIUM':
                basePull *= 0.8;
                break;
        }
        
        // Additional factors
        if (dangerSource.kidCount && dangerSource.kidCount > 20) {
            basePull *= 1.3; // Extra dangerous if targeting many kids
        }
        
        if (dangerSource.convictedConnections && dangerSource.convictedConnections > 3) {
            basePull *= 1.2; // Extra dangerous if connected to many predators
        }
        
        return Math.min(basePull, 1.0); // Cap at 1.0
    }

    // Calculate shortest path between two nodes
    calculateShortestPath(startId, endId) {
        if (startId === endId) return 0;
        
        const queue = [{id: startId, distance: 0}];
        const visited = new Set([startId]);
        
        while (queue.length > 0) {
            const {id, distance} = queue.shift();
            
            if (distance >= this.DANGER_PULL_CONFIG.MAX_PULL_DISTANCE) break;
            
            const neighbors = this.adjList.get(id) || [];
            for (const neighborId of neighbors) {
                if (neighborId === endId) {
                    return distance + 1;
                }
                
                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push({id: neighborId, distance: distance + 1});
                }
            }
        }
        
        return Infinity;
    }

    // Generate flags for kids experiencing danger pull
    generateKidPullFlags(kid, totalPull, pullSources) {
        const flags = [];
        
        if (totalPull > 0.8) flags.push('EXTREME_DANGER_PULL');
        if (totalPull > 0.5) flags.push('HIGH_DANGER_PULL');
        
        const convictedPull = pullSources.filter(p => p.pullType === 'CONVICTED_PREDATOR');
        if (convictedPull.length > 0) {
            flags.push('CONVICTED_PROXIMITY');
            if (convictedPull.some(p => p.distance === 1)) {
                flags.push('DIRECT_CONVICTED_CONNECTION');
            }
        }
        
        const multiplePredators = pullSources.filter(p => 
            ['CONVICTED_PREDATOR', 'HIGH_KID_TARGETING', 'ALIAS_PREDATOR'].includes(p.pullType)
        );
        if (multiplePredators.length > 2) {
            flags.push('MULTIPLE_PREDATOR_EXPOSURE');
        }
        
        const immediateDangers = pullSources.filter(p => p.distance === 1);
        if (immediateDangers.length > 1) {
            flags.push('MULTIPLE_IMMEDIATE_DANGERS');
        }
        
        return flags;
    }

    // Find escape routes for kids to get away from danger zones
    findEscapeRoutes(kid, dangerSources) {
        const escapeRoutes = [];
        const connections = this.adjList.get(kid.id) || [];
        
        connections.forEach(connectionId => {
            const connectedNode = this.nodes.find(n => n.id === connectionId);
            if (!connectedNode) return;
            
            // Check if this connection leads away from danger
            let routeDanger = 0;
            dangerSources.forEach(danger => {
                const distanceToDanger = this.calculateShortestPath(connectionId, danger.nodeId);
                if (distanceToDanger <= 2) {
                    routeDanger += danger.basePullStrength / distanceToDanger;
                }
            });
            
            const annotation = this.annotations[connectedNode.url];
            const isSafeAdult = annotation?.demographic === 'adult' && 
                              annotation?.category !== 'confirmed-conviction' &&
                              routeDanger < 0.2;
            
            if (isSafeAdult || annotation?.demographic === 'kids') {
                escapeRoutes.push({
                    node: connectedNode,
                    routeDanger: routeDanger,
                    isSafe: routeDanger < 0.1,
                    isAdultSupport: isSafeAdult
                });
            }
        });
        
        return escapeRoutes.sort((a, b) => a.routeDanger - b.routeDanger);
    }

    // Map all danger zones in the network
    mapDangerZones(categorizedNodes) {
        console.log('🗺️ Mapping danger zones across the network...');
        
        const dangerSources = this.identifyDangerSources(categorizedNodes);
        const dangerZones = [];
        
        dangerSources.forEach(source => {
            const zone = {
                epicenter: source,
                affectedNodes: [],
                riskRadius: this.DANGER_PULL_CONFIG.MAX_PULL_DISTANCE,
                totalKidsAffected: 0,
                zoneRiskScore: 0
            };
            
            // Find all nodes within the danger zone
            this.nodes.forEach(node => {
                const distance = this.calculateShortestPath(source.nodeId, node.id);
                if (distance <= this.DANGER_PULL_CONFIG.MAX_PULL_DISTANCE && distance > 0) {
                    const pullStrength = this.calculateBasePullStrength(source) * 
                                       Math.pow(this.DANGER_PULL_CONFIG.DISTANCE_DECAY, distance - 1);
                    
                    const annotation = this.annotations[node.url];
                    const affectedNode = {
                        node: node,
                        distance: distance,
                        pullStrength: pullStrength,
                        isKid: annotation?.demographic === 'kids'
                    };
                    
                    zone.affectedNodes.push(affectedNode);
                    
                    if (affectedNode.isKid) {
                        zone.totalKidsAffected++;
                        zone.zoneRiskScore += pullStrength * 2; // Kids count double
                    } else {
                        zone.zoneRiskScore += pullStrength;
                    }
                }
            });
            
            // Sort by pull strength (closest/most affected first)
            zone.affectedNodes.sort((a, b) => b.pullStrength - a.pullStrength);
            
            dangerZones.push(zone);
        });
        
        return dangerZones.sort((a, b) => b.zoneRiskScore - a.zoneRiskScore);
    }
}

// Main execution function
function runKidSafetyAnalysis() {
    console.log('🚨 Starting Kid Safety Analysis System...');
    
    try {
        // Load data
        const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
        const annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_FILE, 'utf8'));
        
        // Run analysis
        const analyzer = new KidSafetyAnalyzer(graph, annotations);
        const analysis = analyzer.analyzeSafetyRisks();
        
        // Save results
        const outputFile = path.join(DATA_DIR, 'kid_safety_analysis.json');
        fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2));
        
        // Generate summary report
        generateSafetyReport(analysis);
        
        console.log(`\n✅ Kid Safety Analysis completed!`);
        console.log(`📄 Results saved to: ${outputFile}`);
        console.log(`🚨 Total flags: ${analysis.metadata.total_flags}`);
        
        return analysis;
        
    } catch (error) {
        console.error('❌ Error during kid safety analysis:', error);
        return null;
    }
}

function generateSafetyReport(analysis) {
    let report = '🚨 KID SAFETY ANALYSIS REPORT\n';
    report += '================================\n\n';
    report += `Analysis Date: ${analysis.metadata.analyzed_at}\n`;
    report += `Total Children: ${analysis.metadata.total_kids}\n`;
    report += `Total Adults: ${analysis.metadata.total_adults}\n`;
    report += `Convicted Individuals: ${analysis.metadata.total_convicted}\n`;
    report += `Safety Flags: ${analysis.metadata.total_flags}\n\n`;

    report += '⚠️ CRITICAL FINDINGS\n';
    report += '-------------------\n';
    
    if (analysis.danger_patterns.adults_targeting_kids.length > 0) {
        report += `🎯 Adults Targeting Kids: ${analysis.danger_patterns.adults_targeting_kids.length}\n`;
        analysis.danger_patterns.adults_targeting_kids.slice(0, 5).forEach((adult, i) => {
            report += `  ${i+1}. ${adult.name} (${adult.kidConnections} kids, ${(adult.kidRatio*100).toFixed(1)}% ratio)\n`;
        });
        report += '\n';
    }

    if (analysis.danger_patterns.vulnerable_kids.length > 0) {
        report += `👶 Vulnerable Children: ${analysis.danger_patterns.vulnerable_kids.length}\n`;
        analysis.danger_patterns.vulnerable_kids.slice(0, 5).forEach((kid, i) => {
            report += `  ${i+1}. ${kid.name} (${kid.adultConnections} adults, ${kid.convictedConnections} convicted)\n`;
        });
        report += '\n';
    }    if (analysis.danger_patterns.kids_in_danger_pull && analysis.danger_patterns.kids_in_danger_pull.length > 0) {
        report += `🌀 Children in Danger Zones: ${analysis.danger_patterns.kids_in_danger_pull.length}\n`;
        const criticalPull = analysis.danger_patterns.kids_in_danger_pull.filter(k => k.riskLevel === 'CRITICAL');
        const highPull = analysis.danger_patterns.kids_in_danger_pull.filter(k => k.riskLevel === 'HIGH');
        
        if (criticalPull.length > 0) {
            report += `   🔴 CRITICAL DANGER PULL: ${criticalPull.length} children\n`;
            criticalPull.slice(0, 3).forEach((kid, i) => {
                report += `      ${i+1}. ${kid.kid.name} - Pull: ${kid.totalPull.toFixed(2)} (${kid.immediateDangers.length} immediate dangers)\n`;
            });
        }
        
        if (highPull.length > 0) {
            report += `   🟡 HIGH DANGER PULL: ${highPull.length} children\n`;
            highPull.slice(0, 3).forEach((kid, i) => {
                report += `      ${i+1}. ${kid.kid.name} - Pull: ${kid.totalPull.toFixed(2)} (${kid.pullSources.length} danger sources)\n`;
            });
        }
        report += '\n';
    }

    // NEW: Danger zones mapping
    if (analysis.danger_patterns.danger_zones && analysis.danger_patterns.danger_zones.length > 0) {
        report += `🗺️ Active Danger Zones: ${analysis.danger_patterns.danger_zones.length}\n`;
        analysis.danger_patterns.danger_zones.slice(0, 5).forEach((zone, i) => {
            report += `   ${i+1}. ${zone.epicenter.dangerType} - ${zone.totalKidsAffected} kids affected (Risk: ${zone.zoneRiskScore.toFixed(1)})\n`;
            report += `      Epicenter: ${zone.epicenter.node.name} (${zone.epicenter.dangerLevel})\n`;
        });
        report += '\n';
    }

    report += '📋 RECOMMENDATIONS\n';
    report += '-----------------\n';
    analysis.recommendations.forEach((rec, i) => {
        report += `${i+1}. [${rec.priority}] ${rec.message}\n`;
        report += `   Action: ${rec.action}\n\n`;
    });

    console.log(report);
    
    // Save text report
    const reportFile = path.join(DATA_DIR, 'kid_safety_report.txt');
    fs.writeFileSync(reportFile, report);
    console.log(`📄 Text report saved to: ${reportFile}`);
}

// Export for use as module
module.exports = { KidSafetyAnalyzer, runKidSafetyAnalysis };

// Run if called directly
if (require.main === module) {
    runKidSafetyAnalysis();
}
