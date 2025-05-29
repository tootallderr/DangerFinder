/**
 * Alert Dispatcher - Automated alerting system for critical safety events
 * Handles email, SMS, and webhook notifications for danger zone alerts
 */

const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

class AlertDispatcher {
    constructor(config = {}) {
        this.config = {
            email: {
                enabled: config.email?.enabled || false,
                smtp: {
                    host: config.email?.smtp?.host || 'smtp.gmail.com',
                    port: config.email?.smtp?.port || 587,
                    secure: false,
                    auth: {
                        user: config.email?.smtp?.user || '',
                        pass: config.email?.smtp?.pass || ''
                    }
                },
                from: config.email?.from || 'safety-alerts@dangerfinder.local',
                recipients: config.email?.recipients || []
            },
            sms: {
                enabled: config.sms?.enabled || false,
                provider: config.sms?.provider || 'twilio',
                accountSid: config.sms?.accountSid || '',
                authToken: config.sms?.authToken || '',
                fromNumber: config.sms?.fromNumber || '',
                recipients: config.sms?.recipients || []
            },
            webhook: {
                enabled: config.webhook?.enabled || false,
                urls: config.webhook?.urls || []
            },
            console: {
                enabled: config.console?.enabled !== false
            }
        };

        this.alertQueue = [];
        this.processingAlert = false;
        this.alertHistory = [];
        this.maxHistorySize = 1000;

        // Initialize email transporter if enabled
        if (this.config.email.enabled) {
            this.emailTransporter = nodemailer.createTransporter(this.config.email.smtp);
        }
    }

    /**
     * Dispatch an alert through all configured channels
     */
    async dispatchAlert(alert) {
        const enrichedAlert = {
            ...alert,
            id: this.generateAlertId(),
            timestamp: new Date().toISOString(),
            dispatched_channels: []
        };

        console.log(`🚨 Dispatching ${alert.severity} alert: ${alert.title}`);

        try {
            // Add to queue for processing
            this.alertQueue.push(enrichedAlert);
            
            // Process immediately if not already processing
            if (!this.processingAlert) {
                await this.processAlertQueue();
            }

            return enrichedAlert.id;
        } catch (error) {
            console.error('❌ Failed to dispatch alert:', error);
            throw error;
        }
    }

    /**
     * Process queued alerts
     */
    async processAlertQueue() {
        if (this.processingAlert || this.alertQueue.length === 0) {
            return;
        }

        this.processingAlert = true;

        try {
            while (this.alertQueue.length > 0) {
                const alert = this.alertQueue.shift();
                await this.processAlert(alert);
                
                // Add to history
                this.alertHistory.unshift(alert);
                if (this.alertHistory.length > this.maxHistorySize) {
                    this.alertHistory = this.alertHistory.slice(0, this.maxHistorySize);
                }
            }
        } finally {
            this.processingAlert = false;
        }
    }

    /**
     * Process a single alert through all channels
     */
    async processAlert(alert) {
        const promises = [];

        // Console logging (always enabled unless explicitly disabled)
        if (this.config.console.enabled) {
            this.logToConsole(alert);
            alert.dispatched_channels.push('console');
        }

        // Email notifications
        if (this.config.email.enabled && this.config.email.recipients.length > 0) {
            promises.push(this.sendEmailAlert(alert));
        }

        // SMS notifications
        if (this.config.sms.enabled && this.config.sms.recipients.length > 0) {
            promises.push(this.sendSMSAlert(alert));
        }

        // Webhook notifications
        if (this.config.webhook.enabled && this.config.webhook.urls.length > 0) {
            promises.push(this.sendWebhookAlert(alert));
        }

        // Wait for all dispatches to complete
        await Promise.allSettled(promises);

        // Save alert to file
        await this.saveAlertToFile(alert);
    }

    /**
     * Send email alert
     */
    async sendEmailAlert(alert) {
        try {
            const htmlContent = this.generateEmailHTML(alert);
            const textContent = this.generateEmailText(alert);

            const mailOptions = {
                from: this.config.email.from,
                to: this.config.email.recipients.join(', '),
                subject: `🚨 ${alert.severity} Alert: ${alert.title}`,
                text: textContent,
                html: htmlContent
            };

            await this.emailTransporter.sendMail(mailOptions);
            alert.dispatched_channels.push('email');
            console.log(`📧 Email alert sent to ${this.config.email.recipients.length} recipients`);
        } catch (error) {
            console.error('❌ Failed to send email alert:', error.message);
        }
    }

    /**
     * Send SMS alert
     */
    async sendSMSAlert(alert) {
        try {
            // This would integrate with Twilio or another SMS provider
            const message = this.generateSMSText(alert);
            
            // Placeholder for SMS implementation
            console.log(`📱 SMS Alert would be sent: ${message}`);
            alert.dispatched_channels.push('sms');
        } catch (error) {
            console.error('❌ Failed to send SMS alert:', error.message);
        }
    }

