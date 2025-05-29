/**
 * Integrated Safety Monitor - Main orchestration script
 * Coordinates danger monitoring, alerting, and visualization
 */

const DangerZoneMonitor = require('./danger-zone-monitor');
const AlertDispatcher = require('./alert-dispatcher');
const path = require('path');
const fs = require('fs').promises;

class IntegratedSafetyMonitor {
    constructor(config = {}) {
        this.config = {
            monitoring: {
                interval: config.monitoring?.interval || 60000, // 1 minute default
                enabled: config.monitoring?.enabled !== false,
                alertThresholds: {
                    criticalPullIncrease: 1,
                    dangerZoneIncrease: 2,
                    kidsInDangerIncrease: 5,
                    ...config.monitoring?.alertThresholds
                }
            },
            alerting: {
                enabled: config.alerting?.enabled !== false,
                ...config.alerting
            },
            dashboard: {
                port: config.dashboard?.port || 3002,
                enabled: config.dashboard?.enabled !== false
            },
            logging: {
                level: config.logging?.level || 'info',
                enabled: config.logging?.enabled !== false
            }
        };

        this.monitor = new DangerZoneMonitor();
        this.dispatcher = new AlertDispatcher(this.config.alerting);
        
        this.isRunning = false;
        this.monitoringInterval = null;
        this.lastSnapshot = null;
        this.stats = {
            totalChecks: 0,
            alertsSent: 0,
            lastCheck: null,
            uptime: null,
            startTime: null
        };
    }

    /**
     * Start the integrated monitoring system
     */
    async start() {
        if (this.isRunning) {
            this.log('warn', 'Monitoring system is already running');
            return;
        }

        this.log('info', 'Starting Integrated Safety Monitor...');
        this.stats.startTime = new Date();
        this.isRunning = true;

        try {
            // Initial monitoring check
            await this.performMonitoringCheck();

            // Set up periodic monitoring
            if (this.config.monitoring.enabled) {
                this.monitoringInterval = setInterval(
                    () => this.performMonitoringCheck(),
                    this.config.monitoring.interval
                );
                
                this.log('info', `Monitoring started with ${this.config.monitoring.interval}ms interval`);
            }

            // Send startup notification
            if (this.config.alerting.enabled) {
                await this.dispatcher.dispatchAlert({
                    type: 'SYSTEM_START',
                    severity: 'INFO',
                    title: 'Safety Monitoring System Started',
                    description: 'Integrated Safety Monitor has been started and is now actively monitoring for danger zones',
                    details: {
                        'Monitoring Interval': `${this.config.monitoring.interval}ms`,
                        'Alerting Enabled': this.config.alerting.enabled,
                        'Dashboard Port': this.config.dashboard.port
                    },
                    recommendations: [
                        'Verify dashboard is accessible',
                        'Check alert dispatch channels',
                        'Monitor system logs for any issues'
                    ]
                });
            }

            this.log('info', '✅ Integrated Safety Monitor started successfully');
            return true;
        } catch (error) {
            this.log('error', 'Failed to start monitoring system:', error);
            this.isRunning = false;
            throw error;
        }
    }

