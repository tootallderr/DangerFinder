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

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const VISITED_FILE = path.join(DATA_DIR, 'visited.json');
const GRAPH_FILE = path.join(DATA_DIR, 'graph.json');

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
};

// Helper functions
const readJSON = (filePath) => {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
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

        // Add metadata
        profileData.scraped_at = new Date().toISOString();
        profileData.depth = depth || 1;

        // Save profile
        if (writeJSON(profilePath, profileData)) {
            // Add to visited list
            const visited = readJSON(VISITED_FILE) || [];
            if (!visited.includes(url)) {
                visited.push(url);
                writeJSON(VISITED_FILE, visited);
            }

            // Update graph
            updateGraph(profileData);

            console.log(`Profile saved: ${name} (${url}) at depth ${depth}`);
            res.json({ success: true, message: 'Profile saved successfully' });
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
        res.json(graph);
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

// Build graph endpoint
app.post('/api/build-graph', (req, res) => {
    try {
        const profiles = [];
        const profileFiles = fs.readdirSync(PROFILES_DIR);
        
        profileFiles.forEach(file => {
            if (file.endsWith('.json')) {
                const profileData = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf8'));
                profiles.push(profileData);
            }
        });

        const graph = {
            nodes: profiles.map(profile => ({
                id: profile.url,
                name: profile.name,
                image: profile.image,
                depth: profile.depth || 1,
                ...profile
            })),
            edges: []
        };

        // Build edges from friends relationships
        profiles.forEach(profile => {
            if (profile.friends && Array.isArray(profile.friends)) {
                profile.friends.forEach(friend => {
                    graph.edges.push({
                        source: profile.url,
                        target: friend.url,
                        type: 'friend'
                    });
                });
            }
        });

        // Save graph
        fs.writeFileSync(path.join(DATA_DIR, 'graph.json'), JSON.stringify(graph, null, 2));

        res.json({
            success: true,
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            message: 'Graph built successfully'
        });

    } catch (error) {
        console.error('Error building graph:', error);
        res.status(500).json({ error: error.message });
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
