"""
Facebook profile data extractor module.

This module provides functionality to extract public data from Facebook profiles.
"""

import os
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Any, Set, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import time
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin
import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

from src.utils.logger import get_logger, log_function_call
from src.utils.errors import handle_errors, ScrapingError, ParseError
from src.utils.config import get_config
from src.collectors.scraper import get_scraper

logger = get_logger(__name__)

@dataclass
class ProfileBasicInfo:
    """Basic information about a Facebook profile."""
    profile_id: str
    profile_url: str
    name: Optional[str] = None
    username: Optional[str] = None
    profile_picture: Optional[str] = None
    cover_photo: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    work: Optional[List[Dict[str, str]]] = None
    education: Optional[List[Dict[str, str]]] = None
    current_city: Optional[str] = None
    hometown: Optional[str] = None
    relationship_status: Optional[str] = None
    joined_date: Optional[str] = None
    last_update: str = None
    
    def __post_init__(self):
        if self.last_update is None:
            self.last_update = datetime.now().isoformat()
        if self.work is None:
            self.work = []
        if self.education is None:
            self.education = []


@dataclass
class ProfilePost:
    """Represents a post on a Facebook profile."""
    post_id: str
    profile_id: str
    content: Optional[str] = None
    post_date: Optional[str] = None
    post_url: Optional[str] = None
    media_urls: Optional[List[str]] = None
    reaction_count: Optional[int] = None
    comment_count: Optional[int] = None
    share_count: Optional[int] = None
    last_update: str = None
    
    def __post_init__(self):
        if self.last_update is None:
            self.last_update = datetime.now().isoformat()
        if self.media_urls is None:
            self.media_urls = []