    /**
     * Stop the monitoring system
     */
    async stop() {
        if (!this.isRunning) {
            this.log('warn', 'Monitoring system is not running');
            return;
        }

        this.log('info', 'Stopping Integrated Safety Monitor...');

        try {
            // Clear monitoring interval
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }

            // Send shutdown notification
            if (this.config.alerting.enabled) {
                await this.dispatcher.dispatchAlert({
                    type: 'SYSTEM_STOP',
                    severity: 'INFO',
                    title: 'Safety Monitoring System Stopped',
                    description: 'Integrated Safety Monitor has been stopped',
                    details: {
                        'Total Checks Performed': this.stats.totalChecks,
                        'Total Alerts Sent': this.stats.alertsSent,
                        'Uptime': this.getUptime()
                    },
                    recommendations: [
                        'Restart monitoring when ready to resume safety checks',
                        'Review monitoring logs for any issues'
                    ]
                });
            }

            this.isRunning = false;
            this.log('info', '✅ Integrated Safety Monitor stopped successfully');
            return true;
        } catch (error) {
            this.log('error', 'Error stopping monitoring system:', error);
            throw error;
        }
    }

    /**
     * Perform a single monitoring check
     */
    async performMonitoringCheck() {
        this.log('debug', 'Performing monitoring check...');
        
        try {
            // Run danger zone monitoring
            const monitoringResult = await this.monitor.runMonitoringCheck();
            
            this.stats.totalChecks++;
            this.stats.lastCheck = new Date();

            // Analyze results for alerting
            if (this.config.alerting.enabled && monitoringResult.alerts && monitoringResult.alerts.length > 0) {
                await this.processMonitoringAlerts(monitoringResult);
            }

            // Check for threshold-based alerts
            if (this.lastSnapshot && this.config.alerting.enabled) {
                await this.checkAlertThresholds(this.lastSnapshot, monitoringResult);
            }

            this.lastSnapshot = monitoringResult;
            
            this.log('info', `Monitoring check completed - Kids in danger: ${monitoringResult.summary?.kids_in_danger || 0}`);
            
            return monitoringResult;
        } catch (error) {
            this.log('error', 'Monitoring check failed:', error);
            
            // Send error alert
            if (this.config.alerting.enabled) {
                await this.dispatcher.dispatchAlert({
                    type: 'MONITORING_ERROR',
                    severity: 'HIGH',
                    title: 'Monitoring Check Failed',
                    description: `Safety monitoring check failed: ${error.message}`,
                    details: {
                        'Error Type': error.name,
                        'Error Message': error.message,
                        'Check Number': this.stats.totalChecks + 1
                    },
                    recommendations: [
                        'Check system logs for detailed error information',
                        'Verify network connectivity and data sources',
                        'Restart monitoring system if errors persist'
                    ]
                });
            }
            
            throw error;
        }
    }

    /**
     * Process alerts from monitoring results
     */
    async processMonitoringAlerts(monitoringResult) {
        for (const alertData of monitoringResult.alerts) {
            try {
                const alert = AlertDispatcher.createDangerAlert(monitoringResult, alertData.type);
                await this.dispatcher.dispatchAlert(alert);
                this.stats.alertsSent++;
            } catch (error) {
                this.log('error', 'Failed to dispatch monitoring alert:', error);
            }
        }
    }

    /**
     * Check for threshold-based alerts
     */
    async checkAlertThresholds(previousSnapshot, currentSnapshot) {
        const prev = previousSnapshot.summary || {};
        const curr = currentSnapshot.summary || {};
        
        const thresholds = this.config.monitoring.alertThresholds;
        const alerts = [];

        // Check for critical pull increase
        const criticalPullIncrease = (curr.critical_pull_kids || 0) - (prev.critical_pull_kids || 0);
        if (criticalPullIncrease >= thresholds.criticalPullIncrease) {
            alerts.push({
                severity: 'CRITICAL',
                title: 'Critical Danger Pull Increase',
                description: `Critical danger pull increased by ${criticalPullIncrease} children`,
                type: 'THRESHOLD_CRITICAL_PULL'
            });
        }

        // Check for danger zone increase
        const dangerZoneIncrease = (curr.active_danger_zones || 0) - (prev.active_danger_zones || 0);
        if (dangerZoneIncrease >= thresholds.dangerZoneIncrease) {
            alerts.push({
                severity: 'HIGH',
                title: 'New Danger Zones Detected',
                description: `${dangerZoneIncrease} new danger zones have appeared`,
                type: 'THRESHOLD_DANGER_ZONES'
            });
        }

        // Check for kids in danger increase
        const kidsInDangerIncrease = (curr.kids_in_danger || 0) - (prev.kids_in_danger || 0);
        if (kidsInDangerIncrease >= thresholds.kidsInDangerIncrease) {
            alerts.push({
                severity: 'HIGH',
                title: 'Significant Increase in At-Risk Children',
                description: `${kidsInDangerIncrease} additional children are now in danger zones`,
                type: 'THRESHOLD_KIDS_DANGER'
            });
        }

        // Dispatch threshold alerts
        for (const alertData of alerts) {
            try {
                const alert = {
                    ...alertData,
                    details: {
                        'Previous Kids in Danger': prev.kids_in_danger || 0,
                        'Current Kids in Danger': curr.kids_in_danger || 0,
                        'Previous Danger Zones': prev.active_danger_zones || 0,
                        'Current Danger Zones': curr.active_danger_zones || 0,
                        'Previous Critical Pull': prev.critical_pull_kids || 0,
                        'Current Critical Pull': curr.critical_pull_kids || 0
                    },
                    recommendations: currentSnapshot.recommendations || []
                };

                await this.dispatcher.dispatchAlert(alert);
                this.stats.alertsSent++;
            } catch (error) {
                this.log('error', 'Failed to dispatch threshold alert:', error);
            }
        }
    }

    /**
     * Get current system status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            uptime: this.getUptime(),
            stats: {
                ...this.stats,
                uptime: this.getUptime()
            },
            config: this.config,
            lastSnapshot: this.lastSnapshot ? {
                timestamp: this.lastSnapshot.timestamp,
                summary: this.lastSnapshot.summary
            } : null,
            alertStats: this.dispatcher.getAlertStats()
        };
    }

    /**
     * Get system uptime
     */
    getUptime() {
        if (!this.stats.startTime) return 0;
        return Date.now() - this.stats.startTime.getTime();
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        // Update dispatcher config
        if (newConfig.alerting) {
            this.dispatcher.updateConfig(newConfig.alerting);
        }

        // Restart monitoring if interval changed
        if (newConfig.monitoring?.interval && this.isRunning) {
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = setInterval(
                    () => this.performMonitoringCheck(),
                    this.config.monitoring.interval
                );
            }
        }

        this.log('info', 'Configuration updated');
    }

    /**
     * Run a single check manually
     */
    async runSingleCheck() {
        this.log('info', 'Running manual monitoring check...');
        return await this.performMonitoringCheck();
    }

    /**
     * Get monitoring report
     */
    async getReport() {
        try {
            const status = this.getStatus();
            const monitoringReport = await this.monitor.getSummaryReport();
            
            return {
                system: status,
                monitoring: monitoringReport,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.log('error', 'Failed to generate report:', error);
            throw error;
        }
    }

    /**
     * Logging utility
     */
    log(level, message, ...args) {
        if (!this.config.logging.enabled) return;
        
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const configLevel = levels[this.config.logging.level] || 1;
        
        if (levels[level] >= configLevel) {
            const timestamp = new Date().toISOString();
            const emoji = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }[level] || '';
            console.log(`${timestamp} ${emoji} [${level.toUpperCase()}] ${message}`, ...args);
        }
    }
}

