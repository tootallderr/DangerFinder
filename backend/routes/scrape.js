const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Data file paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');

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

// Advanced scraping routes

// GET /api/scrape/next - Get next URL to scrape
router.get('/next', (req, res) => {
    try {
        const queueFile = path.join(DATA_DIR, 'queue.json');
        const queue = readJSON(queueFile) || [];
        
        if (queue.length === 0) {
            return res.json({ url: null, message: 'Queue is empty' });
        }

        // Sort by depth (lower depth first)
        queue.sort((a, b) => (a.depth || 1) - (b.depth || 1));
        
        const nextItem = queue.shift();
        writeJSON(queueFile, queue);
        
        res.json({
            url: nextItem.url,
            depth: nextItem.depth,
            remaining: queue.length
        });
    } catch (error) {
        console.error('Error getting next URL:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/scrape/batch - Process multiple profiles
router.post('/batch', (req, res) => {
    try {
        const { profiles } = req.body;
        
        if (!profiles || !Array.isArray(profiles)) {
            return res.status(400).json({ error: 'Profiles array is required' });
        }

        let savedCount = 0;
        const errors = [];

        profiles.forEach((profile, index) => {
            try {
                if (!profile.url) {
                    errors.push(`Profile ${index}: URL is required`);
                    return;
                }

                const filename = profile.url.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
                const profilePath = path.join(PROFILES_DIR, filename);

                profile.scraped_at = new Date().toISOString();
                profile.batch_processed = true;

                if (writeJSON(profilePath, profile)) {
                    savedCount++;
                } else {
                    errors.push(`Profile ${index}: Failed to save`);
                }
            } catch (error) {
                errors.push(`Profile ${index}: ${error.message}`);
            }
        });

        res.json({
            success: true,
            saved: savedCount,
            total: profiles.length,
            errors: errors
        });
    } catch (error) {
        console.error('Error processing batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/scrape/profiles - Get all stored profiles
router.get('/profiles', (req, res) => {
    try {
        const { depth, limit } = req.query;
        const profileFiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
        
        let profiles = [];
        
        profileFiles.forEach(file => {
            const profilePath = path.join(PROFILES_DIR, file);
            const profile = readJSON(profilePath);
            if (profile) {
                if (!depth || profile.depth == depth) {
                    profiles.push(profile);
                }
            }
        });

        // Apply limit if specified
        if (limit && !isNaN(limit)) {
            profiles = profiles.slice(0, parseInt(limit));
        }

        res.json({
            profiles: profiles,
            total: profiles.length,
            total_files: profileFiles.length
        });
    } catch (error) {
        console.error('Error getting profiles:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/scrape/reset - Reset all data
router.delete('/reset', (req, res) => {
    try {
        const { confirm } = req.body;
        
        if (confirm !== 'RESET_ALL_DATA') {
            return res.status(400).json({ 
                error: 'Confirmation required. Send {"confirm": "RESET_ALL_DATA"}' 
            });
        }

        // Clear all data files
        const queueFile = path.join(DATA_DIR, 'queue.json');
        const visitedFile = path.join(DATA_DIR, 'visited.json');
        const graphFile = path.join(DATA_DIR, 'graph.json');

        writeJSON(queueFile, []);
        writeJSON(visitedFile, []);
        writeJSON(graphFile, { nodes: [], edges: [] });

        // Clear profile files
        const profileFiles = fs.readdirSync(PROFILES_DIR);
        profileFiles.forEach(file => {
            if (file.endsWith('.json')) {
                fs.unlinkSync(path.join(PROFILES_DIR, file));
            }
        });

        res.json({ 
            success: true, 
            message: 'All data has been reset',
            files_removed: profileFiles.length
        });
    } catch (error) {
        console.error('Error resetting data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
