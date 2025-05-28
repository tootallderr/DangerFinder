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
    
    // Enhanced state management
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
            timestamp: GM_getValue('stateTimestamp', null)
        }),
        
        // Set state
        set: (newState) => {
            if (newState.workflow !== undefined) GM_setValue('currentWorkflow', newState.workflow);
            if (newState.step !== undefined) GM_setValue('currentStep', newState.step);
            if (newState.profileUrl !== undefined) GM_setValue('currentProfileUrl', newState.profileUrl);
            if (newState.autoMode !== undefined) GM_setValue('autoMode', newState.autoMode);
            if (newState.depth !== undefined) GM_setValue('currentDepth', newState.depth);
            if (newState.queueIndex !== undefined) GM_setValue('queueIndex', newState.queueIndex);
            if (newState.lastAction !== undefined) GM_setValue('lastAction', newState.lastAction);
            GM_setValue('stateTimestamp', Date.now());
        },
        
        // Clear state
        clear: () => {
            GM_setValue('currentWorkflow', null);
            GM_setValue('currentStep', null);
            GM_setValue('currentProfileUrl', null);
            GM_setValue('autoMode', false);
            GM_setValue('lastAction', null);
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
        updateStatus('Navigating to About page...', 'info');
        
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
            
            if (!window.location.href.includes('about') && !window.location.href.includes('sk=about')) {
                window.location.href = aboutUrl;
                return;
            }

            const aboutData = extractAboutInfo();
            const profileData = {
                url: currentUrl,
                name: extractProfileName(),
                about: aboutData,
                depth: currentDepth,
                type: 'about'
            };

            await sendToAPI('/profile', profileData);
            updateStatus('About page data scraped successfully', 'success');
        } catch (error) {
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
    }
    
    // Auto navigation with workflow management
    async function autoNext() {
        const currentState = ScrapingState.get();
        
        // Toggle auto mode if already running
        if (isRunning && !currentState.autoMode) {
            isRunning = false;
            ScrapingState.set({ autoMode: false });
            updateStatus('Auto scraping stopped', 'info');
            return;
        }

        isRunning = true;
        ScrapingState.set({ autoMode: true });
        updateStatus('Auto scraper active...', 'info');

        try {
            // Check if we're continuing a workflow
            if (currentState.workflow && currentState.isRecent() && ScrapingState.isActive()) {
                console.log('🔄 Auto Mode: Continuing existing workflow');
                await continueWorkflow();
                // Don't return here - if continueWorkflow completes the workflow,
                // autoNext will be called again by completeWorkflowAndNext
                // This prevents premature exit from auto mode
                return;
            }

            // Get next URL from queue
            const response = await sendToAPI('/scrape/next', null, 'GET');
            if (response.url) {
                // Start new workflow
                ScrapingState.set({
                    workflow: 'full_scrape',
                    step: 'basic_info',
                    profileUrl: response.url,
                    queueIndex: response.queueIndex || 0
                });
                
                updateStatus(`Starting workflow for: ${response.url}`, 'info');
                
                // Navigate to the profile
                setTimeout(() => {
                    window.location.href = response.url;
                }, 2000);
            } else {
                updateStatus('No more URLs in queue', 'info');
                isRunning = false;
                ScrapingState.set({ autoMode: false });
            }
        } catch (error) {
            updateStatus(`Error in auto-next: ${error.message}`, 'error');
            isRunning = false;
            ScrapingState.set({ autoMode: false });        }
    }
    
    // Continue existing workflow
    async function continueWorkflow() {
        const workflowState = ScrapingState.get();
        const currentUrl = getCurrentProfileUrl();
          updateStatus(`Continuing workflow: ${workflowState.workflow} - ${workflowState.step}`, 'info');
        
        // Verify we're on the correct profile
        if (workflowState.profileUrl && currentUrl !== workflowState.profileUrl) {
            updateStatus(`URL mismatch, navigating back to ${workflowState.profileUrl}`, 'warning');
            setTimeout(() => {
                window.location.href = workflowState.profileUrl;
            }, 1000);
            return;
        }
        
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
                updateStatus(`Unknown workflow: ${state.workflow}`, 'error');
                ScrapingState.clear();
        }
    }
    
    // Execute full scrape workflow
    async function executeFullScrapeWorkflow(currentStep) {
        switch (currentStep) {
            case 'basic_info':
                await scrapeBasicInfo();
                ScrapingState.set({ step: 'friends_list' });
                setTimeout(() => navigateToFriends(), 3000);
                break;
                
            case 'friends_list':
                await scrapeFriendsList();
                ScrapingState.set({ step: 'about_page' });
                setTimeout(() => navigateToAbout(), 3000);
                break;
                
            case 'about_page':
                await scrapeAboutPage();
                ScrapingState.set({ step: 'complete' });
                setTimeout(() => completeWorkflowAndNext(), 3000);
                break;
                
            case 'complete':
                await completeWorkflowAndNext();
                break;
                
            default:
                updateStatus(`Unknown step: ${currentStep}`, 'error');
                ScrapingState.clear();        }
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
    }
    
    function stopWorkflow() {
        isRunning = false;
        ScrapingState.clear();
        updateStatus('Workflow stopped and state cleared', 'warning');
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
    }
    
    // Complete workflow and move to next profile
    async function completeWorkflowAndNext() {
        const currentState = ScrapingState.get();
        updateStatus(`Completed workflow for ${currentState.profileUrl}`, 'success');
        
        // Keep auto mode flag active but clear the current workflow
        const wasAutoMode = currentState.autoMode;
        ScrapingState.clear();
        
        // If we were in auto mode, restore it and continue
        if (wasAutoMode) {
            // Explicitly set auto mode again to ensure it persists
            ScrapingState.set({ autoMode: true });
            isRunning = true;
            
            console.log('🔄 Auto Mode: Continuing to next profile in queue');
            updateStatus('Moving to next profile in queue...', 'info');
            setTimeout(() => autoNext(), 2000);
        } else {
            isRunning = false;
            updateStatus('Workflow completed. Auto mode stopped.', 'info');
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
    }

    function extractAboutInfo() {
        const about = {};
        
        // Extract work information
        const workElements = document.querySelectorAll('[data-overviewsection="work"]');
        if (workElements.length > 0) {
            about.work = Array.from(workElements).map(el => el.textContent.trim());
        }

        // Extract education
        const educationElements = document.querySelectorAll('[data-overviewsection="education"]');
        if (educationElements.length > 0) {
            about.education = Array.from(educationElements).map(el => el.textContent.trim());
        }

        // Extract location
        const locationElements = document.querySelectorAll('[data-overviewsection="places"]');
        if (locationElements.length > 0) {
            about.location = Array.from(locationElements).map(el => el.textContent.trim());
        }

        // Extract contact info
        const contactElements = document.querySelectorAll('[data-overviewsection="contact_basic_info"]');
        if (contactElements.length > 0) {
            about.contact = Array.from(contactElements).map(el => el.textContent.trim());
        }

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
        });
    }

    // API functions
    async function sendToAPI(endpoint, data, method = 'POST') {
        return new Promise((resolve, reject) => {
            const url = CONFIG.API_BASE + endpoint;
            
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
                        resolve(result);
                    } catch (error) {
                        reject(new Error('Invalid JSON response'));
                    }
                },
                onerror: (error) => {
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
        }, 1000);
        
        // Auto-scrape if enabled and no existing workflow
        if (GM_getValue('autoScrapeEnabled', false) && !ScrapingState.isActive()) {
            setTimeout(autoNext, 3000);
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
    }
      // Initialize the scraper
    createUI();
    updateProfileDisplay(); // Check for existing annotations on load
    
    // Global functions for console access
    window.FB_Scraper = {
        getConvictions: () => ProfileAnnotations.getConvictions(),
        getBackendConvictions: () => ProfileAnnotations.getBackendConvictions(),
        exportConvictions: () => ProfileAnnotations.exportConvictionsCSV(),
        syncToBackend: () => ProfileAnnotations.syncToBackend(),
        loadFromBackend: () => ProfileAnnotations.loadFromBackend(),
        getConvictionStats: () => ProfileAnnotations.getConvictionStats(),
        resetToBackend: () => ProfileAnnotations.resetToBackend(),
        exportAllAnnotations: () => ProfileAnnotations.export()
    };
      console.log('FB Scraper initialized. Available commands:');
    console.log('- FB_Scraper.getConvictions() - Get all confirmed convictions');
    console.log('- FB_Scraper.exportConvictions() - Export convictions as CSV');
    console.log('- FB_Scraper.getConvictionStats() - Show conviction statistics');
    console.log('- FB_Scraper.exportAllAnnotations() - Export all annotations as JSON');    console.log('- FB_Scraper.syncToBackend() - Sync all annotations to backend server');
    console.log('- FB_Scraper.loadFromBackend() - Load annotations from backend server');
    console.log('- FB_Scraper.getBackendConvictions() - Show convictions stored in backend');
    console.log('- FB_Scraper.resetToBackend() - Clear local annotations and reload from backend');
})(); // End of IIFE
