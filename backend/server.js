const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Import routes
const scrapeRoutes = require('./routes/scrape');

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files for visualizer
app.use('/visualizer', express.static(path.join(__dirname, '..', 'visualizer')));

// Routes
app.use('/api/scrape', scrapeRoutes);

// Root route - redirect to visualizer
app.get('/', (req, res) => {
    res.redirect('/visualizer');
});

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const VISITED_FILE = path.join(DATA_DIR, 'visited.json');
const GRAPH_FILE = path.join(DATA_DIR, 'graph.json');
const ANNOTATIONS_FILE = path.join(DATA_DIR, 'annotations.json');
const ALIASES_FILE = path.join(DATA_DIR, 'aliases.json');
const MANUAL_CONNECTIONS_FILE = path.join(DATA_DIR, 'manual_connections.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

// Initialize data files if they don't exist
const initializeDataFiles = () => {
    if (!fs.existsSync(QUEUE_FILE)) {
        fs.writeFileSync(QUEUE_FILE, JSON.stringify([]));
    }
    if (!fs.existsSync(VISITED_FILE)) {
        fs.writeFileSync(VISITED_FILE, JSON.stringify([]));
    }
    if (!fs.existsSync(GRAPH_FILE)) {
        fs.writeFileSync(GRAPH_FILE, JSON.stringify({ nodes: [], edges: [] }));
    }
    if (!fs.existsSync(ANNOTATIONS_FILE)) {
        fs.writeFileSync(ANNOTATIONS_FILE, JSON.stringify({}));
    }
    if (!fs.existsSync(ALIASES_FILE)) {
        fs.writeFileSync(ALIASES_FILE, JSON.stringify({ 
            aliases: [], 
            similarNames: [],
            confirmedAliases: []
        }));
    }
    if (!fs.existsSync(MANUAL_CONNECTIONS_FILE)) {
        fs.writeFileSync(MANUAL_CONNECTIONS_FILE, JSON.stringify({ 
            connections: [],
            removedConnections: []
        }));
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
            similarityThreshold: 0.7,
            autoDetectAliases: true,
            showSimilarNames: true,
            showManualConnections: true
        }));
    }
};

// Helper functions
const readJSON = (filePath) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (!content) {
            // Return appropriate default for empty files
            if (filePath.includes('queue.json')) return [];
            if (filePath.includes('visited.json')) return [];
            if (filePath.includes('graph.json')) return { nodes: [], edges: [] };
            return null;
        }
        return JSON.parse(content);
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        // Return appropriate default based on file type
        if (filePath.includes('queue.json')) return [];
        if (filePath.includes('visited.json')) return [];
        if (filePath.includes('graph.json')) return { nodes: [], edges: [] };
        return null;
    }
};

const writeJSON = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
};

// Name similarity and alias detection functions
const calculateNameSimilarity = (name1, name2) => {
    if (!name1 || !name2) return 0;
    
    // Normalize names (lowercase, remove extra spaces, common prefixes/suffixes)
    const normalize = (name) => {
        return name.toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^(mr|mrs|ms|dr|prof)\.?\s+/i, '')
            .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '');
    };
    
    const n1 = normalize(name1);
    const n2 = normalize(name2);
    
    if (n1 === n2) return 1.0;
    
    // Check for exact word matches (different order)
    const words1 = n1.split(' ').filter(w => w.length > 1);
    const words2 = n2.split(' ').filter(w => w.length > 1);
    
    if (words1.length > 0 && words2.length > 0) {
        const commonWords = words1.filter(w => words2.includes(w));
        const wordSimilarity = (commonWords.length * 2) / (words1.length + words2.length);
        
        if (wordSimilarity > 0.5) {
            return Math.max(wordSimilarity, levenshteinSimilarity(n1, n2));
        }
    }
    
    return levenshteinSimilarity(n1, n2);
};

const levenshteinSimilarity = (str1, str2) => {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
        for (let i = 1; i <= str1.length; i++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + cost
            );
        }
    }
    
    const maxLength = Math.max(str1.length, str2.length);
    return maxLength === 0 ? 1 : (maxLength - matrix[str2.length][str1.length]) / maxLength;
};

