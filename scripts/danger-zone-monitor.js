// Real-time Danger Zone Monitoring System
// Tracks changes in danger zones and alerts on new risks

const { KidSafetyAnalyzer } = require('./kid-safety-analyzer.js');
const fs = require('fs');
const path = require('path');

class DangerZoneMonitor {
    constructor(dataDir = path.join(__dirname, '../backend/data')) {
        this.dataDir = dataDir;
        this.historyFile = path.join(dataDir, 'danger_zone_history.json');
        this.alertsFile = path.join(dataDir, 'danger_alerts.json');
        this.configFile = path.join(dataDir, 'monitor_config.json');
        
        this.config = this.loadConfig();
        this.history = this.loadHistory();
        this.alerts = this.loadAlerts();
        
        // Monitoring thresholds
        this.ALERT_THRESHOLDS = {
            NEW_CRITICAL_PULL: 0.8,     // Alert if any child reaches critical pull
            ZONE_EXPANSION: 0.3,         // Alert if zone affects 30% more kids
            NEW_DANGER_SOURCE: true,     // Alert on any new danger source
            PULL_INCREASE: 0.2           // Alert if child's pull increases by 0.2
        };
    }

    // Load monitoring configuration
    loadConfig() {
        try {
            if (fs.existsSync(this.configFile)) {
                return JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
            }
        } catch (error) {
            console.log('Using default monitoring config');
        }
        
        return {
            monitoring_enabled: true,
            alert_email: null,
            check_interval_minutes: 60,
            keep_history_days: 30,
            auto_generate_reports: true
        };
    }

    // Load danger zone history
    loadHistory() {
        try {
            if (fs.existsSync(this.historyFile)) {
                return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
            }
        } catch (error) {
            console.log('No danger zone history found, starting fresh');
        }
        return [];
    }

    // Load alerts history
    loadAlerts() {
        try {
            if (fs.existsSync(this.alertsFile)) {
                return JSON.parse(fs.readFileSync(this.alertsFile, 'utf8'));
            }
        } catch (error) {
            console.log('No alerts history found, starting fresh');
        }
        return [];
    }

    // Save data to files
    saveHistory() {
        fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    }

    saveAlerts() {
        fs.writeFileSync(this.alertsFile, JSON.stringify(this.alerts, null, 2));
    }

    saveConfig() {
        fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
    }

    // Run a monitoring check
    async runMonitoringCheck() {
        console.log('🔍 Running danger zone monitoring check...');
        
        try {
            // Load current network data
            const graphPath = path.join(this.dataDir, 'graph.json');
            const annotationsPath = path.join(this.dataDir, 'annotations.json');
            
            if (!fs.existsSync(graphPath) || !fs.existsSync(annotationsPath)) {
                throw new Error('Network data files not found');
            }

            const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
            const annotations = JSON.parse(fs.readFileSync(annotationsPath, 'utf8'));

            // Run safety analysis
            const analyzer = new KidSafetyAnalyzer(graph, annotations);
            const analysis = analyzer.analyzeSafetyRisks();

            // Create snapshot
            const snapshot = {
                timestamp: new Date().toISOString(),
                danger_sources: analysis.danger_patterns.danger_sources || [],
                kids_in_pull: analysis.danger_patterns.kids_in_danger_pull || [],
                danger_zones: analysis.danger_patterns.danger_zones || [],
                total_kids: analysis.metadata.total_kids,
                total_flags: analysis.metadata.total_flags
            };

            // Compare with previous snapshot and generate alerts
            const newAlerts = this.compareSnapshots(snapshot);

            // Save snapshot to history
            this.history.push(snapshot);
            this.cleanOldHistory();

            // Process any new alerts
            if (newAlerts.length > 0) {
                console.log(`🚨 Generated ${newAlerts.length} new alerts`);
                this.alerts.push(...newAlerts);
                this.processAlerts(newAlerts);
            }

            // Save data
            this.saveHistory();
            this.saveAlerts();

            // Generate monitoring report
            const report = this.generateMonitoringReport(snapshot, newAlerts);
            
            console.log('✅ Monitoring check completed');
            return { snapshot, newAlerts, report };

        } catch (error) {
            console.error('❌ Monitoring check failed:', error.message);
            return { error: error.message };
        }
    }

