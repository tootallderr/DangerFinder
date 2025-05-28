// Test script to verify the enhanced merge functionality
const fs = require('fs');
const path = require('path');

// Define the merge function directly for testing
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
                .filter((item, index, arr) => arr.indexOf(item) === index);
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

// Test case 1: New profile with about data
console.log('=== TEST 1: Merging about data ===');
const existingProfile = {
    url: 'https://facebook.com/test-user',
    name: 'Test User',
    about: {},
    depth: 1,
    type: 'basic'
};

const newAboutProfile = {
    url: 'https://facebook.com/test-user',
    name: 'Test User',
    about: {
        work: ['Test Company', 'Another Company'],
        education: ['Test University'],
        location: ['Test City']
    },
    type: 'about',
    depth: 1
};

const merged1 = mergeProfileData(existingProfile, newAboutProfile);
console.log('\nMerged profile:');
console.log(JSON.stringify(merged1, null, 2));

// Test case 2: Adding friends to existing profile
console.log('\n=== TEST 2: Merging friends data ===');
const newFriendsProfile = {
    url: 'https://facebook.com/test-user',
    name: 'Test User',
    friends: [
        { name: 'Friend One', url: 'https://facebook.com/friend1' },
        { name: 'Friend Two', url: 'https://facebook.com/friend2' }
    ],
    type: 'friends',
    depth: 1
};

const merged2 = mergeProfileData(merged1, newFriendsProfile);
console.log('\nFinal merged profile:');
console.log(JSON.stringify(merged2, null, 2));

console.log('\n=== TEST COMPLETED ===');