const detectSimilarNames = (profiles, threshold = 0.7) => {
    const similarPairs = [];
    const profilesList = Object.entries(profiles);
    
    for (let i = 0; i < profilesList.length; i++) {
        for (let j = i + 1; j < profilesList.length; j++) {
            const [url1, profile1] = profilesList[i];
            const [url2, profile2] = profilesList[j];
            
            if (profile1.name && profile2.name) {
                const similarity = calculateNameSimilarity(profile1.name, profile2.name);
                
                if (similarity >= threshold) {
                    similarPairs.push({
                        url1,
                        url2,
                        name1: profile1.name,
                        name2: profile2.name,
                        similarity: similarity,
                        detectedAt: new Date().toISOString()
                    });
                }
            }
        }
    }
    
    return similarPairs;
};

// Merge profile data with existing profile
const mergeProfileData = (existingProfile, newProfile) => {
    console.log(`🔄 Merging profile data for: ${newProfile.url}`);
    console.log(`📥 New profile type: ${newProfile.type}`);
    
    if (!existingProfile) {
        console.log('📝 No existing profile found, creating new one');
        return newProfile;
    }

    console.log(`📋 Existing profile has sections: ${Object.keys(existingProfile).join(', ')}`);
    console.log(`📋 New profile has sections: ${Object.keys(newProfile).join(', ')}`);

    const merged = { ...existingProfile };

    // Update basic fields if they exist in new profile
    if (newProfile.name) merged.name = newProfile.name;
    if (newProfile.url) merged.url = newProfile.url;
    if (newProfile.profile_image) merged.profile_image = newProfile.profile_image;
    if (newProfile.depth !== undefined) merged.depth = Math.min(existingProfile.depth || Infinity, newProfile.depth);
    if (newProfile.type) merged.type = newProfile.type;

    // Merge about sections
    if (newProfile.about) {
        console.log(`📚 Merging about section. New about data:`, newProfile.about);
        merged.about = merged.about || {};
        let aboutUpdated = false;
        
        if (newProfile.about.work) {
            const oldWork = merged.about.work || [];
            merged.about.work = [...oldWork, ...newProfile.about.work]
                .filter((item, index, arr) => arr.indexOf(item) === index); // Remove duplicates
            console.log(`💼 Work info updated: ${oldWork.length} -> ${merged.about.work.length} items`);
            aboutUpdated = true;
        }
        if (newProfile.about.education) {
            const oldEducation = merged.about.education || [];
            merged.about.education = [...oldEducation, ...newProfile.about.education]
                .filter((item, index, arr) => arr.indexOf(item) === index);
            console.log(`🎓 Education info updated: ${oldEducation.length} -> ${merged.about.education.length} items`);
            aboutUpdated = true;
        }
        if (newProfile.about.location) {
            const oldLocation = merged.about.location || [];
            merged.about.location = [...oldLocation, ...newProfile.about.location]
                .filter((item, index, arr) => arr.indexOf(item) === index);
            console.log(`📍 Location info updated: ${oldLocation.length} -> ${merged.about.location.length} items`);
            aboutUpdated = true;
        }
        if (newProfile.about.relationship) {
            merged.about.relationship = newProfile.about.relationship;
            console.log(`💕 Relationship status updated`);
            aboutUpdated = true;
        }
        if (newProfile.about.bio) {
            merged.about.bio = newProfile.about.bio;
            console.log(`📄 Bio updated`);
            aboutUpdated = true;
        }
        
        if (!aboutUpdated) {
            console.log(`⚠️ About section provided but no data was merged`);
        }
    }

    // Merge friends list
    if (newProfile.friends && Array.isArray(newProfile.friends)) {
        merged.friends = merged.friends || [];
        const existingFriendUrls = new Set(merged.friends.map(f => f.url));
        const oldFriendsCount = merged.friends.length;
        
        newProfile.friends.forEach(newFriend => {
            if (newFriend.url && !existingFriendUrls.has(newFriend.url)) {
                merged.friends.push(newFriend);
                existingFriendUrls.add(newFriend.url);
            }
        });
        
        console.log(`👥 Friends list updated: ${oldFriendsCount} -> ${merged.friends.length} friends`);
    }

    // Merge photos
    if (newProfile.photos && Array.isArray(newProfile.photos)) {
        merged.photos = merged.photos || [];
        const existingPhotoUrls = new Set(merged.photos.map(p => p.url || p));
        const oldPhotosCount = merged.photos.length;
        
        newProfile.photos.forEach(newPhoto => {
            const photoUrl = newPhoto.url || newPhoto;
            if (photoUrl && !existingPhotoUrls.has(photoUrl)) {
                merged.photos.push(newPhoto);
                existingPhotoUrls.add(photoUrl);
            }
        });
        
        console.log(`📸 Photos updated: ${oldPhotosCount} -> ${merged.photos.length} photos`);
    }

    // Merge posts
    if (newProfile.posts && Array.isArray(newProfile.posts)) {
        merged.posts = merged.posts || [];
        const existingPostIds = new Set(merged.posts.map(p => p.id || p.url || p.text));
        const oldPostsCount = merged.posts.length;
        
        newProfile.posts.forEach(newPost => {
            const postId = newPost.id || newPost.url || newPost.text;
            if (postId && !existingPostIds.has(postId)) {
                merged.posts.push(newPost);
                existingPostIds.add(postId);
            }
        });
        
        console.log(`📝 Posts updated: ${oldPostsCount} -> ${merged.posts.length} posts`);
    }

    // Update metadata
    merged.scraped_at = newProfile.scraped_at || new Date().toISOString();
    merged.last_updated = new Date().toISOString();

    // Keep track of scraping history
    merged.scrape_history = merged.scrape_history || [];
    merged.scrape_history.push({
        timestamp: newProfile.scraped_at || new Date().toISOString(),
        type: newProfile.type || 'unknown',
        sections: Object.keys(newProfile).filter(key => 
            !['url', 'scraped_at', 'depth'].includes(key)
        )
    });

    console.log(`✅ Profile merge completed. Final sections: ${Object.keys(merged).join(', ')}`);
    return merged;
};

