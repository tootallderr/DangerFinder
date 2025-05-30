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

    const merged = { ...existingProfile };    // Update basic fields if they exist in new profile
    if (newProfile.name) merged.name = newProfile.name;
    if (newProfile.url) merged.url = newProfile.url;
    if (newProfile.profile_image) merged.profile_image = newProfile.profile_image;
    
    // Handle depth updates with special handling for new seeds
    if (newProfile.depth !== undefined) {
        if (newProfile.force_new_seed === true) {
            // Force set as new seed - override any existing depth
            merged.depth = newProfile.depth;
            merged.is_seed = true;
            merged.seed_set_at = new Date().toISOString();
            console.log(`🌱 Forcing profile as new seed at depth ${newProfile.depth}`);
        } else {
            // Normal depth merging - keep minimum depth
            merged.depth = Math.min(existingProfile.depth || Infinity, newProfile.depth);
        }
    }
    
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
        });        res.json({ 
            success: true, 
            message: 'All data has been reset',
            files_removed: profileFiles.length
        });
    } catch (error) {
        console.error('Error resetting data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/scrape/set-seed - Set a profile as a new seed (depth 1)
router.post('/set-seed', (req, res) => {
    try {
        const { url, name } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Profile URL is required' });
        }

        const filename = url.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
        const profilePath = path.join(PROFILES_DIR, filename);

        // Read existing profile if it exists
        const existingProfile = fs.existsSync(profilePath) ? readJSON(profilePath) : null;
        
        if (!existingProfile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        console.log(`🌱 Setting profile as new seed: ${name || existingProfile.name} (${url})`);
        console.log(`📊 Original depth: ${existingProfile.depth} → New depth: 1`);

        // Update the profile with new seed status
        const updatedProfile = {
            ...existingProfile,
            depth: 1,
            is_seed: true,
            seed_set_at: new Date().toISOString(),
            last_updated: new Date().toISOString()
        };

        // Add to scrape history
        updatedProfile.scrape_history = updatedProfile.scrape_history || [];
        updatedProfile.scrape_history.push({
            timestamp: new Date().toISOString(),
            type: 'set_as_seed',
            sections: ['depth_reset'],
            old_depth: existingProfile.depth,
            new_depth: 1
        });        if (writeJSON(profilePath, updatedProfile)) {
            console.log(`✅ Profile updated as new seed successfully`);
            
            // After setting a profile as a seed, we need to add its friends to the queue with depth 2
            // if the profile has already been scraped and has friends data
            if (updatedProfile.friends && updatedProfile.friends.length > 0) {
                const queuePath = path.join(DATA_DIR, 'queue.json');
                const queue = readJSON(queuePath) || [];
                const visited = readJSON(path.join(DATA_DIR, 'visited.json')) || [];
                
                // Extract friend URLs
                const friendUrls = updatedProfile.friends.map(friend => friend.url);
                let addedCount = 0;
                
                // Add friends to queue at depth 2
                friendUrls.forEach(url => {
                    // Skip if already visited or in queue
                    if (!visited.includes(url) && !queue.some(item => item.url === url)) {
                        queue.push({
                            url: url,
                            depth: 2, // Depth 2 since the seed is depth 1
                            added_at: new Date().toISOString(),
                            source: `seed:${updatedProfile.url}`
                        });
                        addedCount++;
                    }
                });
                
                // Save updated queue
                if (writeJSON(queuePath, queue)) {
                    console.log(`🔄 Added ${addedCount} friends of the new seed to the queue with depth 2`);
                }
            } else {
                console.log(`⚠️ No friends data available for seed profile. Run a full scrape to collect friends.`);
            }
            
            res.json({ 
                success: true, 
                message: `Profile set as new seed (depth 1)`,
                profile: {
                    url: updatedProfile.url,
                    name: updatedProfile.name,
                    old_depth: existingProfile.depth,
                    new_depth: 1,
                    is_seed: true
                }
            });
        } else {
            res.status(500).json({ error: 'Failed to update profile' });
        }
    } catch (error) {
        console.error('Error setting profile as seed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/scrape/fix-friends-depth - Fix depth of friends when profile becomes new seed
router.post('/fix-friends-depth', (req, res) => {
    try {
        const { seedUrl, oldDepth, newDepth } = req.body;
        
        if (!seedUrl || oldDepth === undefined || newDepth === undefined) {
            return res.status(400).json({ error: 'seedUrl, oldDepth, and newDepth are required' });
        }

        console.log(`🔧 Fixing friends depth for seed: ${seedUrl}`);
        console.log(`   Profile depth changed: ${oldDepth} → ${newDepth}`);
        console.log(`   Need to fix friends from depth ${oldDepth + 1} to depth ${newDepth + 1}`);

        // Read current queue
        const queueFile = path.join(DATA_DIR, 'queue.json');
        const queue = readJSON(queueFile) || [];
        
        // Read profile to get friends list
        const profilePath = path.join(DATA_DIR, 'profiles', `${seedUrl.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
        const profile = readJSON(profilePath);
        
        if (!profile || !profile.friends) {
            return res.json({ success: true, fixed: 0, message: 'No friends found for this profile' });
        }

        // Get friend URLs
        const friendUrls = profile.friends.map(f => f.url).filter(url => url);
        const wrongDepth = oldDepth + 1;
        const correctDepth = newDepth + 1;
        
        let fixedCount = 0;

        // Update depth for friends in queue
        queue.forEach(item => {
            if (friendUrls.includes(item.url) && item.depth === wrongDepth) {
                console.log(`   Fixing: ${item.url} depth ${wrongDepth} → ${correctDepth}`);
                item.depth = correctDepth;
                item.depth_fixed_at = new Date().toISOString();
                item.original_depth = wrongDepth;
                fixedCount++;
            }
        });

        // Save updated queue
        if (writeJSON(queueFile, queue)) {
            console.log(`✅ Fixed ${fixedCount} friend URLs in queue`);
            res.json({ 
                success: true, 
                fixed: fixedCount,
                friendsTotal: friendUrls.length,
                wrongDepth: wrongDepth,
                correctDepth: correctDepth
            });
        } else {
            res.status(500).json({ error: 'Failed to update queue' });
        }
        
    } catch (error) {
        console.error('Error fixing friends depth:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/scrape/fix-all-depths - Comprehensive depth fixing for all profiles
router.post('/fix-all-depths', (req, res) => {
    try {
        console.log('🔧 Starting comprehensive depth analysis and fixing...');
        
        const queueFile = path.join(DATA_DIR, 'queue.json');
        const queue = readJSON(queueFile) || [];
        
        // Read all profiles to understand depth relationships
        const profilesDir = path.join(DATA_DIR, 'profiles');
        const profileFiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'));
        
        let totalFixed = 0;
        let profilesProcessed = 0;
        const fixDetails = [];
        
        profileFiles.forEach(filename => {
            try {
                const profilePath = path.join(profilesDir, filename);
                const profile = readJSON(profilePath);
                
                if (!profile || !profile.friends || !Array.isArray(profile.friends)) {
                    return; // Skip profiles without friends
                }
                
                profilesProcessed++;
                const profileDepth = profile.depth || 1;
                const expectedFriendDepth = profileDepth + 1;
                
                // Get friend URLs
                const friendUrls = profile.friends.map(f => f.url).filter(url => url);
                let fixedForThisProfile = 0;
                
                // Check and fix friends in queue
                queue.forEach(item => {
                    if (friendUrls.includes(item.url)) {
                        if (item.depth !== expectedFriendDepth) {
                            console.log(`   Fixing: ${item.url} depth ${item.depth} → ${expectedFriendDepth} (friend of ${profile.name})`);
                            item.original_depth = item.depth;
                            item.depth = expectedFriendDepth;
                            item.depth_fixed_at = new Date().toISOString();
                            item.fixed_reason = `Friend of ${profile.name} (depth ${profileDepth})`;
                            fixedForThisProfile++;
                            totalFixed++;
                        }
                    }
                });
                
                if (fixedForThisProfile > 0) {
                    fixDetails.push({
                        profile: profile.name || profile.url,
                        fixed: fixedForThisProfile,
                        oldDepth: 'various',
                        newDepth: expectedFriendDepth
                    });
                }
                
            } catch (error) {
                console.error(`Error processing profile ${filename}:`, error);
            }
        });
        
        // Save updated queue
        if (writeJSON(queueFile, queue)) {
            console.log(`✅ Comprehensive depth fix completed: ${totalFixed} URLs fixed across ${profilesProcessed} profiles`);
            res.json({
                success: true,
                totalFixed: totalFixed,
                profilesProcessed: profilesProcessed,
                details: fixDetails
            });
        } else {
            res.status(500).json({ error: 'Failed to update queue' });
        }
        
    } catch (error) {
        console.error('Error in comprehensive depth fix:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/scrape/validate-depths - Validate queue depth consistency
router.get('/validate-depths', (req, res) => {
    try {
        console.log('🔍 Validating queue depth consistency...');
        
        const queueFile = path.join(DATA_DIR, 'queue.json');
        const queue = readJSON(queueFile) || [];
        
        // Read all profiles to understand expected depth relationships
        const profilesDir = path.join(DATA_DIR, 'profiles');
        const profileFiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'));
        
        const issues = [];
        let validatedCount = 0;
        
        profileFiles.forEach(filename => {
            try {
                const profilePath = path.join(profilesDir, filename);
                const profile = readJSON(profilePath);
                
                if (!profile || !profile.friends || !Array.isArray(profile.friends)) {
                    return; // Skip profiles without friends
                }
                
                const profileDepth = profile.depth || 1;
                const expectedFriendDepth = profileDepth + 1;
                const friendUrls = profile.friends.map(f => f.url).filter(url => url);
                
                // Check friends in queue
                queue.forEach(item => {
                    if (friendUrls.includes(item.url)) {
                        validatedCount++;
                        if (item.depth !== expectedFriendDepth) {
                            issues.push(
                                `${item.url} has depth ${item.depth} but should be ${expectedFriendDepth} (friend of ${profile.name} at depth ${profileDepth})`
                            );
                        }
                    }
                });
                
            } catch (error) {
                console.error(`Error validating profile ${filename}:`, error);
                issues.push(`Error reading profile ${filename}: ${error.message}`);
            }
        });
        
        console.log(`✅ Validation completed: ${validatedCount} URLs validated, ${issues.length} issues found`);
        
        res.json({
            valid: issues.length === 0,
            issues: issues,
            validatedCount: validatedCount,
            totalQueue: queue.length
        });
        
    } catch (error) {
        console.error('Error validating depths:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