class ProfileExtractor:
    """
    Extracts data from public Facebook profiles.
    """
    
    def __init__(self):
        """Initialize profile extractor."""
        self.config = get_config("scraping")
        self.scraper = get_scraper()
        self.browser = None
        self.profiles_cache = {}  # Cache for already extracted profiles
        self.posts_cache = {}  # Cache for extracted posts
    
    @log_function_call
    @handle_errors(reraise=True)
    def extract_profile(self, url: str) -> ProfileBasicInfo:
        """
        Extract basic profile information from a Facebook profile URL.
        
        Args:
            url: Profile URL
            
        Returns:
            ProfileBasicInfo object with extracted data
            
        Raises:
            ScrapingError: If profile extraction fails
        """
        # Normalize URL
        profile_url = self._normalize_profile_url(url)
        profile_id = self._extract_profile_id(profile_url)
        
        # Check cache first
        if profile_id in self.profiles_cache:
            logger.info(f"Using cached profile data for {profile_id}")
            return self.profiles_cache[profile_id]
        
        logger.info(f"Extracting profile data from {profile_url}")
        
        # Ensure browser is initialized
        self.browser = self.scraper.browser_manager.initialize_browser()
        
        try:
            # Navigate to profile
            self.scraper.browser_manager.navigate_to(profile_url)
            
            # Initialize profile data
            profile_data = ProfileBasicInfo(
                profile_id=profile_id,
                profile_url=profile_url
            )
            
            # Extract basic information
            profile_data.name = self._extract_name()
            profile_data.username = self._extract_username(profile_url)
            profile_data.profile_picture = self._extract_profile_picture()
            profile_data.cover_photo = self._extract_cover_photo()
            profile_data.bio = self._extract_bio()
            
            # Navigate to About section and extract more details
            self._navigate_to_about_section()
            profile_data = self._extract_about_section_data(profile_data)
            
            # Save to cache
            self.profiles_cache[profile_id] = profile_data
            self._save_profile_to_disk(profile_data)
            
            return profile_data
            
        except Exception as e:
            logger.error(f"Failed to extract profile data: {str(e)}")
            raise ScrapingError(f"Failed to extract profile data: {str(e)}")
    
    @log_function_call
    @handle_errors(reraise=True)
    def extract_posts(self, url: str, max_posts: int = 10) -> List[ProfilePost]:
        """
        Extract recent posts from a Facebook profile.
        
        Args:
            url: Profile URL
            max_posts: Maximum number of posts to extract
            
        Returns:
            List of ProfilePost objects with extracted data
            
        Raises:
            ScrapingError: If post extraction fails
        """
        # Normalize URL
        profile_url = self._normalize_profile_url(url)
        profile_id = self._extract_profile_id(profile_url)
        
        # Check cache first
        if profile_id in self.posts_cache:
            logger.info(f"Using cached posts for {profile_id}")
            return self.posts_cache[profile_id][:max_posts]
        
        logger.info(f"Extracting posts from {profile_url}")
        
        # Ensure browser is initialized
        self.browser = self.scraper.browser_manager.initialize_browser()
        
        try:
            # Navigate to profile
            self.scraper.browser_manager.navigate_to(profile_url)
            
            # Find post elements
            posts = []
            extracted_post_ids = set()
            scroll_attempts = 0
            max_scroll_attempts = 5
            
            while len(posts) < max_posts and scroll_attempts < max_scroll_attempts:
                # Find posts in current view
                post_elements = self.scraper.browser_manager.find_elements(
                    "div[role='article']"
                )
                
                # Process visible posts
                for post_element in post_elements:
                    # Extract post ID
                    try:
                        post_url = post_element.find_element(By.CSS_SELECTOR, "a[href*='/posts/']").get_attribute("href")
                        post_id = self._extract_post_id(post_url)
                        
                        # Skip if already processed
                        if post_id in extracted_post_ids:
                            continue
                        
                        # Extract post data
                        post = self._extract_post_data(post_element, post_id, profile_id)
                        posts.append(post)
                        extracted_post_ids.add(post_id)
                        
                        if len(posts) >= max_posts:
                            break
                    
                    except (NoSuchElementException, AttributeError) as e:
                        # Not all articles may be posts, some could be recommendations or ads
                        logger.debug(f"Skipping non-post article element: {str(e)}")
                        continue
                
                if len(posts) >= max_posts:
                    break
                
                # Scroll down to load more posts
                self.browser.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(2)  # Wait for content to load
                scroll_attempts += 1
            
            # Save to cache
            self.posts_cache[profile_id] = posts
            self._save_posts_to_disk(profile_id, posts)
            
            return posts
            
        except Exception as e:
            logger.error(f"Failed to extract posts: {str(e)}")
            raise ScrapingError(f"Failed to extract posts: {str(e)}")
    
    def _extract_name(self) -> Optional[str]:
        """Extract profile name."""
        try:
            # Try multiple selectors
            selectors = [
                "h1.x1heor9g.x1qlqyl8.x1pd3egz.x1a2a7pz",
                "h1[dir='auto']",
                "h1.gmql0nx0.l94mrbxd"
            ]
            
            for selector in selectors:
                element = self.scraper.browser_manager.find_element(selector, optional=True)
                if element:
                    return element.text.strip()
            
            # Fallback to page title
            title = self.browser.title
            if " | Facebook" in title:
                return title.split(" | Facebook")[0].strip()
            
            return None
                
        except Exception as e:
            logger.debug(f"Failed to extract name: {str(e)}")
            return None
    
    def _extract_username(self, url: str) -> Optional[str]:
        """Extract username from URL."""
        try:
            parsed = urlparse(url)
            path = parsed.path.strip("/")
            
            # Handle various URL formats
            if path and not path.startswith("profile.php"):
                if "/" in path:
                    return path.split("/")[0]
                return path
            
            return None
                
        except Exception as e:
            logger.debug(f"Failed to extract username: {str(e)}")
            return None
    
    def _extract_profile_picture(self) -> Optional[str]:
        """Extract profile picture URL."""
        try:
            # Try multiple selectors
            selectors = [
                "div.x6s0dn4.x78zum5.x1iyjqo2.x1n2onr6 img",
                "a[role='link'] img",
                "div[data-pagelet='ProfileActions'] div.xz74otr img"
            ]
            
            for selector in selectors:
                element = self.scraper.browser_manager.find_element(selector, optional=True)
                if element:
                    return element.get_attribute("src")
            
            return None
                
        except Exception as e:
            logger.debug(f"Failed to extract profile picture: {str(e)}")
            return None
    
    def _extract_cover_photo(self) -> Optional[str]:
        """Extract cover photo URL."""
        try:
            # Try multiple selectors
            selectors = [
                "div[data-pagelet='ProfileCoverPhoto'] img",
                "div[role='img'] img"
            ]
            
            for selector in selectors:
                element = self.scraper.browser_manager.find_element(selector, optional=True)
                if element:
                    return element.get_attribute("src")
            
            return None
                
        except Exception as e:
            logger.debug(f"Failed to extract cover photo: {str(e)}")
            return None
    
    def _extract_bio(self) -> Optional[str]:
        """Extract profile bio."""
        try:
            # Try multiple selectors
            selectors = [
                "div[data-pagelet='ProfileIntro'] span",
                "div.xieb3on div.xq8finb"
            ]
            
            for selector in selectors:
                elements = self.scraper.browser_manager.find_elements(selector)
                
                if elements and len(elements) > 0:
                    # The bio is usually a short paragraph
                    for element in elements:
                        text = element.text.strip()
                        # Look for a paragraph-like text (not too short, not too long)
                        if len(text) > 10 and len(text) < 200:
                            return text
            
            return None
                
        except Exception as e:
            logger.debug(f"Failed to extract bio: {str(e)}")
            return None
    
    def _navigate_to_about_section(self):
        """Navigate to the About section of the profile."""
        try:
            # Try multiple selectors for the About link
            selectors = [
                "a[href*='/about']",
                "div[data-pagelet='ProfileTabs'] a[role='link']"
            ]
            
            for selector in selectors:
                elements = self.scraper.browser_manager.find_elements(selector)
                
                for element in elements:
                    if "about" in element.get_attribute("href").lower() or "about" in element.text.lower():
                        element.click()
                        time.sleep(2)  # Wait for page to load
                        return True
            
            logger.debug("Could not find About section link")
            return False
                
        except Exception as e:
            logger.debug(f"Failed to navigate to About section: {str(e)}")
            return False
    
    def _extract_about_section_data(self, profile: ProfileBasicInfo) -> ProfileBasicInfo:
        """Extract data from the About section."""
        try:
            # Extract work information
            work_elements = self.scraper.browser_manager.find_elements(
                "div[data-pagelet='ProfileAppSection_0']"
            )
            
            for element in work_elements:
                if "Work" in element.text or "worked at" in element.text.lower():
                    work_items = element.find_elements(By.CSS_SELECTOR, "div[role='button']")
                    
                    for work_item in work_items:
                        work_text = work_item.text.strip()
                        if work_text and "Add a workplace" not in work_text:
                            profile.work.append({"description": work_text})
            
            # Extract education information
            edu_elements = self.scraper.browser_manager.find_elements(
                "div[data-pagelet='ProfileAppSection_1']"
            )
            
            for element in edu_elements:
                if "Education" in element.text or "studied at" in element.text.lower():
                    edu_items = element.find_elements(By.CSS_SELECTOR, "div[role='button']")
                    
                    for edu_item in edu_items:
                        edu_text = edu_item.text.strip()
                        if edu_text and "Add a school" not in edu_text:
                            profile.education.append({"description": edu_text})
            
            # Extract location information
            location_elements = self.scraper.browser_manager.find_elements(
                "div[data-pagelet='ProfileAppSection_2']"
            )
            
            for element in location_elements:
                if "Places lived" in element.text:
                    location_items = element.find_elements(By.CSS_SELECTOR, "div[role='button']")
                    
                    for location_item in location_items:
                        location_text = location_item.text.strip().lower()
                        
                        if "lives in" in location_text:
                            profile.current_city = location_text.replace("lives in", "").strip().title()
                        elif "from" in location_text:
                            profile.hometown = location_text.replace("from", "").strip().title()
            
            # Extract relationship status
            relationship_elements = self.scraper.browser_manager.find_elements(
                "div[data-pagelet='ProfileAppSection_3']"
            )
            
            for element in relationship_elements:
                if "Relationship" in element.text:
                    status_items = element.find_elements(By.CSS_SELECTOR, "span")
                    
                    for status_item in status_items:
                        status_text = status_item.text.strip()
                        if status_text in ["Single", "In a relationship", "Engaged", "Married", "It's complicated", 
                                          "In an open relationship", "Widowed", "Separated", "Divorced"]:
                            profile.relationship_status = status_text
            
            return profile
                
        except Exception as e:
            logger.debug(f"Failed to extract about section data: {str(e)}")
            return profile
    
    def _extract_post_data(self, post_element, post_id: str, profile_id: str) -> ProfilePost:
        """Extract data from a post element."""
        post = ProfilePost(
            post_id=post_id,
            profile_id=profile_id,
            post_url=f"https://www.facebook.com/permalink.php?id={profile_id}&story_fbid={post_id}"
        )
        
        try:
            # Extract post content
            content_elements = post_element.find_elements(By.CSS_SELECTOR, "div[data-ad-comet-preview='message']")
            if content_elements:
                post.content = content_elements[0].text.strip()
            
            # Extract post date
            date_elements = post_element.find_elements(By.CSS_SELECTOR, "a[href*='posts'] span")
            for date_element in date_elements:
                text = date_element.text.strip()
                if re.match(r"^(January|February|March|April|May|June|July|August|September|October|November|December|[0-9]+h|[0-9]+d|[0-9]+m|Yesterday|Today)", text):
                    post.post_date = text
                    break
            
            # Extract media (images/videos)
            media_elements = post_element.find_elements(By.CSS_SELECTOR, "img[src*='scontent'], video")
            media_urls = []
            
            for media in media_elements:
                if media.tag_name == "img":
                    image_url = media.get_attribute("src")
                    if image_url and "emoji" not in image_url and image_url not in media_urls:
                        media_urls.append(image_url)
                elif media.tag_name == "video":
                    video_url = media.get_attribute("src")
                    if video_url and video_url not in media_urls:
                        media_urls.append(video_url)
            
            post.media_urls = media_urls
            
            # Extract reactions, comments, shares counts
            count_elements = post_element.find_elements(By.CSS_SELECTOR, "span[dir='auto']")
            
            for i, count_element in enumerate(count_elements):
                text = count_element.text.strip()
                
                # Look for numbers followed by reactions/comments/shares
                if re.match(r"^[0-9,]+$", text) or "K" in text or "M" in text:
                    value = self._parse_count(text)
                    
                    # Try to determine what this count represents based on following element
                    if i + 1 < len(count_elements):
                        next_text = count_elements[i + 1].text.lower()
                        
                        if "comment" in next_text:
                            post.comment_count = value
                        elif "share" in next_text:
                            post.share_count = value
                        else:
                            # Assume reactions if not specified
                            post.reaction_count = value
            
            return post
                
        except Exception as e:
            logger.debug(f"Error extracting post data: {str(e)}")
            return post
    
    def _normalize_profile_url(self, url: str) -> str:
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
        """Extract profile ID from URL or page source."""
        # Check URL for profile ID
        parsed = urlparse(url)
        
        if "profile.php" in parsed.path:
            # Extract from profile.php?id=12345 format
            query = parsed.query
            query_params = dict(param.split('=') for param in query.split('&') if '=' in param)
            if "id" in query_params:
                return query_params["id"]
        
        # If not found, use the username as ID
        path = parsed.path.strip("/")
        if "/" in path:
            return path.split("/")[0]
        return path
    
    def _extract_post_id(self, url: str) -> str:
        """Extract post ID from post URL."""
        # Handle different post URL formats
        if "story_fbid=" in url:
            return url.split("story_fbid=")[1].split("&")[0]
        elif "/posts/" in url:
            return url.split("/posts/")[1].split("?")[0].split("/")[0]
        elif "/permalink.php" in url:
            parsed = urlparse(url)
            query_params = dict(param.split('=') for param in parsed.query.split('&') if '=' in param)
            return query_params.get("story_fbid", "unknown")
        
        # Fallback: use the entire URL hash
        import hashlib
        return hashlib.md5(url.encode()).hexdigest()
    
    def _parse_count(self, count_text: str) -> int:
        """Parse count text to integer."""
        try:
            # Remove commas
            count_text = count_text.replace(',', '')
            
            # Handle K (thousands)
            if 'K' in count_text:
                value = float(count_text.replace('K', '')) * 1000
                return int(value)
                
            # Handle M (millions)
            if 'M' in count_text:
                value = float(count_text.replace('M', '')) * 1000000
                return int(value)
                
            return int(count_text)
            
        except ValueError:
            return 0
    
    def _save_profile_to_disk(self, profile: ProfileBasicInfo):
        """Save profile data to disk."""
        config = get_config()
        profiles_dir = Path(config.data_dir) / "profiles"
        profiles_dir.mkdir(exist_ok=True)
        
        try:
            with open(profiles_dir / f"{profile.profile_id}.json", 'w') as f:
                json.dump(asdict(profile), f, indent=2)
            logger.debug(f"Saved profile {profile.profile_id} to disk")
        except Exception as e:
            logger.warning(f"Failed to save profile to disk: {e}")
    
    def _save_posts_to_disk(self, profile_id: str, posts: List[ProfilePost]):
        """Save posts data to disk."""
        if not posts:
            return
            
        config = get_config()
        posts_dir = Path(config.data_dir) / "posts" / profile_id
        posts_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            posts_data = [asdict(post) for post in posts]
            
            with open(posts_dir / "posts.json", 'w') as f:
                json.dump(posts_data, f, indent=2)
            logger.debug(f"Saved {len(posts)} posts for profile {profile_id} to disk")
        except Exception as e:
            logger.warning(f"Failed to save posts to disk: {e}")


# Singleton instance
_extractor_instance = None

def get_profile_extractor() -> ProfileExtractor:
    """
    Get the singleton profile extractor instance.
    
    Returns:
        ProfileExtractor: The profile extractor instance
    """
    global _extractor_instance
    if _extractor_instance is None:
        _extractor_instance = ProfileExtractor()
    
    return _extractor_instance


if __name__ == "__main__":
    # Test profile extraction
    extractor = get_profile_extractor()
    
    # Example URL (replace with a test URL)
    test_url = "https://www.facebook.com/zuck"
    
    try:
        profile = extractor.extract_profile(test_url)
        print(f"Extracted profile for {profile.name}")
        print(f"Username: {profile.username}")
        print(f"Bio: {profile.bio}")
        
        posts = extractor.extract_posts(test_url, max_posts=5)
        print(f"Extracted {len(posts)} posts")
        
        for i, post in enumerate(posts):
            print(f"\nPost {i+1}:")
            print(f"Content: {post.content[:100]}..." if post.content else "No content")
            print(f"Date: {post.post_date}")
            print(f"Media: {len(post.media_urls)} items")
    
    except Exception as e:
        print(f"Error: {str(e)}")
        
    finally:
        # Clean up
        scraper = get_scraper()
        scraper.close()
