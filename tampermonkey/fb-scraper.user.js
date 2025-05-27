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
    };

    let currentDepth = GM_getValue('currentDepth', 1);
    let isRunning = false;
    let debugPanel = null;

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
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
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
        });        // Scraping buttons
        document.getElementById('scrape-basic').addEventListener('click', () => scrapeBasicInfo());
        document.getElementById('scrape-about').addEventListener('click', () => scrapeAboutPage());
        document.getElementById('scrape-friends').addEventListener('click', () => scrapeFriendsList());
        document.getElementById('scrape-full').addEventListener('click', () => scrapeFullProfile());
        document.getElementById('auto-next').addEventListener('click', () => autoNext());
        document.getElementById('view-queue').addEventListener('click', () => viewQueue());
        document.getElementById('test-backend').addEventListener('click', () => testBackendConnection());
        document.getElementById('toggle-debug').addEventListener('click', () => toggleDebugPanel());
        document.getElementById('minimize-panel').addEventListener('click', () => minimizePanel());
    }

    // Status and logging functions
    function updateStatus(message, type = 'info') {
        const statusText = document.getElementById('status-text');
        const timestamp = new Date().toLocaleTimeString();
        const emoji = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
        
        statusText.innerHTML = `[${timestamp}] ${emoji} ${message}`;
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
                url: window.location.href.split('?')[0],
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
    }

    async function scrapeAboutPage() {
        updateStatus('Navigating to About page...', 'info');
        
        try {
            const aboutUrl = getCurrentProfileUrl() + '/about';
            if (window.location.href !== aboutUrl) {
                window.location.href = aboutUrl;
                return;
            }

            const aboutData = extractAboutInfo();
            const profileData = {
                url: getCurrentProfileUrl(),
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
    }

    async function scrapeFriendsList() {
        updateStatus('Scraping friends list...', 'info');
        
        try {
            const friendsUrl = getCurrentProfileUrl() + '/friends';
            if (!window.location.href.includes('/friends')) {
                window.location.href = friendsUrl;
                return;
            }

            const friends = await extractFriendsList();
            const profileData = {
                url: getCurrentProfileUrl().replace('/friends', ''),
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
    }

    async function scrapeFullProfile() {
        updateStatus('Starting full profile scrape...', 'info');
        
        try {
            // Basic info
            const basicData = {
                url: getCurrentProfileUrl(),
                name: extractProfileName(),
                profile_image: await extractProfileImage()
            };

            // Navigate to about page
            const aboutUrl = getCurrentProfileUrl() + '/about';
            if (!window.location.href.includes('/about')) {
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
            };

            await sendToAPI('/profile', fullProfileData);
            updateStatus('Full profile scraped successfully', 'success');

            // Navigate to friends after a delay
            setTimeout(() => {
                const friendsUrl = getCurrentProfileUrl() + '/friends';
                updateStatus('Navigating to friends list...', 'info');
                window.location.href = friendsUrl;
            }, 2000);

        } catch (error) {
            updateStatus(`Error in full scrape: ${error.message}`, 'error');
        }
    }

    // Auto navigation
    async function autoNext() {
        if (isRunning) {
            isRunning = false;
            updateStatus('Auto scraping stopped', 'info');
            return;
        }

        isRunning = true;
        updateStatus('Starting auto scraper...', 'info');

        try {
            const response = await sendToAPI('/scrape/next', null, 'GET');
            if (response.url) {
                updateStatus(`Navigating to next profile: ${response.url}`, 'info');
                setTimeout(() => {
                    window.location.href = response.url;
                }, 2000);
            } else {
                updateStatus('No more URLs in queue', 'info');
                isRunning = false;
            }
        } catch (error) {
            updateStatus(`Error getting next URL: ${error.message}`, 'error');
            isRunning = false;
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
    }

    function getCurrentProfileUrl() {
        return window.location.href.split('?')[0].split('/about')[0].split('/friends')[0];
    }

    async function extractProfileImage() {
        const selectors = [
            'image[width="168"][height="168"]',
            'svg image',
            'img[data-imgperflogname="profileCoverPhoto"]',
            '.profile-picture img'
        ];

        for (const selector of selectors) {
            const img = document.querySelector(selector);
            if (img) {
                const src = img.getAttribute('xlink:href') || img.src;
                if (src && src.startsWith('http')) {
                    return src;
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
        
        const processedUrls = new Set();

        friendElements.forEach(element => {
            const url = element.href;
            const nameElement = element.querySelector('[dir="auto"]') || element;
            const name = nameElement.textContent.trim();

            // Filter valid Facebook profile URLs and avoid duplicates
            if (url && name && 
                (url.includes('/profile.php') || url.match(/facebook\.com\/[^\/]+$/)) &&
                !processedUrls.has(url) &&
                name.length > 0 && name.length < 100) {
                
                processedUrls.add(url);
                friends.push({
                    name: name,
                    url: url.split('?')[0]
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
        }
    }    // Initialize
    setTimeout(() => {
        createUI();
        updateStatus('Facebook Social Graph Scraper loaded', 'success');
        
        // Test backend connection on startup
        setTimeout(() => {
            testBackendConnection();
        }, 1000);
        
        // Auto-scrape if enabled
        if (GM_getValue('autoScrapeEnabled', false)) {
            setTimeout(autoNext, 3000);
        }
    }, 2000);

})();
