// Test script for the new danger zone monitoring system
const { DangerZoneMonitor } = require('./danger-zone-monitor.js');
const path = require('path');

async function testDangerZoneMonitoring() {
    console.log('🔍 Testing Danger Zone Monitoring System');
    console.log('=======================================\n');

    // Initialize monitor
    const monitor = new DangerZoneMonitor();

    // Test 1: Show current status
    console.log('📊 CURRENT MONITORING STATUS:');
    const status = monitor.getStatus();
    console.log(JSON.stringify(status, null, 2));
    console.log('');

    // Test 2: Run monitoring check
    console.log('🔄 RUNNING MONITORING CHECK:');
    const checkResult = await monitor.checkNow();
    
    if (checkResult.error) {
        console.error('❌ Monitoring check failed:', checkResult.error);
        return;
    }

    console.log('✅ Monitoring check completed successfully\n');

    // Test 3: Display snapshot summary
    if (checkResult.snapshot) {
        console.log('📊 SNAPSHOT SUMMARY:');
        console.log(`Timestamp: ${checkResult.snapshot.timestamp}`);
        console.log(`Total Kids: ${checkResult.snapshot.total_kids}`);
        console.log(`Kids in Danger: ${checkResult.snapshot.kids_in_pull.length}`);
        console.log(`Danger Sources: ${checkResult.snapshot.danger_sources.length}`);
        console.log(`Active Danger Zones: ${checkResult.snapshot.danger_zones.length}`);
        console.log('');
    }

    // Test 4: Display any new alerts
    if (checkResult.newAlerts && checkResult.newAlerts.length > 0) {
        console.log('🚨 NEW ALERTS GENERATED:');
        checkResult.newAlerts.forEach((alert, i) => {
            console.log(`${i + 1}. [${alert.severity}] ${alert.message}`);
            if (alert.details) {
                Object.entries(alert.details).forEach(([key, value]) => {
                    console.log(`   ${key}: ${value}`);
                });
            }
            console.log('');
        });
    } else {
        console.log('ℹ️ No new alerts generated');
    }

    // Test 5: Display monitoring report
    if (checkResult.report) {
        console.log('📋 MONITORING REPORT:');
        console.log('Summary:', checkResult.report.summary);
        console.log('Trends:', checkResult.report.trend_analysis);
        console.log('Recommendations:', checkResult.report.recommendations);
        console.log('');
    }

    // Test 6: Run a second check to test change detection
    console.log('🔄 RUNNING SECOND CHECK (to test change detection):');
    setTimeout(async () => {
        const secondCheck = await monitor.checkNow();
        console.log('✅ Second check completed');
        
        if (secondCheck.newAlerts?.length > 0) {
            console.log(`🚨 ${secondCheck.newAlerts.length} new alerts in second check`);
        } else {
            console.log('ℹ️ No changes detected between checks (expected for quick succession)');
        }
    }, 1000);

    console.log('✅ Danger zone monitoring test completed!');
}

// Create a function to simulate monitoring over time
async function simulateContinuousMonitoring(duration = 30000) {
    console.log(`🔄 Starting simulated continuous monitoring for ${duration/1000} seconds...`);
    
    const monitor = new DangerZoneMonitor();
    
    // Update config for faster testing
    monitor.config.check_interval_minutes = 0.1; // Check every 6 seconds for testing
    monitor.saveConfig();
    
    let checkCount = 0;
    const startTime = Date.now();
    
    const intervalId = setInterval(async () => {
        checkCount++;
        console.log(`\n🔍 Check #${checkCount} at ${new Date().toLocaleTimeString()}`);
        
        const result = await monitor.checkNow();
        
        if (result.error) {
            console.error('❌ Check failed:', result.error);
        } else {
            console.log(`✅ Check completed - ${result.newAlerts?.length || 0} new alerts`);
        }
        
        // Stop after duration
        if (Date.now() - startTime >= duration) {
            clearInterval(intervalId);
            console.log(`\n🏁 Continuous monitoring simulation completed after ${checkCount} checks`);
            
            // Show final status
            const finalStatus = monitor.getStatus();
            console.log('\n📊 FINAL STATUS:');
            console.log(JSON.stringify(finalStatus, null, 2));
        }
    }, 6000); // Check every 6 seconds
}

// Function to test alert generation scenarios
async function testAlertScenarios() {
    console.log('🚨 Testing Alert Generation Scenarios');
    console.log('====================================\n');

    const monitor = new DangerZoneMonitor();

    // First, establish a baseline
    console.log('📊 Establishing baseline...');
    await monitor.checkNow();

    // Simulate scenarios by modifying thresholds temporarily
    const originalThresholds = { ...monitor.ALERT_THRESHOLDS };

    console.log('🔬 Testing with lowered thresholds to trigger alerts...');
    
    // Lower thresholds to be more sensitive
    monitor.ALERT_THRESHOLDS.NEW_CRITICAL_PULL = 0.1;
    monitor.ALERT_THRESHOLDS.PULL_INCREASE = 0.05;
    monitor.ALERT_THRESHOLDS.ZONE_EXPANSION = 0.1;

    // Run check with more sensitive thresholds
    const result = await monitor.checkNow();

    if (result.newAlerts?.length > 0) {
        console.log(`✅ Successfully generated ${result.newAlerts.length} test alerts`);
        result.newAlerts.forEach(alert => {
            console.log(`   - ${alert.type}: ${alert.message}`);
        });
    } else {
        console.log('ℹ️ No alerts generated (this is normal if network hasn\'t changed)');
    }

    // Restore original thresholds
    monitor.ALERT_THRESHOLDS = originalThresholds;

    console.log('✅ Alert scenario testing completed');
}

// Main test runner
async function runAllTests() {
    try {
        console.log('🚀 Starting comprehensive danger zone monitoring tests\n');
        
        // Test 1: Basic monitoring functionality
        await testDangerZoneMonitoring();
        console.log('\n' + '='.repeat(50) + '\n');
        
        // Test 2: Alert generation scenarios
        await testAlertScenarios();
        console.log('\n' + '='.repeat(50) + '\n');
        
        // Test 3: Short continuous monitoring simulation
        console.log('🔄 Starting brief continuous monitoring simulation...');
        await simulateContinuousMonitoring(15000); // 15 seconds
        
        console.log('\n🎉 All danger zone monitoring tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--basic')) {
        testDangerZoneMonitoring();
    } else if (args.includes('--continuous')) {
        const duration = parseInt(args[args.indexOf('--continuous') + 1]) || 30000;
        simulateContinuousMonitoring(duration);
    } else if (args.includes('--alerts')) {
        testAlertScenarios();
    } else if (args.includes('--all')) {
        runAllTests();
    } else {
        console.log('Danger Zone Monitoring Test Suite');
        console.log('=================================');
        console.log('Usage:');
        console.log('  node test-danger-monitoring.js --basic      # Test basic functionality');
        console.log('  node test-danger-monitoring.js --continuous [ms] # Test continuous monitoring');
        console.log('  node test-danger-monitoring.js --alerts     # Test alert generation');
        console.log('  node test-danger-monitoring.js --all        # Run all tests');
        console.log('');
        console.log('Running basic test...');
        testDangerZoneMonitoring();
    }
}

module.exports = {
    testDangerZoneMonitoring,
    simulateContinuousMonitoring,
    testAlertScenarios,
    runAllTests
};