    // Compare current snapshot with previous to detect changes
    compareSnapshots(currentSnapshot) {
        const alerts = [];
        
        if (this.history.length === 0) {
            console.log('📊 First monitoring snapshot - establishing baseline');
            return alerts;
        }

        const previousSnapshot = this.history[this.history.length - 1];

        // 1. Check for new critical danger pull children
        const previousCriticalPull = previousSnapshot.kids_in_pull
            .filter(k => k.riskLevel === 'CRITICAL');
        const currentCriticalPull = currentSnapshot.kids_in_pull
            .filter(k => k.riskLevel === 'CRITICAL');

        const newCriticalPullKids = currentCriticalPull.filter(current => 
            !previousCriticalPull.some(prev => prev.kid.id === current.kid.id)
        );

        newCriticalPullKids.forEach(kid => {
            alerts.push({
                type: 'NEW_CRITICAL_PULL',
                severity: 'CRITICAL',
                timestamp: currentSnapshot.timestamp,
                message: `${kid.kid.name} has entered CRITICAL danger pull zone`,
                details: {
                    kidId: kid.kid.id,
                    kidName: kid.kid.name,
                    pullStrength: kid.totalPull,
                    dangerSources: kid.pullSources.length,
                    immediateThreats: kid.immediateDangers.length
                }
            });
        });

        // 2. Check for significant pull increases
        currentSnapshot.kids_in_pull.forEach(currentKid => {
            const previousKid = previousSnapshot.kids_in_pull
                .find(p => p.kid.id === currentKid.kid.id);
            
            if (previousKid) {
                const pullIncrease = currentKid.totalPull - previousKid.totalPull;
                if (pullIncrease >= this.ALERT_THRESHOLDS.PULL_INCREASE) {
                    alerts.push({
                        type: 'PULL_INCREASE',
                        severity: 'HIGH',
                        timestamp: currentSnapshot.timestamp,
                        message: `${currentKid.kid.name}'s danger pull increased significantly`,
                        details: {
                            kidId: currentKid.kid.id,
                            kidName: currentKid.kid.name,
                            previousPull: previousKid.totalPull,
                            currentPull: currentKid.totalPull,
                            increase: pullIncrease
                        }
                    });
                }
            }
        });

        // 3. Check for new danger sources
        const previousSources = previousSnapshot.danger_sources.map(s => s.nodeId);
        const currentSources = currentSnapshot.danger_sources.map(s => s.nodeId);
        const newSources = currentSources.filter(id => !previousSources.includes(id));

        newSources.forEach(sourceId => {
            const source = currentSnapshot.danger_sources.find(s => s.nodeId === sourceId);
            alerts.push({
                type: 'NEW_DANGER_SOURCE',
                severity: 'HIGH',
                timestamp: currentSnapshot.timestamp,
                message: `New danger source detected: ${source.node.name}`,
                details: {
                    sourceId: sourceId,
                    sourceName: source.node.name,
                    dangerType: source.dangerType,
                    dangerLevel: source.dangerLevel,
                    pullStrength: source.basePullStrength
                }
            });
        });

        // 4. Check for danger zone expansion
        currentSnapshot.danger_zones.forEach(currentZone => {
            const previousZone = previousSnapshot.danger_zones
                .find(p => p.epicenter.nodeId === currentZone.epicenter.nodeId);
            
            if (previousZone) {
                const kidsIncrease = currentZone.totalKidsAffected - previousZone.totalKidsAffected;
                const expansionRate = kidsIncrease / Math.max(previousZone.totalKidsAffected, 1);
                
                if (expansionRate >= this.ALERT_THRESHOLDS.ZONE_EXPANSION) {
                    alerts.push({
                        type: 'ZONE_EXPANSION',
                        severity: 'HIGH',
                        timestamp: currentSnapshot.timestamp,
                        message: `Danger zone around ${currentZone.epicenter.node.name} has expanded`,
                        details: {
                            epicenterId: currentZone.epicenter.nodeId,
                            epicenterName: currentZone.epicenter.node.name,
                            previousKidsAffected: previousZone.totalKidsAffected,
                            currentKidsAffected: currentZone.totalKidsAffected,
                            expansionRate: expansionRate
                        }
                    });
                }
            }
        });

        return alerts;
    }

    // Process alerts (could send emails, notifications, etc.)
    processAlerts(newAlerts) {
        newAlerts.forEach(alert => {
            console.log(`🚨 ${alert.severity} ALERT: ${alert.message}`);
            
            // Here you could add:
            // - Email notifications
            // - Slack/Discord webhooks  
            // - SMS alerts
            // - Database logging
            // - Integration with other monitoring systems
        });

        // Generate alert summary report
        if (newAlerts.length > 0) {
            this.generateAlertReport(newAlerts);
        }
    }