module.exports = IntegratedSafetyMonitor;

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];

    const monitor = new IntegratedSafetyMonitor({
        monitoring: {
            interval: 30000, // 30 seconds for demo
            enabled: true
        },
        alerting: {
            enabled: true,
            console: { enabled: true },
            email: { enabled: false },
            sms: { enabled: false },
            webhook: { enabled: false }
        },
        logging: {
            level: 'info',
            enabled: true
        }
    });

    async function handleCommand() {
        try {
            switch (command) {
                case 'start':
                    await monitor.start();
                    console.log('✅ Monitoring started. Press Ctrl+C to stop.');
                    
                    // Handle graceful shutdown
                    process.on('SIGINT', async () => {
                        console.log('\n🛑 Received shutdown signal...');
                        await monitor.stop();
                        process.exit(0);
                    });
                    break;

                case 'check':
                    console.log('🔍 Running single monitoring check...');
                    const result = await monitor.runSingleCheck();
                    console.log('✅ Check completed:', result.summary);
                    break;

                case 'status':
                    const status = monitor.getStatus();
                    console.log('📊 System Status:', JSON.stringify(status, null, 2));
                    break;

                case 'report':
                    const report = await monitor.getReport();
                    console.log('📋 Full Report:', JSON.stringify(report, null, 2));
                    break;

                default:
                    console.log(`
🛡️ Integrated Safety Monitor
Usage:
  node integrated-safety-monitor.js start   # Start continuous monitoring
  node integrated-safety-monitor.js check   # Run single check
  node integrated-safety-monitor.js status  # Show system status
  node integrated-safety-monitor.js report  # Generate full report
                    `);
            }
        } catch (error) {
            console.error('❌ Command failed:', error.message);
            process.exit(1);
        }
    }

    handleCommand();
}
