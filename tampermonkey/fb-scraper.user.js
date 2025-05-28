// ==UserScript==
// @name         Facebook Social Graph Scraper
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Advanced Facebook profile scraper with depth tracking and community detection
// @author       You
// @match        https://www.facebook.com/*
// @match        https://facebook.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        API_BASE: 'http://localhost:3000/api',
        MAX_DEPTH: 5,
        SCRAPE_DELAY: 2000,
        FRIEND_LIMIT: 100
    };    let currentDepth = GM_getValue('currentDepth', 1);
    let isRunning = false;
    let debugPanel = null;
      // Enhanced state management with locking and validation
    let stateLock = false;
    const ScrapingState = {
        // Get current state
        get: () => ({
            workflow: GM_getValue('currentWorkflow', null),
            step: GM_getValue('currentStep', null),
            profileUrl: GM_getValue('currentProfileUrl', null),
            autoMode: GM_getValue('autoMode', false),
            depth: GM_getValue('currentDepth', 1),
            queueIndex: GM_getValue('queueIndex', 0),
            lastAction: GM_getValue('lastAction', null),
            timestamp: GM_getValue('stateTimestamp', null),
            transitionLock: GM_getValue('transitionLock', false),
            lastHeartbeat: GM_getValue('lastHeartbeat', Date.now())
        }),
        
        // Set state with validation and logging
        set: (newState) => {
            const oldState = ScrapingState.get();
            console.log(`🔄 State Update:`, {
                from: {
                    workflow: oldState.workflow,
                    step: oldState.step,
                    autoMode: oldState.autoMode,
                    lastAction: oldState.lastAction
                },
                to: newState
            });
            
            if (newState.workflow !== undefined) GM_setValue('currentWorkflow', newState.workflow);
            if (newState.step !== undefined) GM_setValue('currentStep', newState.step);
            if (newState.profileUrl !== undefined) GM_setValue('currentProfileUrl', newState.profileUrl);
            if (newState.autoMode !== undefined) GM_setValue('autoMode', newState.autoMode);
            if (newState.depth !== undefined) GM_setValue('currentDepth', newState.depth);
            if (newState.queueIndex !== undefined) GM_setValue('queueIndex', newState.queueIndex);
            if (newState.lastAction !== undefined) GM_setValue('lastAction', newState.lastAction);
            if (newState.transitionLock !== undefined) GM_setValue('transitionLock', newState.transitionLock);
            GM_setValue('stateTimestamp', Date.now());
            GM_setValue('lastHeartbeat', Date.now());
        },
        
        // Clear state preserving auto mode if specified
        clear: (preserveAutoMode = false) => {
            const currentAutoMode = preserveAutoMode ? GM_getValue('autoMode', false) : false;
            GM_setValue('currentWorkflow', null);
            GM_setValue('currentStep', null);
            GM_setValue('currentProfileUrl', null);
            GM_setValue('autoMode', currentAutoMode);
            GM_setValue('lastAction', 'state_cleared');
            GM_setValue('transitionLock', false);
            console.log(`🧹 State cleared (autoMode preserved: ${currentAutoMode})`);
        },
        
        // Check if we're in a workflow
        isActive: () => {
            const state = ScrapingState.get();
            return state.workflow && state.profileUrl;
        },
        
        // Check if state is recent (within 5 minutes)
        isRecent: () => {
            const state = ScrapingState.get();
            if (!state.timestamp) return false;
            return (Date.now() - state.timestamp) < 300000; // 5 minutes
        },
        
        // Validate state consistency
        validate: () => {
            const state = ScrapingState.get();
            const issues = [];
            
            if (state.autoMode && !state.workflow && !state.transitionLock) {
                issues.push('Auto mode active but no workflow');
            }
            
            if (state.workflow && !state.step) {
                issues.push('Workflow active but no step defined');
            }
            
            if (state.workflow && !state.profileUrl) {
                issues.push('Workflow active but no profile URL');
            }
            
            if (state.timestamp && (Date.now() - state.timestamp) > 600000) {
                issues.push('State is stale (over 10 minutes old)');
            }
            
            return {
                valid: issues.length === 0,
                issues: issues,
                state: state
            };
        },
        
        // Lock state during transitions
        lock: () => {
            GM_setValue('transitionLock', true);
            GM_setValue('stateTimestamp', Date.now());
        },
        
        // Unlock state
        unlock: () => {
            GM_setValue('transitionLock', false);
            GM_setValue('stateTimestamp', Date.now());
        }
    };

    // Profile annotation system for research purposes
    const ProfileAnnotations = {
        // Get annotations for a profile
        get: (profileUrl) => {
            const annotations = GM_getValue('profileAnnotations', {});
            return annotations[profileUrl] || null;
        },
        
        // Set annotation for a profile
        set: (profileUrl, annotation) => {
            const annotations = GM_getValue('profileAnnotations', {});
            const annotationData = {
                ...annotation,
                timestamp: Date.now(),
                lastUpdated: new Date().toISOString()
            };
            
            annotations[profileUrl] = annotationData;
            GM_setValue('profileAnnotations', annotations);
            
            // Also save to backend server
            ProfileAnnotations.saveToBackend(profileUrl, annotationData);
        },
        
        // Save annotation to backend server
        saveToBackend: async (profileUrl, annotation) => {
            try {
                const response = await sendToAPI('/annotations', {
                    profileUrl: profileUrl,
                    annotation: annotation
                });
                
                if (response && response.success) {
                    console.log(`✅ Conviction annotation saved to backend: ${profileUrl}`);
                    return true;
                } else {
                    console.error('Failed to save annotation to backend:', response);
                    return false;
                }
            } catch (error) {
                console.error('Error saving annotation to backend:', error);
                return false;
            }
        },
        
        // Remove annotation
        remove: (profileUrl) => {
            const annotations = GM_getValue('profileAnnotations', {});
            delete annotations[profileUrl];
            GM_setValue('profileAnnotations', annotations);
            
            // Also remove from backend
            ProfileAnnotations.removeFromBackend(profileUrl);
        },
        
        // Remove annotation from backend
        removeFromBackend: async (profileUrl) => {
            try {
                const encodedUrl = encodeURIComponent(profileUrl);
                const response = await sendToAPI(`/annotations/${encodedUrl}`, null, 'DELETE');
                
                if (response && response.success) {
                    console.log(`🗑️ Annotation removed from backend: ${profileUrl}`);
                    return true;
                } else {
                    console.error('Failed to remove annotation from backend:', response);
                    return false;
                }
            } catch (error) {
                console.error('Error removing annotation from backend:', error);
                return false;
            }
        },
        
        // Load annotations from backend on startup
        loadFromBackend: async () => {
            try {
                updateStatus('Loading annotations from backend...', 'info');
                const response = await sendToAPI('/annotations', null, 'GET');
                
                if (response && response.annotations) {
                    const localAnnotations = GM_getValue('profileAnnotations', {});
                    
                    // Merge backend annotations with local ones
                    // Local takes precedence over backend for any conflicts
                    const mergedAnnotations = { ...response.annotations, ...localAnnotations };
                    GM_setValue('profileAnnotations', mergedAnnotations);
                    
                    console.log(`📥 Loaded ${Object.keys(response.annotations).length} annotations from backend`);
                    updateStatus(`Loaded ${Object.keys(response.annotations).length} annotations from backend`, 'success');
                    updateProfileDisplay();
                    return response.annotations;
                }
            } catch (error) {
                console.error('Error loading annotations from backend:', error);
                updateStatus('Could not load annotations from backend', 'warning');
            }
        },
          // Get all annotated profiles
        getAll: () => {
            return GM_getValue('profileAnnotations', {});
        },
        
        // Export annotations for backup
        export: () => {
            const annotations = GM_getValue('profileAnnotations', {});
            const blob = new Blob([JSON.stringify(annotations, null, 2)], 
                                 { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `profile-annotations-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        
        // Get conviction data specifically
        getConvictions: () => {
            const annotations = GM_getValue('profileAnnotations', {});
            const convictions = {};
            for (const [url, annotation] of Object.entries(annotations)) {
                if (annotation.category === 'confirmed-conviction') {
                    convictions[url] = annotation;
                }
            }
            return convictions;
        },
        
        // Get convictions from backend
        getBackendConvictions: async () => {
            try {
                updateStatus('Fetching convictions from backend...', 'info');
                const response = await sendToAPI('/convictions', null, 'GET');
                
                if (response && response.convictions) {
                    console.log(`Found ${response.count} convictions in backend`);
                    updateStatus(`Found ${response.count} convictions in backend`, 'success');
                    return response.convictions;
                }
                updateStatus('No convictions found in backend', 'info');
                return {};
            } catch (error) {
                console.error('Error fetching backend convictions:', error);
                updateStatus('Failed to fetch convictions from backend', 'error');
                return {};
            }
        },
        
        // Sync all local annotations to backend
        syncToBackend: async () => {
            try {
                updateStatus('Syncing annotations to backend...', 'info');
                const localAnnotations = GM_getValue('profileAnnotations', {});
                let syncCount = 0;
                
                for (const [url, annotation] of Object.entries(localAnnotations)) {
                    try {
                        await sendToAPI('/annotations', {
                            profileUrl: url,
                            annotation: annotation
                        });
                        syncCount++;
                    } catch (error) {
                        console.error(`Failed to sync ${url}:`, error);
                    }
                }
                
                console.log(`Synced ${syncCount} annotations to backend`);
                updateStatus(`Synced ${syncCount} annotations to backend`, 'success');
                return syncCount;
            } catch (error) {
                console.error('Error syncing to backend:', error);
                updateStatus('Failed to sync annotations to backend', 'error');
                return 0;
            }
        },
        
        // Clear local annotations and reload only from backend
        resetToBackend: async () => {
            try {
                if (!confirm('Are you sure you want to clear all local annotations and reload from server?')) {
                    return false;
                }
                
                updateStatus('Clearing local annotations...', 'info');
                GM_setValue('profileAnnotations', {});
                
                updateStatus('Loading annotations from backend...', 'info');
                const response = await sendToAPI('/annotations', null, 'GET');
                
                if (response && response.annotations) {
                    GM_setValue('profileAnnotations', response.annotations);
                    console.log(`Reset completed: Loaded ${Object.keys(response.annotations).length} annotations from backend`);
                    updateStatus(`Reset completed with ${Object.keys(response.annotations).length} annotations`, 'success');
                    updateProfileDisplay();
                    return true;
                } else {
                    updateStatus('Reset completed but no annotations were found on backend', 'warning');
                    return false;
                }
            } catch (error) {
                console.error('Error during reset to backend:', error);
                updateStatus('Failed to reset annotations from backend', 'error');
                return false;
            }
        },
        
        // Get statistics about convictions (from both local and backend)
        getConvictionStats: async () => {
            updateStatus('Generating conviction statistics...', 'info');
            
            // Get local convictions
            const localConvictions = ProfileAnnotations.getConvictions();
            
            // Try to get backend convictions
            let backendConvictions = {};
            try {
                backendConvictions = await ProfileAnnotations.getBackendConvictions();
            } catch (error) {
                console.error('Failed to get backend convictions:', error);
            }
            
            // Generate stats
            const localCount = Object.keys(localConvictions).length;
            const backendCount = Object.keys(backendConvictions).length;
            
            // Find overlaps and unique entries
            const allUrls = new Set([
                ...Object.keys(localConvictions),
                ...Object.keys(backendConvictions)
            ]);
            
            const onlyLocal = [];
            const onlyBackend = [];
            const inBoth = [];
            
            for (const url of allUrls) {
                if (localConvictions[url] && backendConvictions[url]) {
                    inBoth.push(url);
                } else if (localConvictions[url]) {
                    onlyLocal.push(url);
                } else if (backendConvictions[url]) {
                    onlyBackend.push(url);
                }
            }
            
            // Categorize by crime type
            const crimeCategories = {};
            
            // Process local convictions
            for (const [url, conviction] of Object.entries(localConvictions)) {
                const category = conviction?.convictionDetails?.crimeCategory || 'Uncategorized';
                if (!crimeCategories[category]) {
                    crimeCategories[category] = { count: 0, urls: [] };
                }
                crimeCategories[category].count++;
                crimeCategories[category].urls.push(url);
            }
            
            // Process backend-only convictions
            for (const [url, conviction] of Object.entries(backendConvictions)) {
                // Skip if already counted from local
                if (localConvictions[url]) continue;
                
                const category = conviction?.convictionDetails?.crimeCategory || 'Uncategorized';
                if (!crimeCategories[category]) {
                    crimeCategories[category] = { count: 0, urls: [] };
                }
                crimeCategories[category].count++;
                crimeCategories[category].urls.push(url);
            }
            
            // Generate report
            const totalCount = allUrls.size;
            
            const report = {
                summary: {
                    totalConvictions: totalCount,
                    localConvictions: localCount,
                    backendConvictions: backendCount,
                    onlyLocal: onlyLocal.length,
                    onlyBackend: onlyBackend.length,
                    inBothStores: inBoth.length
                },
                crimeCategories: crimeCategories,
                syncStatus: {
                    needsSync: onlyLocal.length > 0,
                    missingLocal: onlyBackend
                }
            };
            
            // Log report to console
            console.log('%c📊 Conviction Statistics Report', 'font-size: 16px; font-weight: bold;');
            console.log(`Total confirmed convictions: ${totalCount}`);
            console.log(`- Local storage: ${localCount}`);
            console.log(`- Backend server: ${backendCount}`);
            console.log(`- In both stores: ${inBoth.length}`);
            console.log(`- Only in local: ${onlyLocal.length}`);
            console.log(`- Only in backend: ${onlyBackend.length}`);
            
            console.log('%c🔍 Crime Categories', 'font-size: 14px; font-weight: bold;');
            for (const [category, data] of Object.entries(crimeCategories)) {
                console.log(`${category}: ${data.count} conviction(s)`);
            }
            
            if (onlyLocal.length > 0) {
                console.log('%c⚠️ Local convictions not synced to backend', 'color: orange; font-weight: bold;');
                console.log('Run FB_Scraper.syncToBackend() to sync these convictions');
            }
            
            updateStatus(`Generated stats for ${totalCount} convictions`, 'success');
            return report;
        },
    };
    
    // Main UI Panel
    function createUI() {
        if (document.getElementById('fb-scraper-ui')) return;

        const panel = document.createElement('div');
        panel.id = 'fb-scraper-ui';
        panel.innerHTML = `
            <div style="
                position: fixed;
                top: 10px;
                right: 10px;
                width: 320px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border: none;
                border-radius: 12px;
                padding: 20px;
                z-index: 10000;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                color: white;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                font-size: 14px;
            ">
                <div style="text-align: center; margin-bottom: 15px;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: 600;">🕷️ FB Social Graph Scraper</h3>
                    <div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">
                        Depth: <span id="current-depth">${currentDepth}</span> / ${CONFIG.MAX_DEPTH}
                    </div>
                </div>                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
                    <button id="scrape-basic" style="
                        background: rgba(255,255,255,0.2);
                        border: 1px solid rgba(255,255,255,0.3);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">📋 Basic Info</button>
                    
                    <button id="scrape-about" style="
                        background: rgba(255,255,255,0.2);
                        border: 1px solid rgba(255,255,255,0.3);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">📝 About Page</button>
                    
                    <button id="scrape-friends" style="
                        background: rgba(255,255,255,0.2);
                        border: 1px solid rgba(255,255,255,0.3);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">👥 Friends List</button>
                    
                    <button id="scrape-full" style="
                        background: rgba(255,255,255,0.2);
                        border: 1px solid rgba(255,255,255,0.3);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">🔄 Full Scrape</button>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
                    <button id="auto-next" style="
                        background: rgba(46, 204, 113, 0.8);
                        border: 1px solid rgba(46, 204, 113, 1);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">⚡ Auto Next</button>
                    
                    <button id="stop-workflow" style="
                        background: rgba(231, 76, 60, 0.8);
                        border: 1px solid rgba(231, 76, 60, 1);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">🛑 Stop</button>
                </div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
                    <button id="workflow-friends" style="
                        background: rgba(155, 89, 182, 0.8);
                        border: 1px solid rgba(155, 89, 182, 1);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">👥 Friends Auto</button>
                    
                    <button id="view-queue" style="
                        background: rgba(52, 152, 219, 0.8);
                        border: 1px solid rgba(52, 152, 219, 1);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">📊 View Queue</button>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
                    <button id="mark-conviction" style="
                        background: rgba(231, 76, 60, 0.9);
                        border: 1px solid rgba(231, 76, 60, 1);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                        font-weight: bold;
                    ">🚨 Mark Conviction</button>
                    
                    <button id="annotate-profile" style="
                        background: rgba(142, 68, 173, 0.8);
                        border: 1px solid rgba(142, 68, 173, 1);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        transition: all 0.3s;
                    ">📝 Annotate</button>
                </div>

                <div style="margin-bottom: 15px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <label style="font-size: 12px;">Depth:</label>
                        <input type="range" id="depth-slider" min="1" max="${CONFIG.MAX_DEPTH}" value="${currentDepth}" 
                               style="flex: 1; cursor: pointer;">
                        <span id="depth-value" style="font-size: 12px; font-weight: bold;">${currentDepth}</span>
                    </div>
                </div>

                <div id="status-area" style="
                    background: rgba(0,0,0,0.2);
                    border-radius: 6px;
                    padding: 10px;
                    margin-bottom: 10px;
                    font-size: 12px;
                    max-height: 120px;
                    overflow-y: auto;
                ">
                    <div id="status-text">Ready to scrape...</div>
                </div>                <div style="display: flex; gap: 8px;">
                    <button id="test-backend" style="
                        background: rgba(17, 122, 101, 0.8);
                        border: 1px solid rgba(17, 122, 101, 1);
                        color: white;
                        padding: 6px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 11px;
                        flex: 1;
                    ">🔗 Test API</button>
                    
                    <button id="toggle-debug" style="
                        background: rgba(255,193,7,0.8);
                        border: 1px solid rgba(255,193,7,1);
                        color: white;
                        padding: 6px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 11px;
                        flex: 1;
                    ">🐛 Debug</button>
                    
                    <button id="minimize-panel" style="
                        background: rgba(255,255,255,0.2);
                        border: 1px solid rgba(255,255,255,0.3);
                        color: white;
                        padding: 6px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 11px;
                        flex: 1;
                    ">📐 Min</button>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        attachEventListeners();
        addHoverEffects();
    }

    function addHoverEffects() {
        const buttons = document.querySelectorAll('#fb-scraper-ui button');
        buttons.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateY(-2px)';
                btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = 'none';
            });
        });
    }

    function attachEventListeners() {
        // Depth slider
        const depthSlider = document.getElementById('depth-slider');
        const depthValue = document.getElementById('depth-value');
        const currentDepthDisplay = document.getElementById('current-depth');

        depthSlider.addEventListener('input', (e) => {
            currentDepth = parseInt(e.target.value);
            depthValue.textContent = currentDepth;
            currentDepthDisplay.textContent = currentDepth;
            GM_setValue('currentDepth', currentDepth);
        });        // Scraping buttons        document.getElementById('scrape-basic').addEventListener('click', () => startWorkflow('basic_only'));
        document.getElementById('scrape-about').addEventListener('click', () => startWorkflow('about_only'));
        document.getElementById('scrape-friends').addEventListener('click', () => startWorkflow('friends_only'));
        document.getElementById('scrape-full').addEventListener('click', () => startWorkflow('full_scrape'));
        document.getElementById('auto-next').addEventListener('click', () => autoNext());
        document.getElementById('stop-workflow').addEventListener('click', () => stopWorkflow());
        document.getElementById('workflow-friends').addEventListener('click', () => startAutoWorkflow('friends_only'));
        document.getElementById('view-queue').addEventListener('click', () => viewQueue());
        document.getElementById('mark-conviction').addEventListener('click', () => quickMarkConviction());
        document.getElementById('annotate-profile').addEventListener('click', () => showAnnotationDialog());
        document.getElementById('test-backend').addEventListener('click', () => testBackendConnection());
        document.getElementById('toggle-debug').addEventListener('click', () => toggleDebugPanel());
        document.getElementById('minimize-panel').addEventListener('click', () => minimizePanel());}

    // Status and logging functions
    function updateStatus(message, type = 'info') {
        const statusText = document.getElementById('status-text');
        const timestamp = new Date().toLocaleTimeString();
        const emoji = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
        
        // Check if we should show workflow status instead
        const state = ScrapingState.get();
        if (state.workflow && state.profileUrl && type !== 'error') {
            const workflowInfo = `🔄 ${state.workflow} → ${state.step}`;
            statusText.innerHTML = `
                <div style="font-weight: bold; color: #4CAF50;">${workflowInfo}</div>
                <div style="font-size: 11px; opacity: 0.8;">Current: ${message}</div>
                <div style="font-size: 10px; opacity: 0.6;">Auto: ${state.autoMode ? 'ON' : 'OFF'} | ${timestamp}</div>
            `;
        } else {
            statusText.innerHTML = `[${timestamp}] ${emoji} ${message}`;
        }
          console.log(`FB Scraper: ${message}`);
    }

    function addLog(message) {
        const statusArea = document.getElementById('status-area');
        const timestamp = new Date().toLocaleTimeString();
        const logDiv = document.createElement('div');
        logDiv.innerHTML = `[${timestamp}] ${message}`;
        statusArea.appendChild(logDiv);
        statusArea.scrollTop = statusArea.scrollHeight;
    }

    // Core scraping functions
    async function scrapeBasicInfo() {
        updateStatus('Scraping basic profile info...', 'info');
        
        try {
            const profileData = {
                url: getCurrentProfileUrl(),
                name: extractProfileName(),
                profile_image: await extractProfileImage(),
                depth: currentDepth,
                type: 'basic'
            };

            await sendToAPI('/profile', profileData);
            updateStatus(`Basic info scraped for: ${profileData.name}`, 'success');
        } catch (error) {
            updateStatus(`Error scraping basic info: ${error.message}`, 'error');
        }
    }    async function scrapeAboutPage() {
        updateStatus('Scraping About page...', 'info');
        
        try {
            const currentUrl = getCurrentProfileUrl();
            let aboutUrl;
            
            // Handle different profile URL formats for about page
            if (currentUrl.includes('/profile.php')) {
                // For numerical profiles, use the profile.php format with about section
                if (currentUrl.includes('?id=')) {
                    const idMatch = currentUrl.match(/\?id=(\d+)/);
                    if (idMatch) {
                        aboutUrl = `https://www.facebook.com/profile.php?id=${idMatch[1]}&sk=about`;
                    } else {
                        aboutUrl = currentUrl + '&sk=about';
                    }
                } else {
                    aboutUrl = currentUrl + '?sk=about';
                }
            } else {
                // For regular username profiles
                aboutUrl = currentUrl + '/about';
            }
            
            console.log(`🔗 Current URL: ${window.location.href}`);
            console.log(`🔗 Target about URL: ${aboutUrl}`);
            
            if (!window.location.href.includes('about') && !window.location.href.includes('sk=about')) {
                updateStatus('Navigating to About page...', 'info');
                window.location.href = aboutUrl;
                return;
            }

            console.log('✅ On about page, extracting data...');
            const aboutData = extractAboutInfo();
            
            console.log('📊 Extracted about data:', aboutData);
            
            const profileData = {
                url: currentUrl,
                name: extractProfileName(),
                about: aboutData,
                depth: currentDepth,
                type: 'about'
            };

            console.log('📤 Sending profile data to API:', profileData);
            const response = await sendToAPI('/profile', profileData);
            console.log('📥 API response:', response);
            
            updateStatus('About page data scraped successfully', 'success');
        } catch (error) {
            console.error('❌ Error scraping about page:', error);
            updateStatus(`Error scraping about page: ${error.message}`, 'error');
        }
    }async function scrapeFriendsList() {
        updateStatus('Scraping friends list...', 'info');
        
        try {
            const currentUrl = getCurrentProfileUrl();
            let friendsUrl;
            
            // Handle different profile URL formats
            if (currentUrl.includes('/profile.php')) {
                // For numerical profiles, use the profile.php format with friends section
                if (currentUrl.includes('?id=')) {
                    const idMatch = currentUrl.match(/\?id=(\d+)/);
                    if (idMatch) {
                        friendsUrl = `https://www.facebook.com/profile.php?id=${idMatch[1]}&sk=friends`;
                    } else {
                        friendsUrl = currentUrl + '&sk=friends';
                    }
                } else {
                    friendsUrl = currentUrl + '?sk=friends';
                }
            } else {
                // For regular username profiles
                friendsUrl = currentUrl + '/friends';
            }
            
            if (!window.location.href.includes('friends') && !window.location.href.includes('sk=friends')) {
                window.location.href = friendsUrl;
                return;
            }            const friends = await extractFriendsList();
            
            // Get the base profile URL (without friends path/parameter)
            let baseProfileUrl = getCurrentProfileUrl();
            if (baseProfileUrl.includes('/friends')) {
                baseProfileUrl = baseProfileUrl.replace('/friends', '');
            }
            if (baseProfileUrl.includes('&sk=friends')) {
                baseProfileUrl = baseProfileUrl.replace('&sk=friends', '');
            }
            if (baseProfileUrl.includes('?sk=friends')) {
                baseProfileUrl = baseProfileUrl.replace('?sk=friends', '');
            }
            
            const profileData = {
                url: baseProfileUrl,
                name: extractProfileName(),
                friends: friends,
                depth: currentDepth,
                type: 'friends'
            };

            await sendToAPI('/profile', profileData);
            
            // Add friends to queue for next depth level
            if (currentDepth < CONFIG.MAX_DEPTH) {
                const friendUrls = friends.map(f => f.url).filter(url => url);
                if (friendUrls.length > 0) {
                    await sendToAPI('/queue', { urls: friendUrls, depth: currentDepth + 1 });
                    updateStatus(`Added ${friendUrls.length} friends to queue at depth ${currentDepth + 1}`, 'success');
                }
            }

            updateStatus(`Scraped ${friends.length} friends`, 'success');
        } catch (error) {
            updateStatus(`Error scraping friends: ${error.message}`, 'error');
        }
    }    async function scrapeFullProfile() {
        updateStatus('Starting full profile scrape...', 'info');
        
        try {
            // Basic info
            const currentUrl = getCurrentProfileUrl();
            const basicData = {
                url: currentUrl,
                name: extractProfileName(),
                profile_image: await extractProfileImage()
            };

            // Navigate to about page with proper URL format
            let aboutUrl;
            if (currentUrl.includes('/profile.php')) {
                // For numerical profiles
                if (currentUrl.includes('?id=')) {
                    const idMatch = currentUrl.match(/\?id=(\d+)/);
                    if (idMatch) {
                        aboutUrl = `https://www.facebook.com/profile.php?id=${idMatch[1]}&sk=about`;
                    } else {
                        aboutUrl = currentUrl + '&sk=about';
                    }
                } else {
                    aboutUrl = currentUrl + '?sk=about';
                }
            } else {
                // For regular username profiles
                aboutUrl = currentUrl + '/about';
            }
            
            if (!window.location.href.includes('about') && !window.location.href.includes('sk=about')) {
                updateStatus('Navigating to About page...', 'info');
                setTimeout(() => {
                    window.location.href = aboutUrl;
                }, 1000);
                return;
            }

            const aboutData = extractAboutInfo();
            
            // Combine all data
            const fullProfileData = {
                ...basicData,
                about: aboutData,
                depth: currentDepth,
                type: 'full',
                scraped_sections: ['basic', 'about']
            };            await sendToAPI('/profile', fullProfileData);
            updateStatus('Full profile scraped successfully', 'success');

            // Navigate to friends after a delay with proper URL format
            setTimeout(() => {
                const currentUrl = getCurrentProfileUrl();
                let friendsUrl;
                
                if (currentUrl.includes('/profile.php')) {
                    // For numerical profiles
                    if (currentUrl.includes('?id=')) {
                        const idMatch = currentUrl.match(/\?id=(\d+)/);
                        if (idMatch) {
                            friendsUrl = `https://www.facebook.com/profile.php?id=${idMatch[1]}&sk=friends`;
                        } else {
                            friendsUrl = currentUrl + '&sk=friends';
                        }
                    } else {
                        friendsUrl = currentUrl + '?sk=friends';
                    }
                } else {
                    // For regular username profiles
                    friendsUrl = currentUrl + '/friends';
                }
                
                updateStatus('Navigating to friends list...', 'info');
                window.location.href = friendsUrl;
            }, 2000);

        } catch (error) {
            updateStatus(`Error in full scrape: ${error.message}`, 'error');
        }
    }      // Auto navigation with enhanced workflow management and state validation
    async function autoNext() {
        const currentState = ScrapingState.get();
        
        // Validate state before proceeding
        const validation = ScrapingState.validate();
        if (!validation.valid) {
            console.warn('⚠️ Auto Mode: State validation failed:', validation.issues);
            // Try to recover from invalid state
            if (currentState.autoMode) {
                console.log('🔧 Auto Mode: Attempting state recovery...');
                ScrapingState.clear(true); // Clear but preserve auto mode
                // Continue with fresh state
            } else {
                updateStatus('Auto mode stopped due to invalid state', 'error');
                return;
            }
        }
        
        // Prevent multiple concurrent autoNext calls
        if (stateLock) {
            console.log('🔒 Auto Mode: State locked, skipping autoNext call');
            return;
        }
        
        // If already running in auto mode, show status instead of creating duplicate processes
        if (isRunning && currentState.autoMode) {
            console.log('ℹ️ Auto Mode: Already active, showing status');
            updateStatus('Auto mode is already active', 'info');
            return;
        }
          // Start auto mode if not running
        if (!isRunning) {
            stateLock = true;
            isRunning = true;
            ScrapingState.set({ 
                autoMode: true, 
                lastAction: 'auto_mode_started',
                transitionLock: false 
            });
            updateStatus('Auto scraper activated...', 'info');
            updateHeartbeat();
            startAutoModeHeartbeat();
            stateLock = false;
        }

        try {
            // Check if we're continuing a workflow (with transition lock check)
            if (currentState.workflow && currentState.isRecent() && ScrapingState.isActive() && !currentState.transitionLock) {
                console.log('🔄 Auto Mode: Continuing existing workflow');
                updateStatus(`Continuing workflow: ${currentState.workflow} - ${currentState.step}`, 'info');
                await continueWorkflow();
                return;
            } else if (currentState.transitionLock) {
                console.log('🔒 Auto Mode: Workflow in transition, waiting...');
                setTimeout(() => {
                    if (ScrapingState.get().autoMode) {
                        autoNext();
                    }
                }, 3000);
                return;
            }            // Get next URL from queue with enhanced retry logic
            console.log(`🔍 Auto Mode: Requesting next URL with maxDepth=${CONFIG.MAX_DEPTH}`);
            updateStatus('Getting next profile from queue...', 'info');
            
            let response;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
                try {
                    response = await sendToAPI(`/scrape/next?maxDepth=${CONFIG.MAX_DEPTH}`, null, 'GET');
                    if (response && response.url) {
                        break;
                    } else if (response && response.message) {
                        console.log(`ℹ️ API Response: ${response.message}`);
                        break;
                    }
                } catch (error) {
                    retryCount++;
                    console.warn(`⚠️ API call failed (attempt ${retryCount}/${maxRetries}):`, error);
                    if (retryCount >= maxRetries) {
                        throw error;
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // Exponential backoff
                }
            }            if (response && response.url) {
                // Lock state during transition
                ScrapingState.lock();
                
                // Update current depth to match the URL we're about to scrape
                const newDepth = response.depth || 1;
                currentDepth = newDepth;
                GM_setValue('currentDepth', currentDepth);
                
                console.log(`✅ Auto Mode: Got next URL - ${response.url} (depth ${currentDepth})`);
                console.log(`📊 Queue status: ${response.remaining || 0} remaining, ${response.availableAtDepth || 0} at current depth`);
                
                // Update UI depth display with validation
                try {
                    const depthDisplay = document.getElementById('current-depth');
                    const depthValue = document.getElementById('depth-value');
                    const depthSlider = document.getElementById('depth-slider');
                    if (depthDisplay) depthDisplay.textContent = currentDepth;
                    if (depthValue) depthValue.textContent = currentDepth;
                    if (depthSlider) depthSlider.value = currentDepth;
                } catch (e) {
                    console.warn('Could not update UI depth display:', e);
                }
                
                // Start new workflow with persistent state
                ScrapingState.set({
                    workflow: 'full_scrape',
                    step: 'basic_info',
                    profileUrl: response.url,
                    queueIndex: response.queueIndex || 0,
                    depth: currentDepth,
                    autoMode: true,
                    lastAction: 'starting_new_workflow',
                    transitionLock: true // Lock during navigation
                });
                
                updateStatus(`Auto Mode: Starting workflow for ${response.url} (depth ${currentDepth})`, 'info');
                
                // Navigate to the profile with validation delay
                setTimeout(() => {
                    console.log(`🌐 Auto Mode: Navigating to ${response.url}`);
                    try {
                        window.location.href = response.url;
                    } catch (error) {
                        console.error('❌ Navigation failed:', error);
                        ScrapingState.unlock();
                        updateStatus('Navigation failed, retrying...', 'error');
                        setTimeout(() => {
                            if (ScrapingState.get().autoMode) autoNext();
                        }, 5000);
                    }
                }, 2000);
                
            } else {
                console.log('ℹ️ Auto Mode: No more URLs available in queue');
                updateStatus('No more URLs in queue - Auto mode paused', 'info');
                
                // Don't stop auto mode completely, just pause it
                isRunning = false;
                ScrapingState.set({ 
                    lastAction: 'queue_empty_paused',
                    transitionLock: false 
                });
                
                updateStatus('Auto mode paused - no URLs available. Checking again in 30 seconds...', 'warning');
                
                // Check again in 30 seconds with exponential backoff
                let recheckDelay = 30000;
                const recheckAttempt = GM_getValue('recheckAttempt', 0);
                if (recheckAttempt > 0) {
                    recheckDelay = Math.min(30000 * Math.pow(2, recheckAttempt), 300000); // Max 5 minutes
                }
                
                setTimeout(() => {
                    if (ScrapingState.get().autoMode && !isRunning) {
                        console.log(`🔄 Auto Mode: Recheck attempt ${recheckAttempt + 1}, checking for new queue items...`);
                        GM_setValue('recheckAttempt', recheckAttempt + 1);
                        autoNext();
                    }
                }, recheckDelay);
            }        } catch (error) {
            console.error('❌ Auto Mode: Error in autoNext:', error);
            updateStatus(`Auto mode error: ${error.message} - Retrying in 10 seconds`, 'error');
            
            // Unlock state if locked
            ScrapingState.unlock();
            
            // Don't stop auto mode on errors, retry after delay with exponential backoff
            const errorCount = GM_getValue('autoNextErrorCount', 0) + 1;
            GM_setValue('autoNextErrorCount', errorCount);
            
            const retryDelay = Math.min(10000 * errorCount, 60000); // Max 1 minute delay
            
            setTimeout(() => {
                if (ScrapingState.get().autoMode) {
                    console.log(`🔄 Auto Mode: Retry attempt ${errorCount} after error...`);
                    autoNext();
                }
            }, retryDelay);
        }
    }      // Continue existing workflow with enhanced error handling and state management
    async function continueWorkflow() {
        const workflowState = ScrapingState.get();
        const currentUrl = getCurrentProfileUrl();
        
        console.log(`🔄 Continue Workflow: ${workflowState.workflow} - ${workflowState.step}`);
        console.log(`🔗 Expected URL: ${workflowState.profileUrl}`);
        console.log(`🔗 Current URL: ${currentUrl}`);
        
        updateStatus(`Continuing workflow: ${workflowState.workflow} - ${workflowState.step}`, 'info');
        updateHeartbeat();
        
        // Unlock transition lock if we're continuing a workflow
        if (workflowState.transitionLock) {
            console.log('🔓 Unlocking transition lock to continue workflow');
            ScrapingState.unlock();
        }
        
        // Verify we're on the correct profile
        if (workflowState.profileUrl && currentUrl !== workflowState.profileUrl) {
            const urlMismatch = !currentUrl.includes(workflowState.profileUrl.split('?')[0].split('/').pop());
            if (urlMismatch) {
                console.warn(`⚠️ URL mismatch detected, expected: ${workflowState.profileUrl}, got: ${currentUrl}`);
                updateStatus(`URL mismatch, navigating back to ${workflowState.profileUrl}`, 'warning');
                
                // Lock during navigation
                ScrapingState.set({ transitionLock: true, lastAction: 'correcting_navigation' });
                
                setTimeout(() => {
                    try {
                        window.location.href = workflowState.profileUrl;
                    } catch (error) {
                        console.error('❌ Navigation correction failed:', error);
                        ScrapingState.unlock();
                        if (workflowState.autoMode) {
                            setTimeout(() => autoNext(), 5000);
                        }
                    }
                }, 1000);
                return;
            }
        }
        
        try {
            switch (workflowState.workflow) {
                case 'full_scrape':
                    await executeFullScrapeWorkflow(workflowState.step);
                    break;
                case 'friends_only':
                    await executeFriendsWorkflow(workflowState.step);
                    break;
                case 'about_only':
                    await executeAboutWorkflow(workflowState.step);
                    break;
                default:
                    console.error(`❌ Unknown workflow: ${workflowState.workflow}`);
                    updateStatus(`Unknown workflow: ${workflowState.workflow}`, 'error');
                    
                    // Clear invalid workflow state and try to recover
                    ScrapingState.set({
                        workflow: null,
                        step: null,
                        lastAction: 'unknown_workflow_cleared'
                    });
                    
                    if (workflowState.autoMode) {
                        updateStatus('Attempting to recover by starting new workflow...', 'warning');
                        setTimeout(() => {
                            if (ScrapingState.get().autoMode) {
                                autoNext();
                            }
                        }, 3000);
                    }
            }
        } catch (error) {
            console.error('❌ Error in continueWorkflow:', error);
            updateStatus(`Workflow error: ${error.message}`, 'error');
            
            // Unlock any locked state
            ScrapingState.unlock();
            
            // Try to recover if in auto mode
            if (workflowState.autoMode) {
                updateStatus('Attempting to recover workflow...', 'warning');
                
                // Clear potentially corrupted workflow state
                ScrapingState.set({
                    workflow: null,
                    step: null,
                    lastAction: 'workflow_error_recovery'
                });
                
                setTimeout(() => {
                    if (ScrapingState.get().autoMode) {
                        console.log('🔧 Attempting recovery after workflow error');
                        autoNext();
                    }
                }, 5000);
            } else {
                isRunning = false;
                updateStatus('Workflow failed and auto mode is not active', 'error');
            }
        }
    }
      // Execute full scrape workflow
    async function executeFullScrapeWorkflow(currentStep) {
        updateHeartbeat();
        console.log(`🔄 Executing full scrape step: ${currentStep}`);
        
        switch (currentStep) {
            case 'basic_info':
                await scrapeBasicInfo();
                ScrapingState.set({ step: 'friends_list', lastAction: 'completed_basic_info' });
                setTimeout(() => navigateToFriends(), 3000);
                break;
                
            case 'friends_list':
                await scrapeFriendsList();
                ScrapingState.set({ step: 'about_page', lastAction: 'completed_friends_list' });
                setTimeout(() => navigateToAbout(), 3000);
                break;
                
            case 'about_page':
                await scrapeAboutPage();
                ScrapingState.set({ step: 'complete', lastAction: 'completed_about_page' });
                setTimeout(() => completeWorkflowAndNext(), 3000);
                break;
                
            case 'complete':
                await completeWorkflowAndNext();
                break;
                
            default:
                console.error(`❌ Unknown step: ${currentStep}`);
                updateStatus(`Unknown step: ${currentStep}`, 'error');
                
                // Try to recover by restarting workflow
                if (ScrapingState.get().autoMode) {
                    updateStatus('Attempting to recover by restarting workflow...', 'warning');
                    setTimeout(() => autoNext(), 3000);
                }
        }
    }
    
    // Workflow management functions
    async function startWorkflow(workflowType) {
        const currentUrl = getCurrentProfileUrl();
        
        ScrapingState.set({
            workflow: workflowType,
            step: 'basic_info',
            profileUrl: currentUrl,
            autoMode: false
        });
        
        updateStatus(`Starting ${workflowType} workflow...`, 'info');
        isRunning = true;
        
        // Execute the workflow
        setTimeout(() => {
            continueWorkflow();
        }, 1000);
    }
    
    async function startAutoWorkflow(workflowType) {
        ScrapingState.set({ autoMode: true });
        GM_setValue('preferredWorkflow', workflowType);
        updateStatus(`Starting auto ${workflowType} mode...`, 'info');
        autoNext();
    }    function stopWorkflow() {
        isRunning = false;
        stopAutoModeHeartbeat();
        ScrapingState.set({
            workflow: null,
            step: null,
            profileUrl: null,
            autoMode: false,
            lastAction: null
        });
        updateStatus('Workflow stopped and auto mode disabled', 'warning');
    }
    
    // Update status display to show current workflow state
    function updateWorkflowStatus() {
        const state = ScrapingState.get();
        const statusElement = document.getElementById('status-text');
        
        if (state.workflow && ScrapingState.isActive()) {
            const workflowInfo = `🔄 ${state.workflow} → ${state.step}`;
            statusElement.innerHTML = `
                <div style="font-weight: bold; color: #4CAF50;">${workflowInfo}</div>
                <div style="font-size: 11px; opacity: 0.8;">${state.profileUrl}</div>
                <div style="font-size: 10px; opacity: 0.6;">Auto: ${state.autoMode ? 'ON' : 'OFF'}</div>
            `;
        }
    }
    
    // Execute friends-only workflow
    async function executeFriendsWorkflow(currentStep) {
        switch (currentStep) {
            case 'basic_info':
                await scrapeBasicInfo();
                ScrapingState.set({ step: 'friends_list' });
                setTimeout(() => navigateToFriends(), 3000);
                break;
                
            case 'friends_list':
                await scrapeFriendsList();
                await completeWorkflowAndNext();
                break;
                
            default:                updateStatus(`Unknown friends workflow step: ${currentStep}`, 'error');
                ScrapingState.clear();
        }
    }
    
    // Execute about-only workflow
    async function executeAboutWorkflow(currentStep) {
        switch (currentStep) {
            case 'basic_info':
                await scrapeBasicInfo();
                ScrapingState.set({ step: 'about_page' });
                setTimeout(() => navigateToAbout(), 3000);
                break;
                
            case 'about_page':
                await scrapeAboutPage();
                await completeWorkflowAndNext();
                break;
                
            default:
                updateStatus(`Unknown about workflow step: ${currentStep}`, 'error');
                ScrapingState.clear();
        }
    }    // Complete workflow and move to next profile with enhanced state management
    async function completeWorkflowAndNext() {
        const currentState = ScrapingState.get();
        updateHeartbeat();
        
        console.log(`✅ Completed workflow for ${currentState.profileUrl}`);
        updateStatus(`Completed workflow for ${currentState.profileUrl}`, 'success');
        
        // Reset error counters on successful completion
        GM_setValue('autoNextErrorCount', 0);
        GM_setValue('recheckAttempt', 0);
        
        // Lock state during transition to prevent race conditions
        ScrapingState.lock();
        
        // Keep auto mode flag active but clear the current workflow
        const wasAutoMode = currentState.autoMode;
        
        try {
            ScrapingState.set({
                workflow: null,
                step: null,
                profileUrl: null,
                autoMode: wasAutoMode,  // Preserve auto mode state
                lastAction: 'workflow_completed',
                transitionLock: true // Keep locked during transition
            });
            
            // If we were in auto mode, continue with proper coordination
            if (wasAutoMode) {
                console.log('🔄 Auto Mode: Transitioning to next profile in queue');
                updateStatus('Moving to next profile in queue...', 'info');
                
                // Reset running flag but maintain auto mode
                isRunning = false;
                
                // Unlock state before proceeding
                ScrapingState.unlock();
                
                // Wait a bit longer to ensure page navigation is complete
                setTimeout(() => {
                    // Double-check auto mode is still active before proceeding
                    const currentAutoState = ScrapingState.get();
                    if (currentAutoState.autoMode) {
                        console.log('� Auto Mode: Continuing to next workflow');
                        autoNext();
                    } else {
                        console.log('⏹️ Auto Mode: Was disabled during transition, stopping');
                        updateStatus('Auto mode was disabled during transition', 'info');
                    }
                }, 3000);
            } else {
                // Manual mode completion
                isRunning = false;
                ScrapingState.unlock();
                stopAutoModeHeartbeat();
                updateStatus('Workflow completed. Auto mode stopped.', 'info');
            }
        } catch (error) {
            console.error('❌ Error in completeWorkflowAndNext:', error);
            ScrapingState.unlock();
            
            if (wasAutoMode) {
                updateStatus('Error completing workflow, attempting recovery...', 'error');
                setTimeout(() => {
                    if (ScrapingState.get().autoMode) {
                        autoNext();
                    }
                }, 5000);
            } else {
                isRunning = false;
                updateStatus('Error completing workflow', 'error');
            }
        }
    }
    
    // Navigation helpers
    async function navigateToFriends() {
        const currentUrl = getCurrentProfileUrl();
        let friendsUrl;
        
        if (currentUrl.includes('/profile.php')) {
            // Numerical profile: profile.php?id=123&sk=friends
            const match = currentUrl.match(/profile\.php\?id=(\d+)/);
            if (match) {
                friendsUrl = `${currentUrl}&sk=friends`;
            }
        } else {
            // Username profile: username/friends
            friendsUrl = `${currentUrl}/friends`;
        }
        
        if (friendsUrl) {
            ScrapingState.set({ lastAction: 'navigating_to_friends' });
            updateStatus(`Navigating to friends page...`, 'info');
            window.location.href = friendsUrl;
        } else {
            updateStatus('Could not determine friends URL', 'error');
        }
    }
    
    async function navigateToAbout() {
        const currentUrl = getCurrentProfileUrl();
        let aboutUrl;
        
        if (currentUrl.includes('/profile.php')) {
            // Numerical profile: profile.php?id=123&sk=about
            const match = currentUrl.match(/profile\.php\?id=(\d+)/);
            if (match) {
                aboutUrl = `${currentUrl}&sk=about`;
            }
        } else {
            // Username profile: username/about
            aboutUrl = `${currentUrl}/about`;
        }
        
        if (aboutUrl) {
            ScrapingState.set({ lastAction: 'navigating_to_about' });
            updateStatus(`Navigating to about page...`, 'info');
            window.location.href = aboutUrl;
        } else {
            updateStatus('Could not determine about URL', 'error');
        }
    }

    // Extraction functions
    function extractProfileName() {
        // Try multiple selectors for profile name
        const selectors = [
            'h1[data-overviewsection="true"]',
            'h1',
            '[data-testid="profile_header_name"]',
            '.x1heor9g .x1qlqyl8',
            '.profile-name'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                return element.textContent.trim();
            }
        }

        return 'Unknown Profile';
    }    function getCurrentProfileUrl() {
        let url = window.location.href;
        
        // For numerical profiles (profile.php), preserve the ID parameter
        if (url.includes('/profile.php')) {
            // Extract the base URL with ID parameter
            const match = url.match(/^(https?:\/\/[^\/]+\/profile\.php(?:\?id=\d+)?)/);
            if (match) {
                return match[1];
            }
        }
        
        // For regular username profiles, remove query parameters and path suffixes
        return url.split('?')[0].split('/about')[0].split('/friends')[0];
    }    async function extractProfileImage() {
        // More specific selectors for the target profile's main profile picture
        const selectors = [
            // Main profile photo container - most reliable
            '[data-pagelet="ProfileTilesFeed"] image',
            '[role="main"] image[width="168"][height="168"]',
            '[role="main"] svg image',
            // Profile header area
            'div[data-pagelet="ProfileActions"] image',
            'div[data-pagelet="ProfileTilesFeed"] svg image',
            // Cover photo area profile picture
            '[data-pagelet="ProfileTilesFeed"] [role="img"]',
            // Fallback selectors for older layout
            '.profilePicThumb img',
            '.profilePic img',
            'a[href*="profilepic"] image',
            // SVG images in profile area
            '[role="main"] svg image[width]',
            // More specific width/height combinations
            'image[width="160"][height="160"]',
            'image[width="176"][height="176"]',
            'image[width="168"][height="168"]:not([data-testid*="nav"])',
        ];

        for (const selector of selectors) {
            const img = document.querySelector(selector);
            if (img) {
                const src = img.getAttribute('xlink:href') || img.src || img.getAttribute('href');
                if (src && src.startsWith('http') && src.includes('fbcdn.net')) {
                    // Additional check: make sure it's not a navigation or ad image
                    const parentElement = img.closest('[data-testid*="nav"], [role="navigation"], [data-pagelet*="nav"]');
                    if (!parentElement) {
                        return src;
                    }
                }
            }
        }

        // If no image found with specific selectors, try a broader search but with content filtering
        const allImages = document.querySelectorAll('image, img');
        for (const img of allImages) {
            const src = img.getAttribute('xlink:href') || img.src;
            if (src && src.startsWith('http') && src.includes('fbcdn.net')) {
                // Check if it's in the main content area and not navigation
                const isInNav = img.closest('[data-testid*="nav"], [role="navigation"], [data-pagelet*="nav"], [aria-label*="navigation"]');
                const isInMain = img.closest('[role="main"], [data-pagelet="ProfileTilesFeed"]');
                
                if (isInMain && !isInNav) {
                    // Additional size check to ensure it's a profile picture
                    const width = img.getAttribute('width') || img.width;
                    const height = img.getAttribute('height') || img.height;
                    if (width && height && parseInt(width) >= 120 && parseInt(height) >= 120) {
                        return src;
                    }
                }
            }
        }

        return null;
    }    function extractAboutInfo() {
        const about = {};
        console.log('🔍 Extracting about info from current page...');
        
        // Updated selectors for current Facebook structure
        const selectors = {
            work: [
                '[data-overviewsection="work"]',
                'div[class*="work"] span[dir="auto"]',
                'div:contains("Work") + div span[dir="auto"]',
                '[aria-label*="work"] span[dir="auto"]',
                'div[class*="employment"] span'
            ],
            education: [
                '[data-overviewsection="education"]',
                'div[class*="education"] span[dir="auto"]',
                'div:contains("Education") + div span[dir="auto"]',
                '[aria-label*="education"] span[dir="auto"]',
                'div[class*="school"] span'
            ],
            location: [
                '[data-overviewsection="places"]',
                'div[class*="location"] span[dir="auto"]',
                'div:contains("Lives in") span[dir="auto"]',
                'div:contains("From") span[dir="auto"]',
                '[aria-label*="location"] span[dir="auto"]',
                'div[class*="hometown"] span'
            ],
            contact: [
                '[data-overviewsection="contact_basic_info"]',
                'div[class*="contact"] span[dir="auto"]',
                'div:contains("Contact") + div span[dir="auto"]',
                '[aria-label*="contact"] span[dir="auto"]'
            ]
        };

        // Try each category with multiple selectors
        Object.keys(selectors).forEach(category => {
            const categorySelectors = selectors[category];
            let found = false;
            
            for (const selector of categorySelectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        const texts = Array.from(elements)
                            .map(el => el.textContent.trim())
                            .filter(text => text.length > 0 && text.length < 200);
                        
                        if (texts.length > 0) {
                            about[category] = texts;
                            console.log(`✅ Found ${category}: ${texts.length} items`);
                            found = true;
                            break;
                        }
                    }
                } catch (e) {
                    // Skip invalid selectors (like :contains which isn't standard CSS)
                    continue;
                }
            }
            
            if (!found) {
                console.log(`❌ No ${category} found with any selector`);
            }
        });

        // Fallback: Look for any text that might be work/education related
        if (!about.work && !about.education && !about.location) {
            console.log('🔄 Trying fallback extraction...');
            
            // Look for common patterns in text content
            const allText = document.body.textContent;
            const workPatterns = [/works at ([^\.]+)/gi, /employed at ([^\.]+)/gi];
            const eduPatterns = [/studied at ([^\.]+)/gi, /graduated from ([^\.]+)/gi];
            const locPatterns = [/lives in ([^\.]+)/gi, /from ([^\.]+)/gi];
            
            workPatterns.forEach(pattern => {
                const matches = [...allText.matchAll(pattern)];
                if (matches.length > 0) {
                    about.work = matches.map(m => m[1].trim());
                }
            });
            
            eduPatterns.forEach(pattern => {
                const matches = [...allText.matchAll(pattern)];
                if (matches.length > 0) {
                    about.education = matches.map(m => m[1].trim());
                }
            });
            
            locPatterns.forEach(pattern => {
                const matches = [...allText.matchAll(pattern)];
                if (matches.length > 0) {
                    about.location = matches.map(m => m[1].trim());
                }
            });
        }

        console.log('📊 About info extracted:', about);
        return about;
    }

    async function extractFriendsList() {
        const friends = [];
        
        // Scroll to load more friends
        await scrollToLoadMore();

        const friendElements = document.querySelectorAll('a[href*="/profile.php"], a[href*="facebook.com/"]:not([href*="photos"]):not([href*="videos"])');
        
        const processedUrls = new Set();        friendElements.forEach(element => {
            const url = element.href;
            const nameElement = element.querySelector('[dir="auto"]') || element;
            const name = nameElement.textContent.trim();

            // Filter valid Facebook profile URLs and avoid duplicates
            if (url && name && 
                (url.includes('/profile.php') || url.match(/facebook\.com\/[^\/]+$/)) &&
                !processedUrls.has(url) &&
                name.length > 0 && name.length < 100) {
                
                processedUrls.add(url);
                
                // Clean URL appropriately based on type
                let cleanUrl;
                if (url.includes('/profile.php')) {
                    // For numerical profiles, preserve the ID parameter
                    const match = url.match(/^(https?:\/\/[^\/]+\/profile\.php(?:\?id=\d+)?)/);
                    cleanUrl = match ? match[1] : url.split('?')[0];
                } else {
                    // For regular username profiles, remove query parameters
                    cleanUrl = url.split('?')[0];
                }
                
                friends.push({
                    name: name,
                    url: cleanUrl
                });
            }
        });

        return friends.slice(0, CONFIG.FRIEND_LIMIT);
    }

    async function scrollToLoadMore() {
        return new Promise((resolve) => {
            let scrollCount = 0;
            const maxScrolls = 5;
            
            const scrollInterval = setInterval(() => {
                window.scrollTo(0, document.body.scrollHeight);
                scrollCount++;
                
                if (scrollCount >= maxScrolls) {
                    clearInterval(scrollInterval);
                    setTimeout(resolve, 2000);
                }
            }, 1000);
        });    }

    // API functions
    async function sendToAPI(endpoint, data, method = 'POST') {
        return new Promise((resolve, reject) => {
            const url = CONFIG.API_BASE + endpoint;
            
            // Log what we're sending
            if (data) {
                console.log(`📤 Sending to ${endpoint}:`, data);
            }
            
            GM_xmlhttpRequest({
                method: method,
                url: url,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: data ? JSON.stringify(data) : null,
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        console.log(`📥 Response from ${endpoint}:`, result);
                        resolve(result);
                    } catch (error) {
                        console.error('❌ Invalid JSON response from API:', response.responseText);
                        reject(new Error('Invalid JSON response'));
                    }
                },
                onerror: (error) => {
                    console.error('❌ Network error sending to API:', error);
                    reject(new Error('Network error'));
                }
            });
        });
    }

    // Queue and debug functions
    async function viewQueue() {
        try {
            const response = await sendToAPI('/queue', null, 'GET');
            updateStatus(`Queue: ${response.count} items`, 'info');
            
            if (response.queue.length > 0) {
                const next3 = response.queue.slice(0, 3).map(item => 
                    `Depth ${item.depth}: ${item.url.split('/').pop()}`
                ).join('\n');
                addLog(`Next 3 in queue:\n${next3}`);
            }
        } catch (error) {
            updateStatus(`Error viewing queue: ${error.message}`, 'error');
        }
    }

    function toggleDebugPanel() {
        if (debugPanel) {
            debugPanel.remove();
            debugPanel = null;
            return;
        }

        debugPanel = document.createElement('div');
        debugPanel.innerHTML = `
            <div style="
                position: fixed;
                top: 50px;
                left: 50px;
                width: 400px;
                height: 300px;
                background: rgba(0,0,0,0.9);
                color: #00ff00;
                font-family: monospace;
                font-size: 12px;
                padding: 15px;
                border-radius: 8px;
                z-index: 10001;
                overflow-y: auto;
            ">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <strong>🐛 Debug Console</strong>
                    <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                            style="background: red; color: white; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer;">×</button>
                </div>
                <div id="debug-content">
                    <div>Current URL: ${window.location.href}</div>
                    <div>Profile Name: ${extractProfileName()}</div>
                    <div>Current Depth: ${currentDepth}</div>
                    <div>Page Type: ${getPageType()}</div>
                    <hr style="border-color: #333; margin: 10px 0;">
                    <div>Available Elements:</div>
                    <div style="font-size: 11px; opacity: 0.8;">
                        H1 elements: ${document.querySelectorAll('h1').length}<br>
                        Profile images: ${document.querySelectorAll('image, img').length}<br>
                        Links: ${document.querySelectorAll('a').length}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(debugPanel);
    }

    function getPageType() {
        if (window.location.href.includes('/about')) return 'About Page';
        if (window.location.href.includes('/friends')) return 'Friends Page';
        if (window.location.href.includes('/photos')) return 'Photos Page';
        return 'Profile Page';
    }

    function minimizePanel() {
        const panel = document.getElementById('fb-scraper-ui');
        if (panel.style.height === '40px') {
            panel.style.height = 'auto';
            panel.querySelector('div').style.display = 'block';
        } else {
            panel.style.height = '40px';
            panel.querySelector('div').style.display = 'none';
        }
    }

    // Test backend connection
    async function testBackendConnection() {
        updateStatus('Testing backend connection...', 'info');
        
        try {
            const response = await sendToAPI('/health', null, 'GET');
            if (response && response.status === 'ok') {
                updateStatus('✅ Backend connected successfully!', 'success');
                addLog(`Backend timestamp: ${response.timestamp}`);
                return true;
            } else {
                updateStatus('❌ Backend responded but status not ok', 'error');
                return false;
            }
        } catch (error) {
            updateStatus(`❌ Backend connection failed: ${error.message}`, 'error');
            console.error('Backend connection error:', error);
            return false;
        }    }
    
    // Initialize
    setTimeout(() => {
        createUI();
        updateProfileDisplay(); // Check for existing annotations on load
        
        // Note: FB_Scraper is defined at the end of the script with all available commands
        
        // Check for existing workflow state
        const state = ScrapingState.get();
        if (state.workflow && ScrapingState.isActive() && ScrapingState.isRecent()) {
            updateStatus(`Resuming workflow: ${state.workflow} - ${state.step}`, 'info');
            isRunning = true;
            
            // Resume workflow after page elements load
            setTimeout(() => {
                continueWorkflow();
            }, 3000);
        } else {
            updateStatus('Facebook Social Graph Scraper loaded', 'success');
            
            // Clear stale state
            if (state.workflow && !ScrapingState.isRecent()) {
                updateStatus('Clearing stale workflow state', 'warning');
                ScrapingState.clear();
            }
        }
        
        // Test backend connection on startup
        setTimeout(() => {
            testBackendConnection();
            // Load annotations from backend after connection test
            setTimeout(() => {
                ProfileAnnotations.loadFromBackend();
            }, 1000);
        }, 1000);        // Auto-resume if auto mode was active and no existing workflow
        if (GM_getValue('autoMode', false) && !ScrapingState.isActive()) {
            updateStatus('Auto-resuming from previous session...', 'info');
            updateHeartbeat();
            startAutoModeHeartbeat();
            setTimeout(autoNext, 3000);
        } else if (GM_getValue('autoMode', false)) {
            // Auto mode is active with existing workflow, start heartbeat
            startAutoModeHeartbeat();
        }
    }, 2000);
    

    // Show annotation dialog
    function showAnnotationDialog() {
        const currentUrl = getCurrentProfileUrl();
        const existing = ProfileAnnotations.get(currentUrl);
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 20000; width: 400px; color: black; font-family: Arial, sans-serif;
        `;
        
        dialog.innerHTML = `
            <h3 style="margin-top: 0;">Profile Research Annotation</h3>
            <div style="margin-bottom: 10px;">
                <strong>Profile:</strong> ${currentUrl}
            </div>
              <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px;">Research Category:</label>
                <select id="annotation-category" style="width: 100%; padding: 5px;">
                    <option value="">Select category...</option>
                    <option value="confirmed-conviction">🚨 Confirmed Conviction</option>
                    <option value="public-record">Public Record Verified</option>
                    <option value="court-record">Court Record Confirmed</option>
                    <option value="news-verified">News Source Verified</option>
                    <option value="investigation">Under Investigation</option>
                    <option value="cleared">Cleared/Innocent</option>
                    <option value="other">Other Research Note</option>
                </select>
            </div>
            
            <div id="conviction-details" style="margin-bottom: 15px; display: none; background: #fff3cd; padding: 10px; border-radius: 4px; border: 1px solid #ffeaa7;">
                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;">Conviction Type:</label>
                    <select id="conviction-type" style="width: 100%; padding: 5px;">
                        <option value="">Select type...</option>
                        <option value="felony">Felony</option>
                        <option value="misdemeanor">Misdemeanor</option>
                        <option value="infraction">Infraction/Citation</option>
                        <option value="juvenile">Juvenile Record</option>
                        <option value="federal">Federal Crime</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;">Crime Category:</label>
                    <input type="text" id="crime-category" placeholder="e.g., Assault, Theft, DUI, Fraud, etc." 
                           style="width: 100%; padding: 5px;">
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;">Conviction Date:</label>
                    <input type="date" id="conviction-date" style="width: 100%; padding: 5px;">
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;">Jurisdiction:</label>
                    <input type="text" id="conviction-jurisdiction" placeholder="e.g., Superior Court of CA, Federal District Court" 
                           style="width: 100%; padding: 5px;">
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px;">Source/Reference:</label>
                <input type="text" id="annotation-source" placeholder="Court case #, news article URL, etc." 
                       style="width: 100%; padding: 5px;" value="${existing?.source || ''}">
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px;">Notes:</label>
                <textarea id="annotation-notes" rows="3" style="width: 100%; padding: 5px;" 
                          placeholder="Research notes, case details, etc.">${existing?.notes || ''}</textarea>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px;">Risk Level:</label>
                <select id="annotation-risk" style="width: 100%; padding: 5px;">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="unknown">Unknown</option>
                </select>
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="save-annotation" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px;">Save</button>
                <button id="remove-annotation" style="padding: 8px 16px; background: #f44336; color: white; border: none; border-radius: 4px;">Remove</button>
                <button id="cancel-annotation" style="padding: 8px 16px; background: #666; color: white; border: none; border-radius: 4px;">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
          // Pre-fill existing data
        if (existing) {
            document.getElementById('annotation-category').value = existing.category || '';
            document.getElementById('annotation-risk').value = existing.risk || 'unknown';
            
            // Handle conviction-specific data
            if (existing.category === 'confirmed-conviction' && existing.convictionDetails) {
                document.getElementById('conviction-details').style.display = 'block';
                document.getElementById('conviction-type').value = existing.convictionDetails.type || '';
                document.getElementById('crime-category').value = existing.convictionDetails.crimeCategory || '';
                document.getElementById('conviction-date').value = existing.convictionDetails.date || '';
                document.getElementById('conviction-jurisdiction').value = existing.convictionDetails.jurisdiction || '';
            }
        }
        
        // Show/hide conviction details based on category selection
        document.getElementById('annotation-category').addEventListener('change', (e) => {
            const convictionDetails = document.getElementById('conviction-details');
            if (e.target.value === 'confirmed-conviction') {
                convictionDetails.style.display = 'block';
            } else {
                convictionDetails.style.display = 'none';
            }
        });
          // Event handlers
        document.getElementById('save-annotation').addEventListener('click', () => {
            const category = document.getElementById('annotation-category').value;
            const source = document.getElementById('annotation-source').value;
            const notes = document.getElementById('annotation-notes').value;
            const risk = document.getElementById('annotation-risk').value;
            
            if (!category) {
                alert('Please select a research category');
                return;
            }
            
            const annotationData = {
                category,
                source,
                notes,
                risk,
                profileName: extractProfileName()
            };
            
            // Handle conviction-specific data
            if (category === 'confirmed-conviction') {
                const convictionType = document.getElementById('conviction-type').value;
                const crimeCategory = document.getElementById('crime-category').value;
                const convictionDate = document.getElementById('conviction-date').value;
                const jurisdiction = document.getElementById('conviction-jurisdiction').value;
                
                if (!convictionType || !crimeCategory) {
                    alert('Please fill in conviction type and crime category for confirmed convictions');
                    return;
                }
                
                annotationData.convictionDetails = {
                    type: convictionType,
                    crimeCategory,
                    date: convictionDate,
                    jurisdiction
                };
                
                // Set risk to high for confirmed convictions if not manually set
                if (risk === 'unknown') {
                    annotationData.risk = 'high';
                }
            }
            
            ProfileAnnotations.set(currentUrl, annotationData);
            
            updateStatus(`Profile annotated: ${category}`, 'success');
            document.body.removeChild(dialog);
            updateProfileDisplay();
        });
        
        document.getElementById('remove-annotation').addEventListener('click', () => {
            ProfileAnnotations.remove(currentUrl);
            updateStatus('Profile annotation removed', 'info');
            document.body.removeChild(dialog);
            updateProfileDisplay();
        });
        
        document.getElementById('cancel-annotation').addEventListener('click', () => {
            document.body.removeChild(dialog);
        });
    }
    
    // Quick mark conviction function
    function quickMarkConviction() {
        const currentUrl = getCurrentProfileUrl();
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 20000; width: 450px; color: black; font-family: Arial, sans-serif;
            border: 3px solid #e74c3c;
        `;
        
        dialog.innerHTML = `
            <h3 style="margin-top: 0; color: #e74c3c;">🚨 Mark Confirmed Conviction</h3>
            <div style="margin-bottom: 15px;">
                <strong>Profile:</strong> ${currentUrl}
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px;">Conviction Type:</label>
                <select id="quick-conviction-type" style="width: 100%; padding: 8px;">
                    <option value="">Select type...</option>
                    <option value="felony">Felony</option>
                    <option value="misdemeanor">Misdemeanor</option>
                    <option value="infraction">Infraction/Citation</option>
                    <option value="juvenile">Juvenile Record</option>
                    <option value="federal">Federal Crime</option>
                    <option value="other">Other</option>
                </select>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px;">Crime Category:</label>
                <input type="text" id="quick-crime-category" placeholder="e.g., Assault, Theft, DUI, Fraud, etc." 
                       style="width: 100%; padding: 8px;">
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px;">Source/Reference:</label>
                <input type="text" id="quick-source" placeholder="Court case #, news article URL, etc." 
                       style="width: 100%; padding: 8px;">
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px;">Quick Notes:</label>
                <textarea id="quick-notes" rows="3" style="width: 100%; padding: 8px;" 
                          placeholder="Brief conviction details, date, jurisdiction, etc."></textarea>
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="quick-save-conviction" style="padding: 10px 20px; background: #e74c3c; color: white; border: none; border-radius: 4px; font-weight: bold;">🚨 Mark Conviction</button>
                <button id="quick-full-form" style="padding: 10px 16px; background: #9b59b6; color: white; border: none; border-radius: 4px;">📝 Full Form</button>
                <button id="quick-cancel" style="padding: 10px 16px; background: #666; color: white; border: none; border-radius: 4px;">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // Event handlers
        document.getElementById('quick-save-conviction').addEventListener('click', () => {
            const convictionType = document.getElementById('quick-conviction-type').value;
            const crimeCategory = document.getElementById('quick-crime-category').value;
            const source = document.getElementById('quick-source').value;
            const notes = document.getElementById('quick-notes').value;
            
            if (!convictionType || !crimeCategory) {
                alert('Please fill in conviction type and crime category');
                return;
            }
            
            ProfileAnnotations.set(currentUrl, {
                category: 'confirmed-conviction',
                source,
                notes,
                risk: 'high',
                profileName: extractProfileName(),
                convictionDetails: {
                    type: convictionType,
                    crimeCategory,
                    date: '',
                    jurisdiction: ''
                }
            });
            
            updateStatus(`🚨 CONVICTED: ${crimeCategory} (${convictionType})`, 'error');
            document.body.removeChild(dialog);
            updateProfileDisplay();
        });
        
        document.getElementById('quick-full-form').addEventListener('click', () => {
            document.body.removeChild(dialog);
            showAnnotationDialog();
        });
        
        document.getElementById('quick-cancel').addEventListener('click', () => {
            document.body.removeChild(dialog);
        });
    }
      // Update profile display to show annotations
    function updateProfileDisplay() {
        const currentUrl = getCurrentProfileUrl();
        const annotation = ProfileAnnotations.get(currentUrl);
        
        // Remove existing annotation display
        const existing = document.getElementById('profile-annotation-display');
        if (existing) existing.remove();
        
        if (annotation) {
            const display = document.createElement('div');
            display.id = 'profile-annotation-display';
            
            // Special styling for confirmed convictions
            const isConviction = annotation.category === 'confirmed-conviction';
            const bgColor = isConviction ? 'rgba(231, 76, 60, 0.95)' : 'rgba(255, 193, 7, 0.9)';
            const borderColor = isConviction ? '#e74c3c' : '#FFC107';
            const textColor = isConviction ? 'white' : 'black';
            
            display.style.cssText = `
                position: fixed; top: 60px; right: 10px; width: 320px;
                background: ${bgColor}; color: ${textColor}; padding: 12px;
                border-radius: 8px; font-size: 12px; z-index: 9999;
                border: 3px solid ${borderColor};
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                font-family: Arial, sans-serif;
            `;
            
            const riskColor = isConviction ? '#ffcccb' : {
                'low': '#4CAF50',
                'medium': '#FF9800', 
                'high': '#f44336',
                'unknown': '#666'
            }[annotation.risk];
            
            let content = `
                <div style="font-weight: bold; margin-bottom: 8px; font-size: 14px;">
                    ${isConviction ? '🚨 CONFIRMED CONVICTION' : '🔍 Research Annotation'}
                </div>
            `;
            
            if (isConviction && annotation.convictionDetails) {
                const conv = annotation.convictionDetails;
                content += `
                    <div style="margin-bottom: 6px; font-weight: bold;">
                        <span style="background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 3px;">
                            ${conv.type?.toUpperCase() || 'CONVICTION'}
                        </span>
                    </div>
                    <div style="margin-bottom: 4px;">
                        <strong>Crime:</strong> ${conv.crimeCategory}
                    </div>
                    ${conv.date ? `<div style="margin-bottom: 4px;"><strong>Date:</strong> ${conv.date}</div>` : ''}
                    ${conv.jurisdiction ? `<div style="margin-bottom: 4px;"><strong>Jurisdiction:</strong> ${conv.jurisdiction}</div>` : ''}
                `;
            } else {
                content += `
                    <div style="margin-bottom: 4px;">
                        <strong>Category:</strong> ${annotation.category}
                    </div>
                `;
            }
            
            content += `
                <div style="margin-bottom: 4px;">
                    <strong>Risk:</strong> <span style="color: ${riskColor}; font-weight: bold;">${annotation.risk.toUpperCase()}</span>
                </div>
                ${annotation.source ? `<div style="margin-bottom: 4px;"><strong>Source:</strong> ${annotation.source}</div>` : ''}
                ${annotation.notes ? `<div style="margin-bottom:  6px;"><strong>Notes:</strong> ${annotation.notes}</div>` : ''}                <div style="font-size: 10px; opacity: 0.8; border-top: 1px solid rgba(255,255,255,0.3); padding-top: 4px; margin-top: 6px;">
                    Updated: ${new Date(annotation.lastUpdated).toLocaleDateString()}
                    ${annotation.savedToBackend ? '<span style="background: #3498db; color: white; padding: 1px 4px; border-radius: 3px; margin-left: 5px;">BACKEND</span>' : '<span style="background: #7f8c8d; color: white; padding: 1px 4px; border-radius: 3px; margin-left: 5px;">LOCAL</span>'}
                </div>
            `;
            
            display.innerHTML = content;
            document.body.appendChild(display);
              // Auto-hide after 10 seconds for non-convictions
            if (!isConviction) {
                setTimeout(() => {
                    if (display && display.parentNode) {
                        display.remove();
                    }
                }, 10000);
            }
        }
    }      // Initialize the scraper with enhanced state recovery
    createUI();
    updateProfileDisplay(); // Check for existing annotations on load
    
    // Enhanced initialization with state recovery
    setTimeout(() => {
        console.log('🚀 FB Scraper: Starting initialization...');
        
        // Check for existing auto mode state and recover if needed
        const state = ScrapingState.get();
        console.log('🔍 Initial state check:', state);
        
        // Validate and potentially recover state
        const validation = ScrapingState.validate();
        if (!validation.valid) {
            console.warn('⚠️ Invalid state detected on load:', validation.issues);
            if (state.autoMode) {
                console.log('🔧 Attempting to recover auto mode from invalid state...');
                ScrapingState.clear(true); // Clear but preserve auto mode
            }
        }
        
        // If auto mode was active, attempt to resume
        if (state.autoMode) {
            console.log('🔄 Auto mode was active, checking if we should resume...');
            updateHeartbeat();
            startAutoModeHeartbeat();
            
            // If we have an active workflow, resume it
            if (state.workflow && state.isRecent() && ScrapingState.isActive()) {
                console.log('🔄 Resuming existing workflow:', state.workflow, state.step);
                updateStatus(`Resuming workflow: ${state.workflow} - ${state.step}`, 'info');
                // Unlock any stale transition locks from previous session
                if (state.transitionLock) {
                    console.log('🔓 Clearing stale transition lock from previous session');
                    ScrapingState.unlock();
                }
                setTimeout(autoNext, 3000);
            } else if (state.autoMode && !state.workflow) {
                // Auto mode is on but no workflow - try to start fresh
                console.log('🚀 Auto mode active but no workflow, starting fresh...');
                setTimeout(autoNext, 3000);
            }
        } else {
            // Auto mode is active with existing workflow, start heartbeat
            startAutoModeHeartbeat();
        }
        
        console.log('✅ FB Scraper initialization complete');
    }, 1000);
      // Global functions for console access and debugging
    window.FB_Scraper = {
        getConvictions: () => ProfileAnnotations.getConvictions(),
        getBackendConvictions: () => ProfileAnnotations.getBackendConvictions(),
        exportConvictions: () => ProfileAnnotations.exportConvictionsCSV(),
        syncToBackend: () => ProfileAnnotations.syncToBackend(),
        loadFromBackend: () => ProfileAnnotations.loadFromBackend(),
        getConvictionStats: () => ProfileAnnotations.getConvictionStats(),
        resetToBackend: () => ProfileAnnotations.resetToBackend(),
        exportAllAnnotations: () => ProfileAnnotations.export(),
        
        // Debugging functions for auto mode issues
        getState: () => {
            const state = ScrapingState.get();
            const validation = ScrapingState.validate();
            console.log('🔍 Current State:', state);
            console.log('✅ State Validation:', validation);
            console.log('🏃 Is Running:', isRunning);
            console.log('🔒 State Lock:', stateLock);
            console.log('💓 Last Heartbeat:', new Date(lastHeartbeat).toLocaleTimeString());
            console.log('💓 Heartbeat Active:', heartbeatInterval !== null);
            return { state, validation, isRunning, stateLock, lastHeartbeat, heartbeatActive: heartbeatInterval !== null };
        },
        
        resetAutoMode: () => {
            console.log('🔄 Resetting auto mode...');
            isRunning = false;
            stateLock = false;
            stopAutoModeHeartbeat();
            ScrapingState.clear(false);
            GM_setValue('autoNextErrorCount', 0);
            GM_setValue('recheckAttempt', 0);
            updateStatus('Auto mode reset', 'info');
            console.log('✅ Auto mode reset complete');
        },
        
        forceAutoNext: () => {
            console.log('🚀 Force starting autoNext...');
            const state = ScrapingState.get();
            if (!state.autoMode) {
                ScrapingState.set({ autoMode: true });
            }
            isRunning = false;
            stateLock = false;
            autoNext();
        },
        
        clearStuckState: () => {
            console.log('🧹 Clearing potentially stuck state...');
            ScrapingState.unlock();
            isRunning = false;
            stateLock = false;
            ScrapingState.set({
                workflow: null,
                step: null,
                transitionLock: false,
                lastAction: 'manual_clear_stuck_state'
            });
            console.log('✅ Stuck state cleared');
        },
        
        startDebugMode: () => {
            console.log('🐛 Starting debug mode - will log every 10 seconds');
            setInterval(() => {
                const state = ScrapingState.get();
                console.log(`🐛 Debug: autoMode=${state.autoMode}, isRunning=${isRunning}, workflow=${state.workflow}, step=${state.step}, transitionLock=${state.transitionLock}, lastAction=${state.lastAction}`);
            }, 10000);
        }
    };      console.log('FB Scraper initialized. Available commands:');
    console.log('- FB_Scraper.getConvictions() - Get all confirmed convictions');
    console.log('- FB_Scraper.exportConvictions() - Export convictions as CSV');
    console.log('- FB_Scraper.getConvictionStats() - Show conviction statistics');
    console.log('- FB_Scraper.exportAllAnnotations() - Export all annotations as JSON');    console.log('- FB_Scraper.syncToBackend() - Sync all annotations to backend server');
    console.log('- FB_Scraper.loadFromBackend() - Load annotations from backend server');
    console.log('- FB_Scraper.getBackendConvictions() - Show convictions stored in backend');
    console.log('- FB_Scraper.resetToBackend() - Clear local annotations and reload from backend');
    console.log('');
    console.log('🐛 DEBUG COMMANDS for auto-next issues:');
    console.log('- FB_Scraper.getState() - Show current state and validation');
    console.log('- FB_Scraper.resetAutoMode() - Reset auto mode completely');
    console.log('- FB_Scraper.forceAutoNext() - Force start autoNext');
    console.log('- FB_Scraper.clearStuckState() - Clear stuck state locks');
    console.log('- FB_Scraper.startDebugMode() - Enable continuous debug logging');// Enhanced auto mode heartbeat and recovery system
    let lastHeartbeat = Date.now();
    let heartbeatInterval = null;
    let recoveryAttempts = 0;
    
    function startAutoModeHeartbeat() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        
        heartbeatInterval = setInterval(() => {
            const state = ScrapingState.get();
            const now = Date.now();
            const timeSinceLastHeartbeat = now - lastHeartbeat;
            const timeSinceStateUpdate = state.timestamp ? now - state.timestamp : 0;
            
            console.log(`💓 Heartbeat Check: autoMode=${state.autoMode}, isRunning=${isRunning}, timeSinceHeartbeat=${Math.round(timeSinceLastHeartbeat/1000)}s, transitionLock=${state.transitionLock}`);
            
            // Only trigger recovery if:
            // 1. Auto mode is enabled
            // 2. Not currently running a process
            // 3. Not in a transition lock state
            // 4. Enough time has passed since last activity
            // 5. State is not too stale
            if (state.autoMode && 
                !isRunning && 
                !state.transitionLock && 
                !stateLock &&
                timeSinceLastHeartbeat > 180000 && // 3 minutes of inactivity
                timeSinceStateUpdate < 1800000) { // State not older than 30 minutes
                
                recoveryAttempts++;
                console.log(`💓 Auto Mode Heartbeat: Detected stuck state (attempt ${recoveryAttempts}), attempting recovery...`);
                updateStatus(`Auto mode heartbeat: Recovering from stuck state (attempt ${recoveryAttempts})`, 'warning');
                
                // Validate state before recovery
                const validation = ScrapingState.validate();
                if (!validation.valid) {
                    console.log('💓 Heartbeat: Invalid state detected, cleaning up:', validation.issues);
                    ScrapingState.clear(true); // Clear but preserve auto mode
                }
                
                // Reset heartbeat and try to resume with backoff
                lastHeartbeat = now;
                const backoffDelay = Math.min(5000 * recoveryAttempts, 30000); // Max 30 second delay
                
                setTimeout(() => {
                    if (ScrapingState.get().autoMode && !isRunning && !stateLock) {
                        console.log(`💓 Heartbeat Recovery: Attempting autoNext after ${backoffDelay}ms delay`);
                        autoNext();
                    }
                }, backoffDelay);
            }
            
            // Reset recovery attempts on successful activity
            if (isRunning || state.workflow || timeSinceLastHeartbeat < 60000) {
                if (recoveryAttempts > 0) {
                    console.log(`💓 Heartbeat: Activity detected, resetting recovery attempts`);
                    recoveryAttempts = 0;
                }
                lastHeartbeat = now;
            }
            
            // Auto-stop if too many recovery attempts failed
            if (recoveryAttempts > 10) {
                console.log('💓 Heartbeat: Too many recovery attempts, stopping auto mode');
                updateStatus('Auto mode stopped: Too many recovery attempts failed', 'error');
                ScrapingState.set({ autoMode: false, lastAction: 'heartbeat_failure_stop' });
                stopAutoModeHeartbeat();
                isRunning = false;
                recoveryAttempts = 0;
            }
            
        }, 30000); // Check every 30 seconds
    }
    
    function stopAutoModeHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
            recoveryAttempts = 0;
            console.log('💓 Heartbeat: Stopped monitoring');
        }
    }
    
    function updateHeartbeat() {
        lastHeartbeat = Date.now();
        GM_setValue('lastHeartbeat', lastHeartbeat);
    }
})(); // End of IIFE