    /**
     * Send webhook alert
     */
    async sendWebhookAlert(alert) {
        try {
            const payload = {
                alert_id: alert.id,
                timestamp: alert.timestamp,
                severity: alert.severity,
                title: alert.title,
                description: alert.description,
                details: alert.details,
                recommendations: alert.recommendations
            };

            const promises = this.config.webhook.urls.map(async (url) => {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'DangerFinder-AlertDispatcher/1.0'
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
                }
            });

            await Promise.all(promises);
            alert.dispatched_channels.push('webhook');
            console.log(`🔗 Webhook alerts sent to ${this.config.webhook.urls.length} endpoints`);
        } catch (error) {
            console.error('❌ Failed to send webhook alert:', error.message);
        }
    }

    /**
     * Log alert to console with formatting
     */
    logToConsole(alert) {
        const severityEmojis = {
            'CRITICAL': '🔴',
            'HIGH': '🟠',
            'MEDIUM': '🟡',
            'LOW': '🟢',
            'INFO': 'ℹ️'
        };

        const emoji = severityEmojis[alert.severity] || '⚠️';
        
        console.log('\n' + '='.repeat(60));
        console.log(`${emoji} ${alert.severity} SAFETY ALERT ${emoji}`);
        console.log('='.repeat(60));
        console.log(`📋 Title: ${alert.title}`);
        console.log(`⏰ Time: ${alert.timestamp}`);
        console.log(`📝 Description: ${alert.description}`);
        
        if (alert.details && Object.keys(alert.details).length > 0) {
            console.log('📊 Details:');
            Object.entries(alert.details).forEach(([key, value]) => {
                console.log(`   • ${key}: ${value}`);
            });
        }

        if (alert.recommendations && alert.recommendations.length > 0) {
            console.log('💡 Recommendations:');
            alert.recommendations.forEach((rec, index) => {
                console.log(`   ${index + 1}. ${rec}`);
            });
        }
        console.log('='.repeat(60) + '\n');
    }

    /**
     * Generate HTML email content
     */
    generateEmailHTML(alert) {
        const severityColors = {
            'CRITICAL': '#dc3545',
            'HIGH': '#fd7e14',
            'MEDIUM': '#ffc107',
            'LOW': '#28a745',
            'INFO': '#17a2b8'
        };

        const color = severityColors[alert.severity] || '#6c757d';

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .header { background: ${color}; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .details { background: #f8f9fa; padding: 15px; border-left: 4px solid ${color}; margin: 15px 0; }
                .recommendations { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 15px 0; }
                .footer { background: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🚨 Safety Alert: ${alert.severity}</h1>
                <h2>${alert.title}</h2>
            </div>
            <div class="content">
                <p><strong>Time:</strong> ${alert.timestamp}</p>
                <p><strong>Description:</strong> ${alert.description}</p>
                
                ${alert.details && Object.keys(alert.details).length > 0 ? `
                <div class="details">
                    <h3>📊 Alert Details</h3>
                    ${Object.entries(alert.details).map(([key, value]) => 
                        `<p><strong>${key}:</strong> ${value}</p>`
                    ).join('')}
                </div>
                ` : ''}
                
                ${alert.recommendations && alert.recommendations.length > 0 ? `
                <div class="recommendations">
                    <h3>💡 Recommendations</h3>
                    <ul>
                        ${alert.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                    </ul>
                </div>
                ` : ''}
            </div>
            <div class="footer">
                <p>DangerFinder Safety Monitoring System | Alert ID: ${alert.id}</p>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate plain text email content
     */
    generateEmailText(alert) {
        let text = `SAFETY ALERT: ${alert.severity}\n`;
        text += `${alert.title}\n\n`;
        text += `Time: ${alert.timestamp}\n`;
        text += `Description: ${alert.description}\n\n`;

        if (alert.details && Object.keys(alert.details).length > 0) {
            text += 'Details:\n';
            Object.entries(alert.details).forEach(([key, value]) => {
                text += `- ${key}: ${value}\n`;
            });
            text += '\n';
        }

        if (alert.recommendations && alert.recommendations.length > 0) {
            text += 'Recommendations:\n';
            alert.recommendations.forEach((rec, index) => {
                text += `${index + 1}. ${rec}\n`;
            });
        }

        text += `\nAlert ID: ${alert.id}`;
        return text;
    }

    /**
     * Generate SMS text content
     */
    generateSMSText(alert) {
        return `🚨 ${alert.severity}: ${alert.title} - ${alert.description} (ID: ${alert.id.slice(-8)})`;
    }

    /**
     * Save alert to file
     */
    async saveAlertToFile(alert) {
        try {
            const alertsDir = path.join(__dirname, '..', 'backend', 'data');
            const alertsFile = path.join(alertsDir, 'dispatched_alerts.json');

            let existingAlerts = [];
            try {
                const data = await fs.readFile(alertsFile, 'utf8');
                existingAlerts = JSON.parse(data);
            } catch (error) {
                // File doesn't exist or is empty, start with empty array
            }

            existingAlerts.unshift(alert);
            
            // Keep only the last 500 alerts
            if (existingAlerts.length > 500) {
                existingAlerts = existingAlerts.slice(0, 500);
            }

            await fs.writeFile(alertsFile, JSON.stringify(existingAlerts, null, 2));
        } catch (error) {
            console.error('❌ Failed to save alert to file:', error.message);
        }
    }

    /**
     * Generate unique alert ID
     */
    generateAlertId() {
        return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get alert statistics
     */
    getAlertStats() {
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recent = this.alertHistory.filter(alert => 
            new Date(alert.timestamp) > last24h
        );

        const severityCounts = recent.reduce((acc, alert) => {
            acc[alert.severity] = (acc[alert.severity] || 0) + 1;
            return acc;
        }, {});

        return {
            total_alerts_24h: recent.length,
            total_alerts_history: this.alertHistory.length,
            alerts_by_severity: severityCounts,
            queue_size: this.alertQueue.length,
            processing: this.processingAlert
        };
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        // Reinitialize email transporter if email config changed
        if (newConfig.email && this.config.email.enabled) {
            this.emailTransporter = nodemailer.createTransporter(this.config.email.smtp);
        }
    }

    /**
     * Create alert from danger monitoring data
     */
    static createDangerAlert(monitoringData, alertType = 'DANGER_ZONE_UPDATE') {
        const { summary, alerts } = monitoringData;
        
        if (!summary || !alerts) {
            throw new Error('Invalid monitoring data provided');
        }

        let severity = 'LOW';
        let title = 'Safety Monitoring Update';
        let description = 'Routine safety monitoring check completed';

        // Determine severity based on data
        if (summary.critical_pull_kids > 0) {
            severity = 'CRITICAL';
            title = 'Critical Children in Extreme Danger';
            description = `${summary.critical_pull_kids} children detected in critical danger zones with extreme gravitational pull`;
        } else if (summary.kids_in_danger > 10) {
            severity = 'HIGH';
            title = 'High Number of At-Risk Children';
            description = `${summary.kids_in_danger} children currently in danger zones requiring attention`;
        } else if (summary.kids_in_danger > 5) {
            severity = 'MEDIUM';
            title = 'Multiple Children in Danger Zones';
            description = `${summary.kids_in_danger} children currently in danger zones`;
        } else if (summary.kids_in_danger > 0) {
            severity = 'LOW';
            title = 'Children in Danger Zones Detected';
            description = `${summary.kids_in_danger} children currently in danger zones`;
        }

        return {
            type: alertType,
            severity,
            title,
            description,
            details: {
                'Total Kids Monitored': summary.total_kids_monitored,
                'Kids in Danger': summary.kids_in_danger,
                'Critical Pull Kids': summary.critical_pull_kids,
                'High Pull Kids': summary.high_pull_kids,
                'Active Danger Zones': summary.active_danger_zones,
                'Danger Sources': summary.danger_sources,
                'New Alerts': summary.new_alerts
            },
            recommendations: monitoringData.recommendations || []
        };
    }
}

module.exports = AlertDispatcher;

// CLI usage
if (require.main === module) {
    const dispatcher = new AlertDispatcher({
        email: {
            enabled: false, // Set to true and configure SMTP for email alerts
            recipients: ['admin@example.com', 'safety@example.com']
        },
        sms: {
            enabled: false, // Set to true and configure for SMS alerts
            recipients: ['+1234567890']
        },
        webhook: {
            enabled: false,
            urls: ['https://hooks.slack.com/your-webhook-url']
        }
    });

    // Test alert
    const testAlert = {
        type: 'TEST',
        severity: 'MEDIUM',
        title: 'Alert Dispatcher Test',
        description: 'Testing the alert dispatch system functionality',
        details: {
            'Test Type': 'System Validation',
            'Components': 'Email, SMS, Webhook, Console'
        },
        recommendations: [
            'Verify all alert channels are working correctly',
            'Configure production alert recipients',
            'Test alert frequency and throttling'
        ]
    };

    dispatcher.dispatchAlert(testAlert)
        .then(alertId => {
            console.log(`✅ Test alert dispatched with ID: ${alertId}`);
            console.log('📊 Alert Statistics:', dispatcher.getAlertStats());
        })
        .catch(error => {
            console.error('❌ Failed to dispatch test alert:', error);
        });
}
