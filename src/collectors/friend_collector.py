"""
Facebook friend list collector module.

This module provides functionality to collect friends from a Facebook profile
and traverse the relationship graph in a breadth-first manner.
"""

import os
import json
import time
from pathlib import Path
from typing import Dict, List, Set, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
from collections import deque
import re
from urllib.parse import urlparse, parse_qs

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

from src.utils.logger import get_logger, log_function_call
from src.utils.errors import handle_errors, ScrapingError, NetworkError
from src.utils.config import get_config
from src.collectors.scraper import get_scraper
from src.collectors.profile_extractor import get_profile_extractor, ProfileBasicInfo

logger = get_logger(__name__)

@dataclass
class Friend:
    """Represents a Facebook friend relationship."""
    profile_id: str
    name: str
    username: Optional[str] = None
    profile_url: Optional[str] = None
    profile_picture: Optional[str] = None
    mutual_friends_count: Optional[int] = None
    last_update: str = None
    
    def __post_init__(self):
        if self.last_update is None:
            self.last_update = datetime.now().isoformat()


@dataclass
class FriendshipEdge:
    """Represents a friendship edge between two profiles."""
    source_id: str
    target_id: str
    mutual_friends_count: Optional[int] = None
    last_update: str = None
    
    def __post_init__(self):
        if self.last_update is None:
            self.last_update = datetime.now().isoformat()