    // Generate monitoring report
    generateMonitoringReport(snapshot, newAlerts) {
        const report = {
            timestamp: snapshot.timestamp,
            summary: {
                total_kids_monitored: snapshot.total_kids,
                kids_in_danger: snapshot.kids_in_pull.length,
                critical_pull_kids: snapshot.kids_in_pull.filter(k => k.riskLevel === 'CRITICAL').length,
                high_pull_kids: snapshot.kids_in_pull.filter(k => k.riskLevel === 'HIGH').length,
                active_danger_zones: snapshot.danger_zones.length,
                danger_sources: snapshot.danger_sources.length,
                new_alerts: newAlerts.length
            },
            trend_analysis: this.analyzeTrends(),
            recommendations: this.generateMonitoringRecommendations(snapshot, newAlerts)
        };

        // Save report
        const reportPath = path.join(this.dataDir, 'danger_monitoring_report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        return report;
    }

    // Analyze trends over time
    analyzeTrends() {
        if (this.history.length < 2) return { message: 'Insufficient data for trend analysis' };

        const recent = this.history.slice(-7); // Last 7 snapshots
        const trends = {
            kids_in_danger_trend: this.calculateTrend(recent.map(s => s.kids_in_pull.length)),
            danger_sources_trend: this.calculateTrend(recent.map(s => s.danger_sources.length)),
            critical_cases_trend: this.calculateTrend(recent.map(s => 
                s.kids_in_pull.filter(k => k.riskLevel === 'CRITICAL').length
            ))
        };

        return trends;
    }

    // Calculate trend (increasing, decreasing, stable)
    calculateTrend(values) {
        if (values.length < 2) return 'INSUFFICIENT_DATA';
        
        const first = values[0];
        const last = values[values.length - 1];
        const change = last - first;
        const percentChange = first > 0 ? (change / first) * 100 : 0;

        if (Math.abs(percentChange) < 10) return 'STABLE';
        return percentChange > 0 ? 'INCREASING' : 'DECREASING';
    }

    // Generate monitoring recommendations
    generateMonitoringRecommendations(snapshot, newAlerts) {
        const recommendations = [];

        if (newAlerts.some(a => a.type === 'NEW_CRITICAL_PULL')) {
            recommendations.push({
                priority: 'CRITICAL',
                action: 'Immediate intervention required for children entering critical danger zones',
                timeframe: 'IMMEDIATE'
            });
        }

        if (newAlerts.some(a => a.type === 'NEW_DANGER_SOURCE')) {
            recommendations.push({
                priority: 'HIGH',
                action: 'Investigate new danger sources and assess threat level',
                timeframe: '24_HOURS'
            });
        }

        if (snapshot.kids_in_pull.length > 10) {
            recommendations.push({
                priority: 'MEDIUM',
                action: 'Consider expanding safety education programs due to high number of at-risk children',
                timeframe: '1_WEEK'
            });
        }

        return recommendations;
    }

    // Generate alert summary report
    generateAlertReport(newAlerts) {
        const alertReport = {
            timestamp: new Date().toISOString(),
            alert_count: newAlerts.length,
            severity_breakdown: {
                CRITICAL: newAlerts.filter(a => a.severity === 'CRITICAL').length,
                HIGH: newAlerts.filter(a => a.severity === 'HIGH').length,
                MEDIUM: newAlerts.filter(a => a.severity === 'MEDIUM').length
            },
            alerts: newAlerts
        };

        const alertReportPath = path.join(this.dataDir, 'latest_alerts.json');
        fs.writeFileSync(alertReportPath, JSON.stringify(alertReport, null, 2));

        console.log('📄 Alert report saved to latest_alerts.json');
    }

    // Clean old history entries
    cleanOldHistory() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.keep_history_days);

