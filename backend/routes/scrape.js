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

// Merge profile data with existing profile
const mergeProfileData = (existingProfile, newProfile) => {
    if (!existingProfile) {
        return newProfile;
    }

    const merged = { ...existingProfile };

    // Update basic fields if they exist in new profile
    if (newProfile.name) merged.name = newProfile.name;
    if (newProfile.url) merged.url = newProfile.url;
    if (newProfile.profile_image) merged.profile_image = newProfile.profile_image;
    if (newProfile.depth !== undefined) merged.depth = Math.min(existingProfile.depth || Infinity, newProfile.depth);
    if (newProfile.type) merged.type = newProfile.type;

    // Merge about sections
    if (newProfile.about) {
        merged.about = merged.about || {};
        if (newProfile.about.work) {
            merged.about.work = [...(merged.about.work || []), ...newProfile.about.work]
                .filter((item, index, arr) => arr.indexOf(item) === index); // Remove duplicates
        }
        if (newProfile.about.education) {
            merged.about.education = [...(merged.about.education || []), ...newProfile.about.education]
                .filter((item, index, arr) => arr.indexOf(item) === index);
        }
        if (newProfile.about.location) {
            merged.about.location = [...(merged.about.location || []), ...newProfile.about.location]
                .filter((item, index, arr) => arr.indexOf(item) === index);
        }
        if (newProfile.about.relationship) merged.about.relationship = newProfile.about.relationship;
        if (newProfile.about.bio) merged.about.bio = newProfile.about.bio;
    }

    // Merge friends list
    if (newProfile.friends && Array.isArray(newProfile.friends)) {
        merged.friends = merged.friends || [];
        const existingFriendUrls = new Set(merged.friends.map(f => f.url));
        
        newProfile.friends.forEach(newFriend => {
            if (newFriend.url && !existingFriendUrls.has(newFriend.url)) {
                merged.friends.push(newFriend);
                existingFriendUrls.add(newFriend.url);
            }
        });
    }

    // Merge photos
    if (newProfile.photos && Array.isArray(newProfile.photos)) {
        merged.photos = merged.photos || [];
        const existingPhotoUrls = new Set(merged.photos.map(p => p.url || p));
        
        newProfile.photos.forEach(newPhoto => {
            const photoUrl = newPhoto.url || newPhoto;
            if (photoUrl && !existingPhotoUrls.has(photoUrl)) {
                merged.photos.push(newPhoto);
                existingPhotoUrls.add(photoUrl);
            }
        });
    }

    // Merge posts
    if (newProfile.posts && Array.isArray(newProfile.posts)) {
        merged.posts = merged.posts || [];
        const existingPostIds = new Set(merged.posts.map(p => p.id || p.url || p.text));
        
        newProfile.posts.forEach(newPost => {
            const postId = newPost.id || newPost.url || newPost.text;
            if (postId && !existingPostIds.has(postId)) {
                merged.posts.push(newPost);
                existingPostIds.add(postId);
            }
        });
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

    return merged;
};

// Advanced scraping routes

// GET /api/scrape/next - Get next URL to scrape
router.get('/next', (req, res) => {
    try {
        const queueFile = path.join(DATA_DIR, 'queue.json');
        const queue = readJSON(queueFile) || [];
        const maxDepth = parseInt(req.query.maxDepth) || 5; // Default to 5 if not specified
        
        if (queue.length === 0) {
            return res.json({ url: null, message: 'Queue is empty' });
        }

        // Filter by max depth and sort by depth (lower depth first)
        const filteredQueue = queue.filter(item => (item.depth || 1) <= maxDepth);
        
        if (filteredQueue.length === 0) {
            return res.json({ 
                url: null, 
                message: `No URLs available at depth <= ${maxDepth}`,
                remaining: queue.length,
                skipped: queue.length
            });
        }
        
        filteredQueue.sort((a, b) => (a.depth || 1) - (b.depth || 1));
        
        const nextItem = filteredQueue[0];
        // Remove the selected item from the original queue
        const itemIndex = queue.findIndex(item => 
            item.url === nextItem.url && 
            item.depth === nextItem.depth && 
            item.added_at === nextItem.added_at
        );
        if (itemIndex !== -1) {
            queue.splice(itemIndex, 1);
            writeJSON(queueFile, queue);
        }
        
        res.json({
            url: nextItem.url,
            depth: nextItem.depth,
            remaining: queue.length,
            availableAtDepth: filteredQueue.length - 1
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
        let mergedCount = 0;
        const errors = [];

        profiles.forEach((profile, index) => {
            try {
                if (!profile.url) {
                    errors.push(`Profile ${index}: URL is required`);
                    return;
                }

                const filename = profile.url.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
                const profilePath = path.join(PROFILES_DIR, filename);

                // Read existing profile if it exists
                const existingProfile = fs.existsSync(profilePath) ? readJSON(profilePath) : null;

                // Add metadata to new profile data
                profile.scraped_at = new Date().toISOString();
                profile.batch_processed = true;

                // Merge with existing profile data
                const mergedProfile = mergeProfileData(existingProfile, profile);

                if (writeJSON(profilePath, mergedProfile)) {
                    savedCount++;
                    if (existingProfile) {
                        mergedCount++;
                    }
                } else {
                    errors.push(`Profile ${index}: Failed to save`);
                }
            } catch (error) {
                errors.push(`Profile ${index}: ${error.message}`);
            }
        });        res.json({
            success: true,
            saved: savedCount,
            merged: mergedCount,
            new: savedCount - mergedCount,
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