// Routes

// POST /api/profile - Store profile data
app.post('/api/profile', (req, res) => {
    try {
        const profileData = req.body;
        const { url, name, depth } = profileData;

        if (!url) {
            return res.status(400).json({ error: 'Profile URL is required' });
        }

        // Create filename from URL
        const filename = url.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
        const profilePath = path.join(PROFILES_DIR, filename);

        // Read existing profile if it exists
        const existingProfile = fs.existsSync(profilePath) ? readJSON(profilePath) : null;

        // Add metadata to new profile data
        profileData.scraped_at = new Date().toISOString();
        profileData.depth = depth || 1;

        // Merge with existing profile data
        const mergedProfile = mergeProfileData(existingProfile, profileData);

        // Save merged profile
        if (writeJSON(profilePath, mergedProfile)) {
            // Add to visited list
            const visited = readJSON(VISITED_FILE) || [];
            if (!visited.includes(url)) {
                visited.push(url);
                writeJSON(VISITED_FILE, visited);
            }

            // Update graph
            updateGraph(mergedProfile);

            const action = existingProfile ? 'updated' : 'saved';
            console.log(`Profile ${action}: ${name} (${url}) at depth ${depth}`);
            res.json({ 
                success: true, 
                message: `Profile ${action} successfully`,
                merged: !!existingProfile,
                sections_added: Object.keys(profileData).filter(key => 
                    !['url', 'scraped_at', 'depth'].includes(key)
                )
            });
        } else {
            res.status(500).json({ error: 'Failed to save profile' });
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/queue - Add URLs to scraping queue
app.post('/api/queue', (req, res) => {
    try {
        const { urls, depth } = req.body;

        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({ error: 'URLs array is required' });
        }

        const queue = readJSON(QUEUE_FILE) || [];
        const visited = readJSON(VISITED_FILE) || [];
        
        let addedCount = 0;

        urls.forEach(url => {
            // Skip if already visited or in queue
            if (!visited.includes(url) && !queue.some(item => item.url === url)) {
                queue.push({
                    url: url,
                    depth: depth || 1,
                    added_at: new Date().toISOString()
                });
                addedCount++;
            }
        });

        if (writeJSON(QUEUE_FILE, queue)) {
            console.log(`Added ${addedCount} URLs to queue at depth ${depth}`);
            res.json({ success: true, added: addedCount, total_queue: queue.length });
        } else {
            res.status(500).json({ error: 'Failed to update queue' });
        }
    } catch (error) {
        console.error('Error updating queue:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/queue - Get current queue
app.get('/api/queue', (req, res) => {
    try {
        const queue = readJSON(QUEUE_FILE) || [];
        res.json({ queue: queue, count: queue.length });
    } catch (error) {
        console.error('Error reading queue:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/visited - Check visited URLs
app.get('/api/visited', (req, res) => {
    try {
        const visited = readJSON(VISITED_FILE) || [];
        const { url } = req.query;
        
        if (url) {
            res.json({ visited: visited.includes(url) });
        } else {
            res.json({ visited: visited, count: visited.length });
        }
    } catch (error) {
        console.error('Error reading visited:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graph - Get graph data
app.get('/api/graph', (req, res) => {
    try {
        const graph = readJSON(GRAPH_FILE) || { nodes: [], edges: [] };
        
        // Convert to format expected by visualizer
        const visualizerFormat = {
            nodes: {},
            adjacency_list: {}
        };
        
        // Convert nodes array to object
        graph.nodes.forEach(node => {
            visualizerFormat.nodes[node.id] = {
                name: node.name,
                url: node.url,
                profile_image: node.image || node.profile_image || '',
                depth: node.depth || 0,
                pagerank: node.pagerank || 0,
                betweenness: node.betweenness || 0,
                community: node.community || 0,
                ...node.data
            };
            
            // Initialize adjacency list
            visualizerFormat.adjacency_list[node.id] = [];
        });
        
        // Convert edges to adjacency list
        graph.edges.forEach(edge => {
            const source = edge.source;
            const target = edge.target;
            
            if (visualizerFormat.adjacency_list[source]) {
                visualizerFormat.adjacency_list[source].push(target);
            }
            
            // Add reverse edge for undirected graph
            if (visualizerFormat.adjacency_list[target]) {
                visualizerFormat.adjacency_list[target].push(source);
            }
        });
        
        res.json(visualizerFormat);
    } catch (error) {
        console.error('Error reading graph:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/profile-image - Store profile image
app.post('/api/profile-image', (req, res) => {
    try {
        const { url, imageData, imageUrl } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Profile URL is required' });
        }

        // Store image data or URL
        const imageInfo = {
            profile_url: url,
            image_data: imageData,
            image_url: imageUrl,
            stored_at: new Date().toISOString()
        };

        const imagePath = path.join(DATA_DIR, 'profile_images.json');
        let images = [];
        
        if (fs.existsSync(imagePath)) {
            images = readJSON(imagePath) || [];
        }

        // Update or add image info
        const existingIndex = images.findIndex(img => img.profile_url === url);
        if (existingIndex >= 0) {
            images[existingIndex] = imageInfo;
        } else {
            images.push(imageInfo);
        }

        if (writeJSON(imagePath, images)) {
            res.json({ success: true, message: 'Profile image saved' });
        } else {
            res.status(500).json({ error: 'Failed to save image' });
        }
    } catch (error) {
        console.error('Error saving profile image:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Function to update graph with new profile
const updateGraph = (profileData) => {
    try {
        const graph = readJSON(GRAPH_FILE) || { nodes: [], edges: [] };
        
        // Add or update node
        const existingNodeIndex = graph.nodes.findIndex(node => node.url === profileData.url);
        const node = {
            id: profileData.url,
            url: profileData.url,
            name: profileData.name || 'Unknown',
            image: profileData.profile_image || '',
            depth: profileData.depth || 1,
            data: profileData
        };

        if (existingNodeIndex >= 0) {
            graph.nodes[existingNodeIndex] = node;
        } else {
            graph.nodes.push(node);
        }

        // Add edges for friends
        if (profileData.friends && Array.isArray(profileData.friends)) {
            profileData.friends.forEach(friend => {
                if (friend.url) {
                    const edgeId = `${profileData.url}-${friend.url}`;
                    const existingEdge = graph.edges.find(edge => edge.id === edgeId);
                    
                    if (!existingEdge) {
                        graph.edges.push({
                            id: edgeId,
                            source: profileData.url,
                            target: friend.url,
                            type: 'friend'
                        });
                    }
                }
            });
        }

        writeJSON(GRAPH_FILE, graph);
    } catch (error) {
        console.error('Error updating graph:', error);
    }
};

// GET /api/stats - Get scraping statistics
app.get('/api/stats', (req, res) => {
    try {
        const visited = readJSON(VISITED_FILE) || [];
        const queue = readJSON(QUEUE_FILE) || [];
        const graph = readJSON(GRAPH_FILE) || { nodes: [], edges: [] };
        
        const profileFiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
        
        const stats = {
            profiles_scraped: visited.length,
            profiles_stored: profileFiles.length,
            queue_remaining: queue.length,
            graph_nodes: graph.nodes.length,
            graph_edges: graph.edges.length,
            depth_distribution: {},
            total_profiles: visited.length,
            total_connections: graph.edges.length,
            average_connections: graph.nodes.length > 0 ? (graph.edges.length * 2) / graph.nodes.length : 0,
            communities: [] // Will be populated by community analysis
        };

        // Calculate depth distribution
        graph.nodes.forEach(node => {
            const depth = node.depth || 1;
            stats.depth_distribution[depth] = (stats.depth_distribution[depth] || 0) + 1;
        });

        res.json(stats);
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/build-graph - Build graph from scraped profiles
app.post('/api/build-graph', (req, res) => {
    try {
        const { spawn } = require('child_process');
        const scriptPath = path.join(__dirname, '..', 'scripts', 'build-graph.js');
        
        // Run the graph building script
        const child = spawn('node', [scriptPath], {
            cwd: path.join(__dirname, '..')
        });

        let output = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            console.error('Graph build error:', data.toString());
        });

        child.on('close', (code) => {
            if (code === 0) {
                // Graph built successfully, read the updated graph
                const graph = readJSON(GRAPH_FILE) || { nodes: [], edges: [], adjacency_list: {} };
                
                res.json({
                    success: true,
                    message: 'Graph built successfully',
                    nodes: Object.keys(graph.nodes || {}).length,
                    edges: Object.values(graph.adjacency_list || {}).flat().length / 2,
                    communities: graph.communities ? graph.communities.length : 0
                });
            } else {
                res.status(500).json({ 
                    success: false, 
                    error: 'Graph building failed',
                    output: output
                });
            }
        });

    } catch (error) {
        console.error('Error building graph:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Conviction annotation endpoints

// POST /api/annotations - Save conviction annotation
app.post('/api/annotations', (req, res) => {
    try {
        const { profileUrl, annotation } = req.body;
        
        if (!profileUrl) {
            return res.status(400).json({ error: 'Profile URL is required' });
        }

        if (!annotation) {
            return res.status(400).json({ error: 'Annotation data is required' });
        }

        // Read existing annotations
        const annotations = readJSON(ANNOTATIONS_FILE) || {};
        
        // Add timestamp and metadata
        annotations[profileUrl] = {
            ...annotation,
            timestamp: Date.now(),
            lastUpdated: new Date().toISOString(),
            savedToBackend: true
        };

        // Save annotations
        if (writeJSON(ANNOTATIONS_FILE, annotations)) {
            console.log(`Conviction annotation saved for: ${profileUrl} - ${annotation.category}`);
            res.json({ 
                success: true, 
                message: 'Annotation saved successfully',
                annotation: annotations[profileUrl]
            });
        } else {
            res.status(500).json({ error: 'Failed to save annotation' });
        }
    } catch (error) {
        console.error('Error saving annotation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/annotations - Get all annotations
app.get('/api/annotations', (req, res) => {
    try {
        const { profileUrl } = req.query;
        const annotations = readJSON(ANNOTATIONS_FILE) || {};
        
        if (profileUrl) {
            // Get annotation for specific profile
            res.json({ annotation: annotations[profileUrl] || null });
        } else {
            // Get all annotations
            res.json({ annotations, count: Object.keys(annotations).length });
        }
    } catch (error) {
        console.error('Error reading annotations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/convictions - Get only confirmed convictions
app.get('/api/convictions', (req, res) => {
    try {
        const annotations = readJSON(ANNOTATIONS_FILE) || {};
        const convictions = {};
        
        for (const [url, annotation] of Object.entries(annotations)) {
            if (annotation.category === 'confirmed-conviction') {
                convictions[url] = annotation;
            }
        }
        
        res.json({ 
            convictions, 
            count: Object.keys(convictions).length,
            exportedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error reading convictions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/annotations/:profileUrl - Remove annotation
app.delete('/api/annotations/:profileUrl', (req, res) => {
    try {
        const profileUrl = decodeURIComponent(req.params.profileUrl);
        const annotations = readJSON(ANNOTATIONS_FILE) || {};
        
        if (annotations[profileUrl]) {
            delete annotations[profileUrl];
            
            if (writeJSON(ANNOTATIONS_FILE, annotations)) {
                console.log(`Annotation removed for: ${profileUrl}`);
                res.json({ success: true, message: 'Annotation removed successfully' });
            } else {
                res.status(500).json({ error: 'Failed to remove annotation' });
            }
        } else {
            res.status(404).json({ error: 'Annotation not found' });
        }
    } catch (error) {
        console.error('Error removing annotation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Alias and similarity detection endpoints

// GET /api/aliases - Get all alias relationships
app.get('/api/aliases', (req, res) => {
    try {
        const aliases = readJSON(ALIASES_FILE) || { aliases: [], similarNames: [], confirmedAliases: [] };
        res.json(aliases);
    } catch (error) {
        console.error('Error reading aliases:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/aliases/detect - Detect similar names automatically
app.post('/api/aliases/detect', (req, res) => {
    try {
        const settings = readJSON(SETTINGS_FILE) || { similarityThreshold: 0.7 };
        const { threshold } = req.body;
        const finalThreshold = threshold || settings.similarityThreshold;
        
        // Read all profiles
        const profileFiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
        const profiles = {};
        
        profileFiles.forEach(file => {
            try {
                const profile = readJSON(path.join(PROFILES_DIR, file));
                if (profile && profile.url) {
                    profiles[profile.url] = profile;
                }
            } catch (error) {
                console.error(`Error reading profile ${file}:`, error);
            }
        });
        
        const similarPairs = detectSimilarNames(profiles, finalThreshold);
        
        // Update aliases file with new detections
        const aliases = readJSON(ALIASES_FILE) || { aliases: [], similarNames: [], confirmedAliases: [] };
        
        // Add new similar pairs, avoiding duplicates
        const existingPairs = new Set(aliases.similarNames.map(p => `${p.url1}|${p.url2}`));
        
        similarPairs.forEach(pair => {
            const pairKey1 = `${pair.url1}|${pair.url2}`;
            const pairKey2 = `${pair.url2}|${pair.url1}`;
            
            if (!existingPairs.has(pairKey1) && !existingPairs.has(pairKey2)) {
                aliases.similarNames.push(pair);
                existingPairs.add(pairKey1);
            }
        });
        
        writeJSON(ALIASES_FILE, aliases);
        
        res.json({
            success: true,
            detected: similarPairs.length,
            threshold: finalThreshold,
            totalSimilar: aliases.similarNames.length,
            newDetections: similarPairs
        });
    } catch (error) {
        console.error('Error detecting aliases:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/aliases/confirm - Confirm a similarity as an alias
app.post('/api/aliases/confirm', (req, res) => {
    try {
        const { url1, url2, aliasType } = req.body;
        
        if (!url1 || !url2) {
            return res.status(400).json({ error: 'Both URLs are required' });
        }
        
        const aliases = readJSON(ALIASES_FILE) || { aliases: [], similarNames: [], confirmedAliases: [] };
        
        const confirmedAlias = {
            url1,
            url2,
            aliasType: aliasType || 'confirmed',
            confirmedAt: new Date().toISOString(),
            confirmedBy: 'manual'
        };
        
        // Add to confirmed aliases
        aliases.confirmedAliases.push(confirmedAlias);
        
        // Remove from similar names if it exists there
        aliases.similarNames = aliases.similarNames.filter(pair => 
            !(pair.url1 === url1 && pair.url2 === url2) && 
            !(pair.url1 === url2 && pair.url2 === url1)
        );
        
        writeJSON(ALIASES_FILE, aliases);
        
        res.json({
            success: true,
            message: 'Alias confirmed successfully',
            alias: confirmedAlias
        });
    } catch (error) {
        console.error('Error confirming alias:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/aliases/similar - Remove a similar name pair
app.delete('/api/aliases/similar', (req, res) => {
    try {
        const { url1, url2 } = req.body;
        
        if (!url1 || !url2) {
            return res.status(400).json({ error: 'Both URLs are required' });
        }
        
        const aliases = readJSON(ALIASES_FILE) || { aliases: [], similarNames: [], confirmedAliases: [] };
        
        const beforeCount = aliases.similarNames.length;
        aliases.similarNames = aliases.similarNames.filter(pair => 
            !(pair.url1 === url1 && pair.url2 === url2) && 
            !(pair.url1 === url2 && pair.url2 === url1)
        );
        
        const removed = beforeCount - aliases.similarNames.length;
        
        writeJSON(ALIASES_FILE, aliases);
        
        res.json({
            success: true,
            message: `Removed ${removed} similar name pair(s)`,
            removed
        });
    } catch (error) {
        console.error('Error removing similar name pair:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Manual connection endpoints

// GET /api/connections/manual - Get all manual connections
app.get('/api/connections/manual', (req, res) => {
    try {
        const connections = readJSON(MANUAL_CONNECTIONS_FILE) || { connections: [], removedConnections: [] };
        res.json(connections);
    } catch (error) {
        console.error('Error reading manual connections:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/connections/manual - Add a manual connection
app.post('/api/connections/manual', (req, res) => {
    try {
        const { source, target, connectionType, reason } = req.body;
        
        if (!source || !target) {
            return res.status(400).json({ error: 'Source and target URLs are required' });
        }
        
        const connections = readJSON(MANUAL_CONNECTIONS_FILE) || { connections: [], removedConnections: [] };
        
        const newConnection = {
            source,
            target,
            connectionType: connectionType || 'friend',
            reason: reason || 'Manual connection',
            createdAt: new Date().toISOString(),
            createdBy: 'manual'
        };
        
        // Check if connection already exists
        const exists = connections.connections.some(conn => 
            (conn.source === source && conn.target === target) ||
            (conn.source === target && conn.target === source)
        );
        
        if (!exists) {
            connections.connections.push(newConnection);
            writeJSON(MANUAL_CONNECTIONS_FILE, connections);
            
            res.json({
                success: true,
                message: 'Manual connection added successfully',
                connection: newConnection
            });
        } else {
            res.status(400).json({ error: 'Connection already exists' });
        }
    } catch (error) {
        console.error('Error adding manual connection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/connections/manual - Remove a manual connection
app.delete('/api/connections/manual', (req, res) => {
    try {
        const { source, target } = req.body;
        
        if (!source || !target) {
            return res.status(400).json({ error: 'Source and target URLs are required' });
        }
        
        const connections = readJSON(MANUAL_CONNECTIONS_FILE) || { connections: [], removedConnections: [] };
        
        const beforeCount = connections.connections.length;
        const removedConnection = connections.connections.find(conn => 
            (conn.source === source && conn.target === target) ||
            (conn.source === target && conn.target === source)
        );
        
        connections.connections = connections.connections.filter(conn => 
            !((conn.source === source && conn.target === target) ||
              (conn.source === target && conn.target === source))
        );
        
        const removed = beforeCount - connections.connections.length;
        
        if (removed > 0 && removedConnection) {
            // Track removed connection for potential restoration
            connections.removedConnections.push({
                ...removedConnection,
                removedAt: new Date().toISOString()
            });
        }
        
        writeJSON(MANUAL_CONNECTIONS_FILE, connections);
        
        res.json({
            success: true,
            message: `Removed ${removed} manual connection(s)`,
            removed
        });
    } catch (error) {
        console.error('Error removing manual connection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Settings endpoints

// GET /api/settings - Get user settings
app.get('/api/settings', (req, res) => {
    try {
        const settings = readJSON(SETTINGS_FILE) || {
            similarityThreshold: 0.7,
            autoDetectAliases: true,
            showSimilarNames: true,
            showManualConnections: true
        };
        res.json(settings);
    } catch (error) {
        console.error('Error reading settings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/settings - Update user settings
app.post('/api/settings', (req, res) => {
    try {
        const currentSettings = readJSON(SETTINGS_FILE) || {};
        const newSettings = { ...currentSettings, ...req.body };
        
        // Validate threshold
        if (newSettings.similarityThreshold !== undefined) {
            if (typeof newSettings.similarityThreshold !== 'number' || 
                newSettings.similarityThreshold < 0 || 
                newSettings.similarityThreshold > 1) {
                return res.status(400).json({ error: 'Similarity threshold must be between 0 and 1' });
            }
        }
        
        newSettings.lastUpdated = new Date().toISOString();
        
        if (writeJSON(SETTINGS_FILE, newSettings)) {
            res.json({
                success: true,
                message: 'Settings updated successfully',
                settings: newSettings
            });
        } else {
            res.status(500).json({ error: 'Failed to save settings' });
        }
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Initialize data files
initializeDataFiles();

// Start server
app.listen(PORT, () => {
    console.log(`Facebook Social Graph Scraper Backend running on port ${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    console.log(`🚀 Facebook Scraper Backend running on http://localhost:${PORT}`);
    console.log(`📊 Visualizer available at http://localhost:${PORT}/visualizer`);
});