        this.history = this.history.filter(entry => 
            new Date(entry.timestamp) >= cutoffDate
        );
    }

    // Start continuous monitoring
    startMonitoring() {
        if (!this.config.monitoring_enabled) {
            console.log('⏸️ Monitoring is disabled in config');
            return;
        }

        console.log(`🔄 Starting continuous danger zone monitoring (${this.config.check_interval_minutes} min intervals)`);
        
        // Run initial check
        this.runMonitoringCheck();

        // Set up recurring checks
        const intervalMs = this.config.check_interval_minutes * 60 * 1000;
        setInterval(() => {
            this.runMonitoringCheck();
        }, intervalMs);
    }

    // Manual monitoring check
    checkNow() {
        return this.runMonitoringCheck();
    }

    // Get monitoring status
    getStatus() {
        const lastCheck = this.history.length > 0 ? this.history[this.history.length - 1] : null;
        const recentAlerts = this.alerts.filter(a => {
            const alertTime = new Date(a.timestamp);
            const dayAgo = new Date();
            dayAgo.setDate(dayAgo.getDate() - 1);
            return alertTime >= dayAgo;
        });

        return {
            monitoring_enabled: this.config.monitoring_enabled,
            last_check: lastCheck?.timestamp,
            total_snapshots: this.history.length,
            recent_alerts_24h: recentAlerts.length,
            current_kids_in_danger: lastCheck?.kids_in_pull.length || 0,
            current_danger_zones: lastCheck?.danger_zones.length || 0
        };
    }    // Get summary report of current state
    async getSummaryReport() {
        try {
            // Load current network data and create snapshot
            const graphPath = path.join(this.dataDir, 'graph.json');
            const annotationsPath = path.join(this.dataDir, 'annotations.json');
            
            if (!fs.existsSync(graphPath) || !fs.existsSync(annotationsPath)) {
                throw new Error('Network data files not found');
            }

            const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
            const annotations = JSON.parse(fs.readFileSync(annotationsPath, 'utf8'));

            // Run safety analysis
            const analyzer = new KidSafetyAnalyzer(graph, annotations);
            const analysis = analyzer.analyzeSafetyRisks();

            // Create current snapshot
            const currentSnapshot = {
                timestamp: new Date().toISOString(),
                danger_sources: analysis.danger_patterns.danger_sources || [],
                kids_in_pull: analysis.danger_patterns.kids_in_danger_pull || [],
                danger_zones: analysis.danger_patterns.danger_zones || [],
                total_kids: analysis.metadata.total_kids,
                total_flags: analysis.metadata.total_flags
            };

            const history = await this.loadHistory();
            
            const report = {
                timestamp: new Date().toISOString(),
                current_status: {
                    total_kids_monitored: currentSnapshot.total_kids,
                    kids_in_danger: currentSnapshot.kids_in_pull.length,
                    critical_pull_kids: currentSnapshot.kids_in_pull.filter(k => k.riskLevel === 'CRITICAL').length,
                    high_pull_kids: currentSnapshot.kids_in_pull.filter(k => k.riskLevel === 'HIGH').length,
                    active_danger_zones: currentSnapshot.danger_zones.length,
                    danger_sources: currentSnapshot.danger_sources.length
                },
                historical_data: {
                    total_snapshots: history.length,
                    monitoring_period: history.length > 0 ? {
                        start: history[0].timestamp,
                        latest: history[history.length - 1].timestamp
                    } : null
                },
                trend_analysis: this.analyzeTrends(),
                alerts_summary: await this.getAlertsHistory()
            };

            return report;
        } catch (error) {
            console.error('Error generating summary report:', error);
            return {
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // Get alerts history summary
    async getAlertsHistory() {
        try {
            const alertsPath = path.join(this.dataDir, 'monitoring_alerts.json');
            const exists = fs.existsSync(alertsPath);
            if (!exists) return { total: 0, recent: [] };

            const alerts = JSON.parse(fs.readFileSync(alertsPath, 'utf8'));
            const recent = alerts.slice(-10); // Last 10 alerts
            
            return {
                total: alerts.length,
                recent: recent,
                last_alert: alerts.length > 0 ? alerts[alerts.length - 1].timestamp : null
            };
        } catch (error) {
            return { total: 0, recent: [], error: error.message };
        }
    }
}

module.exports = { DangerZoneMonitor };

// CLI usage
if (require.main === module) {
    const monitor = new DangerZoneMonitor();
    
    if (process.argv.includes('--start')) {
        monitor.startMonitoring();
    } else if (process.argv.includes('--check')) {
        monitor.checkNow().then(result => {
            console.log('Check completed:', result);
            process.exit(0);
        });
    } else if (process.argv.includes('--status')) {
        console.log('Monitoring Status:', monitor.getStatus());
    } else {        console.log('Usage:');
        console.log('  node danger-zone-monitor.js --start   # Start continuous monitoring');
        console.log('  node danger-zone-monitor.js --check   # Run single check');
        console.log('  node danger-zone-monitor.js --status  # Show status');
    }
}

module.exports = DangerZoneMonitor;
