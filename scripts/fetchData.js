/**
 * Data fetcher script for the Facebook OSINT tool.
 * 
 * This script provides a command-line interface to fetch data from Facebook
 * profiles and manage the collection process.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const readline = require('readline');

// Create readline interface for interactive CLI
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/**
 * Main function to run the data fetcher
 */
async function main() {
    console.log('\n======================================');
    console.log('      FACEBOOK OSINT DATA FETCHER     ');
    console.log('======================================\n');

    let choice;
    
    do {
        console.log('\nSelect an option:');
        console.log('1. Analyze Facebook site structure');
        console.log('2. Extract data from a single profile');
        console.log('3. Collect friend list from a profile');
        console.log('4. Perform network traversal');
        console.log('5. Exit');
        
        choice = await askQuestion('\nEnter your choice (1-5): ');
        
        switch(choice) {
            case '1':
                await analyzeSiteStructure();
                break;
            case '2':
                await extractProfile();
                break;
            case '3':
                await collectFriends();
                break;
            case '4':
                await traverseNetwork();
                break;
            case '5':
                console.log('\nExiting data fetcher...');
                break;
            default:
                console.log('\nInvalid choice. Please select a number between 1 and 5.');
        }
    } while (choice !== '5');
    
    rl.close();
}

/**
 * Run Facebook site analyzer
 */
async function analyzeSiteStructure() {
    console.log('\n=== Analyzing Facebook Site Structure ===\n');
    
    try {
        console.log('Running site analyzer...');
        
        // Execute Python module for site analysis
        await runPythonScript('-c', `
from src.collectors.site_analyzer import analyze_facebook_site
results = analyze_facebook_site()
print("Analysis complete!")
print(f"- Found {len(results['robots_txt'][0])} allowed paths in robots.txt")
print(f"- Found {len(results['robots_txt'][1])} disallowed paths in robots.txt")
print(f"- Identified {sum(len(selectors) for selectors in results['stable_selectors'].values())} stable selectors")
print(f"- Documented {len(results['access_boundaries']['legal_data_sources'])} legal data sources")
`);

        console.log('\nSite analysis complete. Results saved to data/cache/site_analysis/.');
        
    } catch (error) {
        console.error(`Error during site analysis: ${error.message}`);
    }
}

/**
 * Extract data from a single profile
 */
async function extractProfile() {
    console.log('\n=== Extract Profile Data ===\n');
    
    try {
        const profileUrl = await askQuestion('Enter Facebook profile URL: ');
        
        if (!isValidFacebookUrl(profileUrl)) {
            console.error('Invalid Facebook profile URL.');
            return;
        }
        
        console.log(`\nExtracting profile data from ${profileUrl}...`);
        console.log('This may take a few moments...');
        
        // Execute Python script for profile extraction
        await runPythonScript('-c', `
from src.collectors.profile_extractor import get_profile_extractor
import json

try:
    extractor = get_profile_extractor()
    profile = extractor.extract_profile("${profileUrl.replace(/"/g, '\\"')}")
    posts = extractor.extract_posts("${profileUrl.replace(/"/g, '\\"')}", max_posts=10)
    
    print(f"\\nExtracted profile: {profile.name}")
    if profile.username:
        print(f"Username: {profile.username}")
    if profile.bio:
        print(f"Bio: {profile.bio}")
    if profile.current_city:
        print(f"Location: {profile.current_city}")
    if profile.work:
        print(f"Works at: {profile.work[0]['description'] if profile.work else 'Unknown'}")
    
    print(f"\\nCollected {len(posts)} posts")
    
    from src.collectors.scraper import get_scraper
    scraper = get_scraper()
    scraper.close()
    
    print("\\nProfile data saved successfully")

except Exception as e:
    print(f"Error: {str(e)}")
`);
        
    } catch (error) {
        console.error(`Error during profile extraction: ${error.message}`);
    }
}

/**
 * Collect friends from a profile
 */
