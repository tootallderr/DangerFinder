// Test script for the new gravitational pull danger detection system
const { KidSafetyAnalyzer } = require('./kid-safety-analyzer.js');
const fs = require('fs');
const path = require('path');

// Create mock data to test the danger pull system
function createTestData() {
    console.log('🧪 Creating test data for danger pull analysis...');
    
    const mockGraph = {
        nodes: [
            // Kids
            { id: 'kid1', name: 'Sarah Johnson', url: 'https://facebook.com/sarah_j', depth: 1 },
            { id: 'kid2', name: 'Tommy Chen', url: 'https://facebook.com/tommy_c', depth: 1 },
            { id: 'kid3', name: 'Emma Davis', url: 'https://facebook.com/emma_d', depth: 1 },
            { id: 'kid4', name: 'Alex Rodriguez', url: 'https://facebook.com/alex_r', depth: 1 },
            
            // Normal adults
            { id: 'adult1', name: 'Mary Teacher', url: 'https://facebook.com/mary_teacher', depth: 1 },
            { id: 'adult2', name: 'Bob Parent', url: 'https://facebook.com/bob_parent', depth: 1 },
            
            // Dangerous adults
            { id: 'predator1', name: 'John Convicted', url: 'https://facebook.com/john_conv', depth: 1 },
            { id: 'targeting1', name: 'Mike Targeter', url: 'https://facebook.com/mike_target', depth: 1 },
            { id: 'alias1', name: 'Jake Smith 2023', url: 'https://facebook.com/jake_2023', depth: 2 },
            { id: 'associate1', name: 'Dave Associate', url: 'https://facebook.com/dave_assoc', depth: 1 }
        ],
        edges: [
            // Dangerous connections
            { source: 'kid1', target: 'predator1' },      // Kid directly connected to convicted predator
            { source: 'kid1', target: 'targeting1' },     // Kid connected to adult targeting kids
            { source: 'kid2', target: 'associate1' },     // Kid connected to predator associate
            { source: 'kid3', target: 'alias1' },         // Kid connected to suspicious alias
            
            // Predator network
            { source: 'predator1', target: 'associate1' }, // Associate connected to convicted
            { source: 'targeting1', target: 'associate1' }, // Targeting adult connected to associate
            
            // Targeting pattern for 'targeting1'
            { source: 'targeting1', target: 'kid1' },
            { source: 'targeting1', target: 'kid2' },
            { source: 'targeting1', target: 'kid3' },
            { source: 'targeting1', target: 'kid4' },
            
            // Alias targeting pattern
            { source: 'alias1', target: 'kid3' },
            { source: 'alias1', target: 'kid4' },
            
            // Some safe connections
            { source: 'kid1', target: 'adult1' },
            { source: 'kid2', target: 'adult2' },
            { source: 'adult1', target: 'adult2' }
        ]
    };
    
    const mockAnnotations = {
        'https://facebook.com/sarah_j': { demographic: 'kids' },
        'https://facebook.com/tommy_c': { demographic: 'kids' },
        'https://facebook.com/emma_d': { demographic: 'kids' },
        'https://facebook.com/alex_r': { demographic: 'kids' },
        
        'https://facebook.com/mary_teacher': { demographic: 'adult', category: 'safe' },
        'https://facebook.com/bob_parent': { demographic: 'adult', category: 'safe' },
        
        'https://facebook.com/john_conv': { 
            demographic: 'adult', 
            category: 'confirmed-conviction',
            risk: 'high',
            conviction_details: 'Child endangerment - 2019'
        },
        'https://facebook.com/mike_target': { demographic: 'adult' },
        'https://facebook.com/jake_2023': { demographic: 'adult' },
        'https://facebook.com/dave_assoc': { demographic: 'adult' }
    };
    
    return { mockGraph, mockAnnotations };
}