class FriendListCollector:
    """
    Collects friend lists from Facebook profiles and manages
    the graph traversal process.
    """
    
    def __init__(self):
        """Initialize friend list collector."""
        self.config = get_config("scraping")
        self.scraper = get_scraper()
        self.profile_extractor = get_profile_extractor()
        self.browser = None
        self.visited_profiles = set()
        self.friend_cache = {}  # Cache of collected friend lists by profile_id
        self.queue = deque()  # Queue for breadth-first traversal
        self.edges = {}  # Dictionary of friendship edges
        self.max_depth = self.config.recursion_depth  # Default depth from config
    
    @log_function_call
    @handle_errors(reraise=True)
    def collect_friends(self, url: str, max_friends: int = 100) -> List[Friend]:
        """
        Collect friends from a Facebook profile.
        
        Args:
            url: Profile URL
            max_friends: Maximum number of friends to collect
            
        Returns:
            List of Friend objects
            
        Raises:
            ScrapingError: If friend collection fails
        """
        profile_url = self._normalize_url(url)
        profile_id = self._extract_profile_id(profile_url)
        
        # Check cache first
        if profile_id in self.friend_cache:
            logger.info(f"Using cached friend list for {profile_id}")
            return self.friend_cache[profile_id][:max_friends]
        
        logger.info(f"Collecting friends from {profile_url}")
        
        # Ensure browser is initialized
        self.browser = self.scraper.browser_manager.initialize_browser()
        
        try:
            # Navigate to friends page
            friends_url = self._get_friends_url(profile_url)
            self.scraper.browser_manager.navigate_to(friends_url)
            
            # Wait for friends to load
            try:
                WebDriverWait(self.browser, 10).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "div[role='main']"))
                )
            except TimeoutException:
                logger.warning("Friends page loading timeout")
            
            # Check if friends are visible to us
            if self._is_content_restricted():
                logger.warning(f"Friend list for {profile_url} is restricted")
                self.friend_cache[profile_id] = []
                return []
            
            # Extract friends
            friends = []
            collected_ids = set()
            scroll_count = 0
            max_scrolls = 20
            
            # Process visible friends
            while len(friends) < max_friends and scroll_count < max_scrolls:
                # Extract current visible friends
                new_friends = self._extract_visible_friends(profile_id)
                
                # Add new friends to list
                for friend in new_friends:
                    if friend.profile_id not in collected_ids:
                        friends.append(friend)
                        collected_ids.add(friend.profile_id)
                        
                        # Add edge to graph
                        edge = FriendshipEdge(
                            source_id=profile_id,
                            target_id=friend.profile_id,
                            mutual_friends_count=friend.mutual_friends_count
                        )
                        edge_key = f"{profile_id}_{friend.profile_id}"
                        self.edges[edge_key] = edge
                        
                        if len(friends) >= max_friends:
                            break
                
                # Check if we need to scroll more
                if len(friends) < max_friends:
                    # Scroll down to load more friends
                    self.browser.execute_script(
                        "window.scrollTo(0, document.body.scrollHeight);"
                    )
                    time.sleep(2)  # Wait for content to load
                    scroll_count += 1
            
            # Save to cache
            self.friend_cache[profile_id] = friends
            self._save_friends_to_disk(profile_id, friends)
            self._save_edges_to_disk()
            
            logger.info(f"Collected {len(friends)} friends for {profile_id}")
            return friends
            
        except Exception as e:
            logger.error(f"Failed to collect friends: {str(e)}")
            raise ScrapingError(f"Failed to collect friends: {str(e)}")
    
    @log_function_call
    @handle_errors(reraise=True)
    def traverse_network(self, seed_url: str, max_depth: int = None, 
                       max_profiles: int = None, max_friends_per_profile: int = 50) -> Dict[str, Any]:
        """
        Traverse the friend network starting from a seed profile.
        
        Args:
            seed_url: Seed profile URL
            max_depth: Maximum depth for traversal
            max_profiles: Maximum number of profiles to visit
            max_friends_per_profile: Maximum friends to collect per profile
            
        Returns:
            Dictionary with traversal results
            
        Raises:
            ScrapingError: If traversal fails
        """
        # Use provided values or defaults from config
        if max_depth is None:
            max_depth = self.max_depth
        
        if max_profiles is None:
            max_profiles = self.config.max_profiles
        
        logger.info(f"Starting network traversal from {seed_url} with max depth {max_depth}")
        
        # Initialize traversal
        seed_url = self._normalize_url(seed_url)
        seed_id = self._extract_profile_id(seed_url)
        
        self.visited_profiles = set()
        self.queue = deque([(seed_id, seed_url, 0)])  # (id, url, depth)
        
        profiles_visited = 0
        profiles_collected = {}
        
        # Start breadth-first traversal
        while self.queue and profiles_visited < max_profiles:
            current_id, current_url, current_depth = self.queue.popleft()
            
            if current_id in self.visited_profiles:
                continue
            
            logger.info(f"Processing profile {current_url} (depth: {current_depth})")
            self.visited_profiles.add(current_id)
            profiles_visited += 1
            
            try:
                # Extract profile data
                profile = self.profile_extractor.extract_profile(current_url)
                profiles_collected[current_id] = profile
                
                # If we've reached max depth, don't collect friends
                if current_depth >= max_depth:
                    continue
                
                # Collect friends
                friends = self.collect_friends(current_url, max_friends_per_profile)
                
                # Add friends to queue for next level
                for friend in friends:
                    if friend.profile_id not in self.visited_profiles:
                        self.queue.append((friend.profile_id, friend.profile_url, current_depth + 1))
            
            except Exception as e:
                logger.error(f"Error processing profile {current_url}: {str(e)}")
                continue
            
            # Add some delay between profiles
            time.sleep(random.uniform(1, 3))
        
        # Save traversal results
        self._save_traversal_results(seed_id, profiles_collected)
        
        results = {
            "seed_profile": seed_id,
            "profiles_visited": profiles_visited,
            "max_depth_reached": current_depth if self.queue else max_depth,
            "profiles_collected": len(profiles_collected),
            "friendship_edges": len(self.edges)
        }
        
        logger.info(f"Network traversal complete. Visited {profiles_visited} profiles.")
        return results
    
    def _extract_visible_friends(self, profile_id: str) -> List[Friend]:
        """Extract friends that are currently visible on the page."""
        friends = []
        
        try:
            # Use the selectors from the site analyzer
            friend_selectors = [
                "div[role='main'] div.x1qjc9v5 a[href*='/user/']",
                "div.xb0tzng a[href*='/profile.php']",
                "div[data-pagelet='ProfileGridTile']",
                "div[role='main'] a[href*='/friends/']"
            ]
            
            # Find friend container elements
            friend_elements = []
            for selector in friend_selectors:
                elements = self.scraper.browser_manager.find_elements(selector)
                if elements:
                    friend_elements.extend(elements)
                    break
            
            # Process each friend element
            for element in friend_elements:
                try:
                    # Find the link to the profile
                    if element.tag_name != "a":
                        links = element.find_elements(By.TAG_NAME, "a")
                        link_element = links[0] if links else None
                    else:
                        link_element = element
                    
                    if not link_element:
                        continue
                    
                    # Extract friend data
                    friend_url = link_element.get_attribute("href")
                    if not friend_url or "facebook.com" not in friend_url:
                        continue
                    
                    friend_id = self._extract_profile_id(friend_url)
                    
                    # Find name element
                    name_element = None
                    try:
                        # Try different selectors for name
                        name_selectors = [
                            "span.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1xmvt09",
                            "span[dir='auto']",
                            ".x1i10hfl"
                        ]
                        
                        for selector in name_selectors:
                            name_elements = element.find_elements(By.CSS_SELECTOR, selector)
                            if name_elements:
                                name_element = name_elements[0]
                                break
                        
                        if not name_element:
                            name_element = link_element
                            
                    except NoSuchElementException:
                        name_element = link_element
                    
                    name = name_element.text.strip() if name_element else "Unknown"
                    
                    # Find profile picture
                    profile_picture = None
                    try:
                        img_elements = element.find_elements(By.TAG_NAME, "img")
                        if img_elements:
                            profile_picture = img_elements[0].get_attribute("src")
                    except NoSuchElementException:
                        pass
                    
                    # Find mutual friends count
                    mutual_count = None
                    try:
                        # Look for text with "mutual friends"
                        for span in element.find_elements(By.TAG_NAME, "span"):
                            text = span.text.lower()
                            if "mutual" in text and "friend" in text:
                                # Extract number
                                match = re.search(r'(\d+)', text)
                                if match:
                                    mutual_count = int(match.group(1))
                                break
                    except (NoSuchElementException, ValueError):
                        pass
                    
                    # Create Friend object
                    friend = Friend(
                        profile_id=friend_id,
                        name=name,
                        profile_url=friend_url,
                        profile_picture=profile_picture,
                        mutual_friends_count=mutual_count
                    )
                    
                    friends.append(friend)
                    
                except Exception as e:
                    logger.debug(f"Error extracting friend data: {str(e)}")
                    continue
            
            return friends
            
        except Exception as e:
            logger.error(f"Failed to extract visible friends: {str(e)}")
            return []
    
    def _normalize_url(self, url: str) -> str:
        """Normalize a Facebook profile URL."""
        parsed = urlparse(url)
        
        # Ensure the URL is from facebook.com
        if parsed.netloc not in ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com"]:
            raise ValueError("Invalid Facebook URL")
        
        # Convert to desktop version
        netloc = "www.facebook.com"
        
        # Keep only the relevant part of the path
        path = parsed.path.strip("/")
        
        if "profile.php" in path:
            # Handle profile.php?id=12345 format
            query = parsed.query
            return f"https://{netloc}/{path}?{query}"
        else:
            # Handle username format
            if "/" in path:
                path = path.split("/")[0]
            return f"https://{netloc}/{path}"
    
    def _extract_profile_id(self, url: str) -> str:
        """Extract profile ID from URL."""
        parsed = urlparse(url)
        
        if "profile.php" in parsed.path:
            # Extract from profile.php?id=12345 format
            query_params = parse_qs(parsed.query)
            if "id" in query_params:
                return query_params["id"][0]
        
        # If not found, use the username as ID
        path = parsed.path.strip("/")
        if "/" in path:
            return path.split("/")[0]
        return path
    
    def _get_friends_url(self, profile_url: str) -> str:
        """Get the URL for the friends page of a profile."""
        parsed = urlparse(profile_url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"
        path = parsed.path.strip("/")
        
        if "profile.php" in path:
            # Handle profile.php?id=12345 format
            query = parsed.query
            return f"{base_url}/{path}/friends?{query}"
        else:
            # Handle username format
            return f"{base_url}/{path}/friends"
    
    def _is_content_restricted(self) -> bool:
        """Check if the friend list is restricted."""
        try:
            # Look for "No content available" or similar messages
            error_selectors = [
                "div[data-pagelet='NoContent']",
                "div.x1n2onr6.x1qjc9v5 h2"
            ]
            
            for selector in error_selectors:
                elements = self.browser.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    text = elements[0].text.lower()
                    if "no content" in text or "isn't available" in text or "available right now" in text:
                        return True
            
            # Check if we can find any friend elements
            friend_selectors = [
                "div[role='main'] div.x1qjc9v5 a[href*='/user/']",
                "div.xb0tzng a[href*='/profile.php']",
                "div[data-pagelet='ProfileGridTile']"
            ]
            
            for selector in friend_selectors:
                if self.browser.find_elements(By.CSS_SELECTOR, selector):
                    return False
            
            # If we can't find any friends using known selectors, assume restricted
            return True
            
        except Exception as e:
            logger.debug(f"Error checking content restriction: {str(e)}")
            return True
    
    def _save_friends_to_disk(self, profile_id: str, friends: List[Friend]):
        """Save friends data to disk."""
        if not friends:
            return
            
        config = get_config()
        friends_dir = Path(config.data_dir) / "friends"
        friends_dir.mkdir(exist_ok=True)
        
        try:
            friends_data = [asdict(friend) for friend in friends]
            
            with open(friends_dir / f"{profile_id}_friends.json", 'w') as f:
                json.dump(friends_data, f, indent=2)
            logger.debug(f"Saved {len(friends)} friends for profile {profile_id} to disk")
        except Exception as e:
            logger.warning(f"Failed to save friends to disk: {e}")
    
    def _save_edges_to_disk(self):
        """Save friendship edges to disk."""
        if not self.edges:
            return
            
        config = get_config()
        graph_dir = Path(config.data_dir) / "graph"
        graph_dir.mkdir(exist_ok=True)
        
        try:
            edges_data = [asdict(edge) for edge in self.edges.values()]
            
            with open(graph_dir / "friendship_edges.json", 'w') as f:
                json.dump(edges_data, f, indent=2)
            logger.debug(f"Saved {len(self.edges)} friendship edges to disk")
        except Exception as e:
            logger.warning(f"Failed to save edges to disk: {e}")
    
    def _save_traversal_results(self, seed_id: str, profiles: Dict[str, ProfileBasicInfo]):
        """Save traversal results to disk."""
        config = get_config()
        traversal_dir = Path(config.data_dir) / "traversals"
        traversal_dir.mkdir(exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        try:
            # Save metadata
            metadata = {
                "seed_profile_id": seed_id,
                "timestamp": timestamp,
                "profiles_visited": len(self.visited_profiles),
                "profiles_collected": len(profiles),
                "edges_collected": len(self.edges),
                "max_depth": self.max_depth
            }
            
            with open(traversal_dir / f"traversal_{seed_id}_{timestamp}_meta.json", 'w') as f:
                json.dump(metadata, f, indent=2)
            
            # Save profiles summary
            profiles_summary = []
            for profile_id, profile in profiles.items():
                summary = {
                    "profile_id": profile_id,
                    "name": profile.name,
                    "username": profile.username,
                    "profile_url": profile.profile_url
                }
                profiles_summary.append(summary)
            
            with open(traversal_dir / f"traversal_{seed_id}_{timestamp}_profiles.json", 'w') as f:
                json.dump(profiles_summary, f, indent=2)
            
            logger.info(f"Saved traversal results for seed {seed_id}")
        except Exception as e:
            logger.warning(f"Failed to save traversal results: {e}")


# Singleton instance
_collector_instance = None

def get_friend_collector() -> FriendListCollector:
    """
    Get the singleton friend collector instance.
    
    Returns:
        FriendListCollector: The friend collector instance
    """
    global _collector_instance
    if _collector_instance is None:
        _collector_instance = FriendListCollector()
    
    return _collector_instance


if __name__ == "__main__":
    import random
    
    # Test friend collection
    collector = get_friend_collector()
    
    # Example URL (replace with a test URL)
    test_url = "https://www.facebook.com/zuck"
    
    try:
        friends = collector.collect_friends(test_url, max_friends=20)
        print(f"Collected {len(friends)} friends")
        
        if friends:
            # Print some sample friends
            for i in range(min(5, len(friends))):
                friend = friends[i]
                print(f"\nFriend {i+1}:")
                print(f"Name: {friend.name}")
                print(f"Profile URL: {friend.profile_url}")
                print(f"Mutual Friends: {friend.mutual_friends_count or 'Unknown'}")
        
        # Test network traversal
        # Note: This can take a long time and collect a lot of data
        # Only uncomment for actual testing with a small depth
        """
        results = collector.traverse_network(
            test_url,
            max_depth=1,        # Only direct friends
            max_profiles=5,      # Limit to 5 profiles
            max_friends_per_profile=10  # Only 10 friends per profile
        )
        
        print("\nNetwork Traversal Results:")
        print(f"Profiles visited: {results['profiles_visited']}")
        print(f"Profiles collected: {results['profiles_collected']}")
        print(f"Friendship edges: {results['friendship_edges']}")
        """
    
    except Exception as e:
        print(f"Error: {str(e)}")
        
    finally:
        # Clean up
        scraper = get_scraper()
        scraper.close()