async function collectFriends() {
    console.log('\n=== Collect Friend List ===\n');
    
    try {
        const profileUrl = await askQuestion('Enter Facebook profile URL: ');
        
        if (!isValidFacebookUrl(profileUrl)) {
            console.error('Invalid Facebook profile URL.');
            return;
        }
        
        const maxFriends = await askQuestion('Maximum number of friends to collect (default: 50): ');
        
        console.log(`\nCollecting friends from ${profileUrl}...`);
        console.log('This may take a few minutes depending on the number of friends...');
        
        // Execute Python script for friend collection
        await runPythonScript('-c', `
from src.collectors.friend_collector import get_friend_collector
import json

try:
    collector = get_friend_collector()
    friends = collector.collect_friends(
        "${profileUrl.replace(/"/g, '\\"')}", 
        max_friends=${maxFriends || 50}
    )
    
    print(f"\\nCollected {len(friends)} friends")
    
    if friends:
        print("\\nSample friends:")
        for i, friend in enumerate(friends[:5]):
            print(f"- {friend.name}")
            if i >= 4:
                break
                
        if len(friends) > 5:
            print(f"...and {len(friends) - 5} more")
    
    from src.collectors.scraper import get_scraper
    scraper = get_scraper()
    scraper.close()
    
    print("\\nFriend list saved successfully")

except Exception as e:
    print(f"Error: {str(e)}")
`);
        
    } catch (error) {
        console.error(`Error during friend collection: ${error.message}`);
    }
}

/**
 * Traverse the friend network
 */
async function traverseNetwork() {
    console.log('\n=== Network Traversal ===\n');
    console.log('WARNING: This operation can take a long time and collect a lot of data.');
    console.log('Please use responsibly and respect Facebook\'s Terms of Service.\n');
    
    try {
        const proceed = await askQuestion('Do you want to continue? (y/n): ');
        
        if (proceed.toLowerCase() !== 'y') {
            console.log('Network traversal cancelled.');
            return;
        }
        
        const seedUrl = await askQuestion('Enter seed profile URL: ');
        
        if (!isValidFacebookUrl(seedUrl)) {
            console.error('Invalid Facebook profile URL.');
            return;
        }
        
        const maxDepth = await askQuestion('Maximum traversal depth (1-5, default: 1): ');
        const maxProfiles = await askQuestion('Maximum profiles to visit (default: 20): ');
        const maxFriendsPerProfile = await askQuestion('Maximum friends per profile (default: 20): ');
        
        console.log(`\nStarting network traversal from ${seedUrl}...`);
        console.log('This operation may take a long time depending on the parameters.');
        console.log('You can press Ctrl+C to stop the traversal at any time.\n');
        
        // Execute Python script for network traversal
        await runPythonScript('-c', `
from src.collectors.friend_collector import get_friend_collector
import json

try:
    collector = get_friend_collector()
    results = collector.traverse_network(
        seed_url="${seedUrl.replace(/"/g, '\\"')}",
        max_depth=${maxDepth || 1},
        max_profiles=${maxProfiles || 20},
        max_friends_per_profile=${maxFriendsPerProfile || 20}
    )
    
    print("\\nNetwork Traversal Results:")
    print(f"Seed profile: {results['seed_profile']}")
    print(f"Profiles visited: {results['profiles_visited']}")
    print(f"Max depth reached: {results['max_depth_reached']}")
    print(f"Profiles collected: {results['profiles_collected']}")
    print(f"Friendship edges: {results['friendship_edges']}")
    
    from src.collectors.scraper import get_scraper
    scraper = get_scraper()
    scraper.close()
    
    print("\\nTraversal results saved successfully")

except Exception as e:
    print(f"Error: {str(e)}")
    
    try:
        from src.collectors.scraper import get_scraper
        scraper = get_scraper()
        scraper.close()
    except:
        pass
`);
        
    } catch (error) {
        console.error(`Error during network traversal: ${error.message}`);
    }
}

/**
 * Execute a Python script
 */
function runPythonScript(flag, script) {
    return new Promise((resolve, reject) => {
        // Determine Python executable (python or python3)
        const pythonCmd = process.platform === 'win32' ? 'python' : 
                         (fs.existsSync('/usr/bin/python3') ? 'python3' : 'python');
        
        const child = exec(`${pythonCmd} ${flag} "${script.replace(/"/g, '\\"')}"`, {
            cwd: path.resolve(__dirname, '..')
        });
        
        // Forward stdout and stderr
        child.stdout.on('data', (data) => {
            console.log(data.toString().trim());
        });
        
        child.stderr.on('data', (data) => {
            console.error(data.toString().trim());
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Process exited with code ${code}`));
            }
        });
        
        child.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Helper function to ask a question and get user input
 */
function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

/**
 * Validate a Facebook URL
 */
function isValidFacebookUrl(url) {
    if (!url) return false;
    
    try {
        const parsed = new URL(url);
        return parsed.hostname.includes('facebook.com') || parsed.hostname === 'fb.com';
    } catch (e) {
        return false;
    }
}

// Run the main function
main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});