function runDangerPullTest() {
    console.log('🚨 Testing Gravitational Danger Pull System');
    console.log('============================================\n');
    
    const { mockGraph, mockAnnotations } = createTestData();
    
    // Initialize analyzer
    const analyzer = new KidSafetyAnalyzer(mockGraph, mockAnnotations);
    
    // Run analysis
    const analysis = analyzer.analyzeSafetyRisks();
    
    console.log('📊 DANGER PULL ANALYSIS RESULTS');
    console.log('--------------------------------\n');
    
    // Display danger sources
    console.log('🌪️ IDENTIFIED DANGER SOURCES:');
    const dangerSources = analyzer.identifyDangerSources(analyzer.categorizeNodes());
    dangerSources.forEach((source, i) => {
        console.log(`${i+1}. ${source.node.name}`);
        console.log(`   Type: ${source.dangerType}`);
        console.log(`   Level: ${source.dangerLevel}`);
        console.log(`   Pull Strength: ${source.basePullStrength.toFixed(2)}`);
        console.log(`   Description: ${source.description}\n`);
    });
    
    // Display kids in danger pull
    console.log('🌀 CHILDREN EXPERIENCING DANGER PULL:');
    if (analysis.danger_patterns.kids_in_danger_pull.length === 0) {
        console.log('   No children detected in danger pull zones.\n');
    } else {
        analysis.danger_patterns.kids_in_danger_pull.forEach((kid, i) => {
            console.log(`${i+1}. ${kid.kid.name}`);
            console.log(`   Total Pull: ${kid.totalPull.toFixed(3)}`);
            console.log(`   Risk Level: ${kid.riskLevel}`);
            console.log(`   Immediate Dangers: ${kid.immediateDangers.length}`);
            console.log(`   Pull Sources: ${kid.pullSources.length}`);
            
            // Show specific pull sources
            kid.pullSources.slice(0, 3).forEach((source, j) => {
                console.log(`     ${j+1}. ${source.source.dangerType} at distance ${source.distance}`);
                console.log(`        Pull: ${source.pullStrength.toFixed(3)} from ${source.source.node.name}`);
            });
            
            // Show flags
            if (kid.flags.length > 0) {
                console.log(`   Flags: ${kid.flags.join(', ')}`);
            }
            
            // Show escape routes
            if (kid.escapeRoutes.length > 0) {
                console.log(`   Escape Routes: ${kid.escapeRoutes.length} found`);
                kid.escapeRoutes.slice(0, 2).forEach((route, j) => {
                    console.log(`     ${j+1}. ${route.node.name} (danger: ${route.routeDanger.toFixed(3)})`);
                });
            }
            console.log('');
        });
    }
    
    // Display danger zones
    console.log('🗺️ MAPPED DANGER ZONES:');
    if (analysis.danger_patterns.danger_zones.length === 0) {
        console.log('   No danger zones detected.\n');
    } else {
        analysis.danger_patterns.danger_zones.forEach((zone, i) => {
            console.log(`${i+1}. Zone centered on ${zone.epicenter.node.name}`);
            console.log(`   Epicenter Type: ${zone.epicenter.dangerType}`);
            console.log(`   Kids Affected: ${zone.totalKidsAffected}`);
            console.log(`   Zone Risk Score: ${zone.zoneRiskScore.toFixed(2)}`);
            console.log(`   Affected Nodes: ${zone.affectedNodes.length}`);
            
            // Show most affected nodes
            const topAffected = zone.affectedNodes.slice(0, 3);
            topAffected.forEach((node, j) => {
                const nodeType = node.isKid ? '👶' : '👤';
                console.log(`     ${nodeType} ${node.node.name} (distance: ${node.distance}, pull: ${node.pullStrength.toFixed(3)})`);
            });
            console.log('');
        });
    }
    
    // Display safety scores for kids
    console.log('🛡️ UPDATED SAFETY SCORES FOR CHILDREN:');
    const categorizedNodes = analyzer.categorizeNodes();
    categorizedNodes.kids.forEach(kid => {
        const safetyData = analysis.safety_scores.get(kid.id);
        if (safetyData) {
            console.log(`${kid.name}: ${safetyData.score.toFixed(3)} (${safetyData.level})`);
            safetyData.factors.forEach(factor => {
                console.log(`   - ${factor}`);
            });
            console.log('');
        }
    });
    
    // Display recommendations
    console.log('📋 RECOMMENDATIONS:');
    analysis.recommendations.forEach((rec, i) => {
        console.log(`${i+1}. [${rec.priority}] ${rec.message}`);
        console.log(`   Action: ${rec.action}\n`);
    });
    
    console.log('✅ Danger pull analysis test completed!');
    return analysis;
}

// Run the test
if (require.main === module) {
    runDangerPullTest();
}

module.exports = { runDangerPullTest, createTestData };
