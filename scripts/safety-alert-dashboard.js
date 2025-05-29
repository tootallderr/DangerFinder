// Automated Safety Alert Dashboard
// Provides real-time monitoring and alert management interface

const express = require('express');
const DangerZoneMonitor = require('./danger-zone-monitor.js');
const { KidSafetyAnalyzer } = require('./kid-safety-analyzer.js');
const fs = require('fs');
const path = require('path');

class SafetyAlertDashboard {
    constructor(port = 3002) {
        this.port = port;
        this.app = express();
        this.monitor = new DangerZoneMonitor();
        this.isMonitoringActive = false;
        this.monitoringInterval = null;
        
        this.setupMiddleware();
        this.setupRoutes();
        this.startServer();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../visualizer')));
        this.app.use('/api/data', express.static(path.join(__dirname, '../backend/data')));
    }

    setupRoutes() {
        // Dashboard home page
        this.app.get('/dashboard', (req, res) => {
            res.send(this.generateDashboardHTML());
        });

        // API Routes
        this.app.get('/api/monitoring/status', (req, res) => {
            const status = this.monitor.getStatus();
            res.json({
                ...status,
                is_monitoring_active: this.isMonitoringActive,
                dashboard_uptime: process.uptime()
            });
        });

        this.app.post('/api/monitoring/start', (req, res) => {
            this.startMonitoring();
            res.json({ success: true, message: 'Monitoring started' });
        });

        this.app.post('/api/monitoring/stop', (req, res) => {
            this.stopMonitoring();
            res.json({ success: true, message: 'Monitoring stopped' });
        });

        this.app.post('/api/monitoring/check', async (req, res) => {
            try {
                const result = await this.monitor.checkNow();
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/api/alerts/recent', (req, res) => {
            const hours = parseInt(req.query.hours) || 24;
            const alerts = this.getRecentAlerts(hours);
            res.json(alerts);
        });

        this.app.get('/api/alerts/history', (req, res) => {
            res.json(this.monitor.alerts);
        });

        this.app.get('/api/monitoring/history', (req, res) => {
            const limit = parseInt(req.query.limit) || 50;
            const history = this.monitor.history.slice(-limit);
            res.json(history);
        });

        this.app.get('/api/safety/current', (req, res) => {
            try {
                const analysisPath = path.join(__dirname, '../backend/data/kid_safety_analysis.json');
                if (fs.existsSync(analysisPath)) {
                    const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
                    res.json(analysis);
                } else {
                    res.status(404).json({ error: 'Safety analysis not found' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/safety/analyze', async (req, res) => {
            try {
                const graphPath = path.join(__dirname, '../backend/data/graph.json');
                const annotationsPath = path.join(__dirname, '../backend/data/annotations.json');
                
                if (!fs.existsSync(graphPath) || !fs.existsSync(annotationsPath)) {
                    return res.status(404).json({ error: 'Network data not found' });
                }

                const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
                const annotations = JSON.parse(fs.readFileSync(annotationsPath, 'utf8'));
                
                const analyzer = new KidSafetyAnalyzer(graph, annotations);
                const analysis = analyzer.analyzeSafetyRisks();
                
                // Save the analysis
                const outputPath = path.join(__dirname, '../backend/data/kid_safety_analysis.json');
                fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
                
                res.json({ success: true, analysis });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Real-time updates via Server-Sent Events
        this.app.get('/api/monitoring/stream', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            const sendUpdate = (data) => {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            };

            // Send initial status
            sendUpdate({ type: 'status', data: this.monitor.getStatus() });

            // Set up periodic updates
            const updateInterval = setInterval(() => {
                sendUpdate({ 
                    type: 'heartbeat', 
                    data: { 
                        timestamp: new Date().toISOString(),
                        monitoring_active: this.isMonitoringActive
                    }
                });
            }, 30000); // Every 30 seconds

            req.on('close', () => {
                clearInterval(updateInterval);
            });
        });
    }

    startMonitoring() {
        if (this.isMonitoringActive) return;
        
        this.isMonitoringActive = true;
        const intervalMs = this.monitor.config.check_interval_minutes * 60 * 1000;
        
        this.monitoringInterval = setInterval(async () => {
            try {
                const result = await this.monitor.checkNow();
                console.log(`🔍 Automated check completed - ${result.newAlerts?.length || 0} new alerts`);
                
                // Broadcast alerts to connected clients (in a real implementation)
                if (result.newAlerts?.length > 0) {
                    console.log('🚨 New alerts detected:', result.newAlerts.map(a => a.message));
                }
            } catch (error) {
                console.error('❌ Automated check failed:', error.message);
            }
        }, intervalMs);
        
        console.log(`✅ Monitoring started with ${this.monitor.config.check_interval_minutes} minute intervals`);
    }

    stopMonitoring() {
        if (!this.isMonitoringActive) return;
        
        this.isMonitoringActive = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        console.log('⏹️ Monitoring stopped');
    }

    getRecentAlerts(hours = 24) {
        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - hours);
        
        return this.monitor.alerts.filter(alert => 
            new Date(alert.timestamp) >= cutoffTime
        );
    }

    generateDashboardHTML() {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🛡️ Safety Alert Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
        }
        
        .dashboard {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-left: 10px;
        }
        
        .status-indicator.active { background: #2ecc71; }
        .status-indicator.inactive { background: #e74c3c; }
        
        .controls {
            display: flex;
            justify-content: center;
            gap: 15px;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 12px 24px;
            background: rgba(255,255,255,0.2);
            border: none;
            border-radius: 8px;
            color: white;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s;
        }
        
        .btn:hover { background: rgba(255,255,255,0.3); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .btn.success { background: rgba(46, 204, 113, 0.8); }
        .btn.danger { background: rgba(231, 76, 60, 0.8); }
        .btn.warning { background: rgba(243, 156, 18, 0.8); }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .card {
            background: rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
        }
        
        .card h3 {
            margin-bottom: 15px;
            font-size: 1.3em;
            color: #ecf0f1;
        }
        
        .metric {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .metric:last-child { border-bottom: none; }
        
        .metric-value {
            font-weight: bold;
            color: #3498db;
        }
        
        .metric-value.critical { color: #e74c3c; }
        .metric-value.warning { color: #f39c12; }
        .metric-value.success { color: #2ecc71; }
        
        .alert-item {
            background: rgba(231, 76, 60, 0.2);
            border-left: 4px solid #e74c3c;
            padding: 12px;
            margin-bottom: 10px;
            border-radius: 4px;
        }
        
        .alert-item.HIGH { border-left-color: #f39c12; background: rgba(243, 156, 18, 0.2); }
        .alert-item.MEDIUM { border-left-color: #3498db; background: rgba(52, 152, 219, 0.2); }
        
        .alert-time {
            font-size: 12px;
            opacity: 0.8;
            margin-bottom: 5px;
        }
        
        .log-container {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 15px;
            max-height: 300px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 12px;
        }
        
        .log-entry {
            margin-bottom: 5px;
            padding: 2px 0;
        }
        
        .log-timestamp {
            color: #95a5a6;
            margin-right: 10px;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        .pulse { animation: pulse 2s infinite; }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🛡️ Kid Safety Alert Dashboard</h1>
            <p>Real-time monitoring of danger zones and safety threats</p>
            <span id="monitoring-status">Monitoring: 
                <span id="status-text">Unknown</span>
                <span class="status-indicator" id="status-indicator"></span>
            </span>
        </div>
        
        <div class="controls">
            <button class="btn success" id="start-monitoring">▶️ Start Monitoring</button>
            <button class="btn danger" id="stop-monitoring">⏹️ Stop Monitoring</button>
            <button class="btn" id="run-check">🔍 Run Check</button>
            <button class="btn" id="run-analysis">🛡️ Run Analysis</button>
            <button class="btn" id="refresh-dashboard">🔄 Refresh</button>
        </div>
        
        <div class="grid">
            <div class="card">
                <h3>📊 Current Status</h3>
                <div id="status-metrics">
                    <div class="metric">
                        <span>Kids Monitored:</span>
                        <span class="metric-value" id="kids-monitored">-</span>
                    </div>
                    <div class="metric">
                        <span>Kids in Danger:</span>
                        <span class="metric-value critical" id="kids-in-danger">-</span>
                    </div>
                    <div class="metric">
                        <span>Active Danger Zones:</span>
                        <span class="metric-value warning" id="danger-zones">-</span>
                    </div>
                    <div class="metric">
                        <span>Last Check:</span>
                        <span class="metric-value" id="last-check">-</span>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <h3>🚨 Recent Alerts (24h)</h3>
                <div id="recent-alerts">
                    <p>Loading alerts...</p>
                </div>
            </div>
            
            <div class="card">
                <h3>📈 Trends</h3>
                <div id="trend-metrics">
                    <div class="metric">
                        <span>Kids in Danger Trend:</span>
                        <span class="metric-value" id="danger-trend">-</span>
                    </div>
                    <div class="metric">
                        <span>Danger Sources Trend:</span>
                        <span class="metric-value" id="sources-trend">-</span>
                    </div>
                    <div class="metric">
                        <span>Critical Cases Trend:</span>
                        <span class="metric-value" id="critical-trend">-</span>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <h3>🔧 System Info</h3>
                <div id="system-metrics">
                    <div class="metric">
                        <span>Dashboard Uptime:</span>
                        <span class="metric-value" id="uptime">-</span>
                    </div>
                    <div class="metric">
                        <span>Total Snapshots:</span>
                        <span class="metric-value" id="total-snapshots">-</span>
                    </div>
                    <div class="metric">
                        <span>Check Interval:</span>
                        <span class="metric-value" id="check-interval">-</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="grid">
            <div class="card">
                <h3>📋 Activity Log</h3>
                <div class="log-container" id="activity-log">
                    <div class="log-entry">
                        <span class="log-timestamp">--:--:--</span>
                        Dashboard initialized
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Dashboard JavaScript functionality
        let eventSource = null;
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', () => {
            initializeDashboard();
            setupEventListeners();
            startEventStream();
            refreshDashboard();
            
            // Auto-refresh every 30 seconds
            setInterval(refreshDashboard, 30000);
        });
        
        function initializeDashboard() {
            addToLog('Dashboard initialized');
        }
        
        function setupEventListeners() {
            document.getElementById('start-monitoring').addEventListener('click', startMonitoring);
            document.getElementById('stop-monitoring').addEventListener('click', stopMonitoring);
            document.getElementById('run-check').addEventListener('click', runCheck);
            document.getElementById('run-analysis').addEventListener('click', runAnalysis);
            document.getElementById('refresh-dashboard').addEventListener('click', refreshDashboard);
        }
        
        async function startMonitoring() {
            try {
                const response = await fetch('/api/monitoring/start', { method: 'POST' });
                const result = await response.json();
                addToLog('Monitoring started');
                refreshDashboard();
            } catch (error) {
                addToLog('Failed to start monitoring: ' + error.message);
            }
        }
        
        async function stopMonitoring() {
            try {
                const response = await fetch('/api/monitoring/stop', { method: 'POST' });
                const result = await response.json();
                addToLog('Monitoring stopped');
                refreshDashboard();
            } catch (error) {
                addToLog('Failed to stop monitoring: ' + error.message);
            }
        }
        
        async function runCheck() {
            addToLog('Running manual check...');
            try {
                const response = await fetch('/api/monitoring/check', { method: 'POST' });
                const result = await response.json();
                addToLog(\`Check completed - \${result.newAlerts?.length || 0} new alerts\`);
                refreshDashboard();
            } catch (error) {
                addToLog('Check failed: ' + error.message);
            }
        }
        
        async function runAnalysis() {
            addToLog('Running safety analysis...');
            try {
                const response = await fetch('/api/safety/analyze', { method: 'POST' });
                const result = await response.json();
                addToLog('Safety analysis completed');
                refreshDashboard();
            } catch (error) {
                addToLog('Analysis failed: ' + error.message);
            }
        }
        
        async function refreshDashboard() {
            try {
                // Get monitoring status
                const statusResponse = await fetch('/api/monitoring/status');
                const status = await statusResponse.json();
                updateStatusDisplay(status);
                
                // Get recent alerts
                const alertsResponse = await fetch('/api/alerts/recent');
                const alerts = await alertsResponse.json();
                updateAlertsDisplay(alerts);
                
                addToLog('Dashboard refreshed');
            } catch (error) {
                addToLog('Failed to refresh dashboard: ' + error.message);
            }
        }
        
        function updateStatusDisplay(status) {
            // Update monitoring status indicator
            const statusText = document.getElementById('status-text');
            const statusIndicator = document.getElementById('status-indicator');
            
            if (status.is_monitoring_active) {
                statusText.textContent = 'Active';
                statusIndicator.className = 'status-indicator active pulse';
            } else {
                statusText.textContent = 'Inactive';
                statusIndicator.className = 'status-indicator inactive';
            }
            
            // Update metrics
            document.getElementById('kids-monitored').textContent = status.current_kids_in_danger || 0;
            document.getElementById('kids-in-danger').textContent = status.current_kids_in_danger || 0;
            document.getElementById('danger-zones').textContent = status.current_danger_zones || 0;
            document.getElementById('last-check').textContent = status.last_check ? 
                new Date(status.last_check).toLocaleTimeString() : 'Never';
            
            // Update system info
            document.getElementById('uptime').textContent = formatUptime(status.dashboard_uptime);
            document.getElementById('total-snapshots').textContent = status.total_snapshots || 0;
            document.getElementById('check-interval').textContent = '60 min'; // From config
        }
        
        function updateAlertsDisplay(alerts) {
            const container = document.getElementById('recent-alerts');
            
            if (alerts.length === 0) {
                container.innerHTML = '<p>No recent alerts</p>';
                return;
            }
            
            container.innerHTML = alerts.slice(0, 5).map(alert => \`
                <div class="alert-item \${alert.severity}">
                    <div class="alert-time">\${new Date(alert.timestamp).toLocaleString()}</div>
                    <strong>[\${alert.severity}] \${alert.type}</strong><br>
                    \${alert.message}
                </div>
            \`).join('');
        }
        
        function startEventStream() {
            if (eventSource) {
                eventSource.close();
            }
            
            eventSource = new EventSource('/api/monitoring/stream');
            
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                if (data.type === 'status') {
                    updateStatusDisplay(data.data);
                } else if (data.type === 'alert') {
                    addToLog(\`New alert: \${data.data.message}\`);
                    refreshDashboard();
                }
            };
            
            eventSource.onerror = function() {
                addToLog('Connection to monitoring stream lost');
            };
        }
        
        function addToLog(message) {
            const log = document.getElementById('activity-log');
            const timestamp = new Date().toLocaleTimeString();
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.innerHTML = \`<span class="log-timestamp">\${timestamp}</span>\${message}\`;
            
            log.appendChild(entry);
            log.scrollTop = log.scrollHeight;
            
            // Keep only last 50 entries
            while (log.children.length > 50) {
                log.removeChild(log.firstChild);
            }
        }
        
        function formatUptime(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return \`\${hours}h \${minutes}m\`;
        }
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            if (eventSource) {
                eventSource.close();
            }
        });
    </script>
</body>
</html>
        `;
    }

    startServer() {
        this.app.listen(this.port, () => {
            console.log(`🛡️ Safety Alert Dashboard running at http://localhost:${this.port}/dashboard`);
            console.log(`📊 API available at http://localhost:${this.port}/api/`);
        });
    }
}

// Start dashboard if run directly
if (require.main === module) {
    const port = process.argv.includes('--port') ? 
        parseInt(process.argv[process.argv.indexOf('--port') + 1]) : 3002;
    
    new SafetyAlertDashboard(port);
}

module.exports = { SafetyAlertDashboard };
