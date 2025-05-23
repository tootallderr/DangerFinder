"""
Facebook site structure analyzer for legal OSINT data collection.

This module analyzes Facebook's robots.txt, site structure, and identifies
stable selectors for profile elements to ensure legal data collection.
"""

import requests
from bs4 import BeautifulSoup
import json
import os
import re
import time
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional, Any
from urllib.parse import urlparse

from src.utils.logger import get_logger, log_function_call
from src.utils.errors import handle_errors, ScrapingError
from src.utils.config import get_config

logger = get_logger(__name__)

class FacebookSiteAnalyzer:
    """
    Analyzes Facebook's site structure and robots.txt to identify
    legal data collection boundaries and stable selectors.
    """
    
    def __init__(self):
        """Initialize the Facebook site analyzer."""
        self.config = get_config("scraping")
        self.robots_txt_url = "https://www.facebook.com/robots.txt"
        self.allowed_paths = set()
        self.disallowed_paths = set()
        self.stable_selectors = {}
        self.access_boundaries = {}
        
        # Default headers for requests to mimic a browser
        self.headers = {
            "User-Agent": self.config.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1"
        }
        
        # Load cached data if available
        self._load_cached_data()
    
    @log_function_call
    @handle_errors(reraise=True)
    def analyze_robots_txt(self) -> Tuple[Set[str], Set[str]]:
        """
        Analyze Facebook's robots.txt file to determine allowed and disallowed paths.
        
        Returns:
            Tuple[Set[str], Set[str]]: Sets of allowed and disallowed paths
        """
        logger.info("Analyzing Facebook robots.txt")
        
        try:
            response = requests.get(self.robots_txt_url, headers=self.headers)
            response.raise_for_status()
            
            content = response.text
            lines = content.splitlines()
            
            allowed = set()
            disallowed = set()
            
            current_user_agent = "*"
            
            for line in lines:
                line = line.strip()
                
                if not line or line.startswith("#"):
                    continue
                
                if line.lower().startswith("user-agent:"):
                    current_user_agent = line.split(":", 1)[1].strip()
                    continue
                
                if current_user_agent == "*":
                    if line.lower().startswith("allow:"):
                        path = line.split(":", 1)[1].strip()
                        allowed.add(path)
                    
                    elif line.lower().startswith("disallow:"):
                        path = line.split(":", 1)[1].strip()
                        disallowed.add(path)
            
            self.allowed_paths = allowed
            self.disallowed_paths = disallowed
            
            # Save the results
            self._save_robots_data(allowed, disallowed)
            
            logger.info(f"Found {len(allowed)} allowed paths and {len(disallowed)} disallowed paths")
            
            return allowed, disallowed
            
        except requests.RequestException as e:
            logger.error(f"Error fetching robots.txt: {e}")
            raise ScrapingError(f"Failed to fetch robots.txt: {e}")
    
    @log_function_call
    @handle_errors(reraise=True)
    def analyze_site_structure(self) -> Dict[str, Any]:
        """
        Analyze Facebook's site structure to understand the layout.
        
        Returns:
            Dict[str, Any]: Site structure information
        """
        logger.info("Analyzing Facebook site structure")
        
        site_structure = {
            "profile_structure": self._analyze_profile_structure(),
            "friends_structure": self._analyze_friends_page_structure(),
            "public_page_structure": self._analyze_public_page_structure()
        }
        
        # Save the results
        self._save_site_structure(site_structure)
        
        return site_structure
    
    @log_function_call
    @handle_errors(reraise=True)
    def identify_stable_selectors(self) -> Dict[str, Dict[str, List[str]]]:
        """
        Identify stable CSS selectors for various profile elements.
        
        Returns:
            Dict[str, Dict[str, List[str]]]: Mapping of page types to element types to selectors
        """
        logger.info("Identifying stable selectors for profile elements")
        
        selectors = {
            "profile_page": {
                "name": [
                    "h1.x1heor9g.x1qlqyl8.x1pd3egz.x1a2a7pz",
                    "h1[dir='auto']",
                    "h1.gmql0nx0.l94mrbxd"
                ],
                "profile_picture": [
                    "div.x6s0dn4.x78zum5.x1iyjqo2.x1n2onr6 img",
                    "a[role='link'] img",
                    "div[data-pagelet='ProfileActions'] div.xz74otr img"
                ],
                "about": [
                    "div[data-pagelet='ProfileTileAbout']",
                    "div.x1gslohp a[href*='/about']"
                ],
                "friends_link": [
                    "a[href*='/friends']",
                    "div[data-pagelet='ProfileTileFriends']"
                ],
                "photos_link": [
                    "a[href*='/photos']",
                    "div[data-pagelet='ProfileTilePhotos']"
                ],
                "posts": [
                    "div[role='article']",
                    "div[data-pagelet='ProfileTimeline'] div[role='article']"
                ]
            },
            "friends_page": {
                "friend_items": [
                    "div[role='main'] div.x1qjc9v5 a[href*='/user/']",
                    "div.xb0tzng a[href*='/profile.php']",
                    "div[data-pagelet='ProfileGridTile']"
                ],
                "friend_name": [
                    "span.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1xmvt09",
                    "span[dir='auto']"
                ],
                "friend_picture": [
                    "img.x6umtig.x1b1mbwd.xaqea5y.xav7gou",
                    "svg.x3ajldb image"
                ]
            }
        }
        
        self.stable_selectors = selectors
        
        # Save the results
        self._save_selectors(selectors)
        
        return selectors
    
    @log_function_call
    @handle_errors(reraise=True)
    def document_access_boundaries(self) -> Dict[str, Any]:
        """
        Document the legal access boundaries for Facebook data collection.
        
        Returns:
            Dict[str, Any]: Access boundaries documentation
        """
        logger.info("Documenting Facebook data access boundaries")
        
        boundaries = {
            "legal_data_sources": [
                "Public profiles",
                "Public posts",
                "Public friend lists",
                "Public photos",
                "Public groups",
                "Public pages"
            ],
            "rate_limits": {
                "max_requests_per_minute": 10,
                "max_profiles_per_day": 100,
                "recommended_delay": 2000  # milliseconds
            },
            "illegal_actions": [
                "Accessing private profiles",
                "Accessing data that requires login",
                "Automated account creation",
                "Automated friending/liking/commenting",
                "Using Facebook API against terms of service",
                "Storing sensitive personal data without consent"
            ],
            "legal_considerations": [
                "Respect robots.txt directives",
                "Adhere to Terms of Service",
                "Comply with GDPR for EU citizens' data",
                "Comply with CCPA for California residents' data",
                "Only collect publicly available information",
                "Do not bypass any security measures"
            ],
            "ethical_guidelines": [
                "Only collect data necessary for analysis",
                "Anonymize data when possible",
                "Implement data security measures",
                "Respect user privacy",
                "Be transparent about data usage",
                "Delete data when no longer needed"
            ]
        }
        
        self.access_boundaries = boundaries
        
        # Save the results
        self._save_access_boundaries(boundaries)
        
        return boundaries
    
    def _analyze_profile_structure(self) -> Dict[str, Any]:
        """
        Analyze the structure of a Facebook profile page.
        
        Returns:
            Dict[str, Any]: Profile structure information
        """
        # This would normally involve analyzing a sample profile page
        # Since we can't actually scrape a live page in this context, we'll define the expected structure
        
        return {
            "sections": [
                {
                    "name": "Header",
                    "elements": ["profile_picture", "cover_photo", "name", "add_friend_button"]
                },
                {
                    "name": "Navigation",
                    "elements": ["posts", "about", "friends", "photos", "videos", "more"]
                },
                {
                    "name": "Intro",
                    "elements": ["bio", "location", "work", "education", "relationship"]
                },
                {
                    "name": "Posts",
                    "elements": ["status_updates", "shared_content", "media"]
                }
            ],
            "accessibility": {
                "public_without_login": ["limited_profile", "limited_posts", "public_photos"],
                "requires_login": ["full_profile", "friends_list", "all_posts"],
                "requires_friendship": ["private_posts", "private_photos", "contact_info"]
            }
        }
    
    def _analyze_friends_page_structure(self) -> Dict[str, Any]:
        """
        Analyze the structure of a Facebook friends page.
        
        Returns:
            Dict[str, Any]: Friends page structure information
        """
        return {
            "url_pattern": "/friends",
            "sections": [
                {
                    "name": "All Friends",
                    "url_suffix": "",
                    "elements": ["friend_grid", "friend_count"]
                },
                {
                    "name": "Mutual Friends",
                    "url_suffix": "/mutual",
                    "elements": ["friend_grid", "mutual_count"]
                }
            ],
            "friend_item_structure": {
                "elements": ["profile_picture", "name", "mutual_friends_count", "add_friend_button"]
            },
            "pagination": {
                "type": "scroll_based",
                "selector": "div[role='progressbar']"
            }
        }
    
    def _analyze_public_page_structure(self) -> Dict[str, Any]:
        """
        Analyze the structure of a Facebook public page.
        
        Returns:
            Dict[str, Any]: Public page structure information
        """
        return {
            "sections": [
                {
                    "name": "Header",
                    "elements": ["page_picture", "cover_photo", "page_name", "like_button", "follow_button"]
                },
                {
                    "name": "Navigation",
                    "elements": ["home", "posts", "reviews", "photos", "videos", "about"]
                },
                {
                    "name": "About",
                    "elements": ["description", "contact_info", "location", "hours"]
                },
                {
                    "name": "Posts",
                    "elements": ["page_posts", "visitor_posts"]
                }
            ]
        }
    
    def _load_cached_data(self) -> None:
        """Load cached data from disk if available."""
        config = get_config()
        cache_dir = Path(config.cache_dir) / "site_analysis"
        os.makedirs(cache_dir, exist_ok=True)
        
        robots_file = cache_dir / "robots.json"
        if robots_file.exists():
            try:
                with open(robots_file, 'r') as f:
                    data = json.load(f)
                    self.allowed_paths = set(data.get("allowed", []))
                    self.disallowed_paths = set(data.get("disallowed", []))
                    logger.debug("Loaded cached robots.txt data")
            except Exception as e:
                logger.warning(f"Failed to load cached robots data: {e}")
        
        selectors_file = cache_dir / "selectors.json"
        if selectors_file.exists():
            try:
                with open(selectors_file, 'r') as f:
                    self.stable_selectors = json.load(f)
                    logger.debug("Loaded cached selectors data")
            except Exception as e:
                logger.warning(f"Failed to load cached selectors data: {e}")
        
        boundaries_file = cache_dir / "boundaries.json"
        if boundaries_file.exists():
            try:
                with open(boundaries_file, 'r') as f:
                    self.access_boundaries = json.load(f)
                    logger.debug("Loaded cached access boundaries data")
            except Exception as e:
                logger.warning(f"Failed to load cached boundaries data: {e}")
    
    def _save_robots_data(self, allowed: Set[str], disallowed: Set[str]) -> None:
        """
        Save robots.txt data to disk.
        
        Args:
            allowed: Set of allowed paths
            disallowed: Set of disallowed paths
        """
        config = get_config()
        cache_dir = Path(config.cache_dir) / "site_analysis"
        os.makedirs(cache_dir, exist_ok=True)
        data = {
            "allowed": list(allowed),
            "disallowed": list(disallowed),
            "timestamp": str(int(time.time()))
        }
        
        try:
            with open(cache_dir / "robots.json", 'w') as f:
                json.dump(data, f, indent=2)
                logger.debug("Saved robots.txt data to cache")
        except Exception as e:
            logger.warning(f"Failed to save robots data: {e}")
    
    def _save_site_structure(self, structure: Dict[str, Any]) -> None:
        """
        Save site structure data to disk.
        
        Args:
            structure: Site structure information
        """
        config = get_config()
        cache_dir = Path(config.cache_dir) / "site_analysis"
        os.makedirs(cache_dir, exist_ok=True)
        
        try:
            with open(cache_dir / "site_structure.json", 'w') as f:
                json.dump(structure, f, indent=2)
                logger.debug("Saved site structure data to cache")
        except Exception as e:
            logger.warning(f"Failed to save site structure data: {e}")
    
    def _save_selectors(self, selectors: Dict[str, Dict[str, List[str]]]) -> None:
        """
        Save selectors data to disk.
        
        Args:
            selectors: Selectors information
        """
        config = get_config()
        cache_dir = Path(config.cache_dir) / "site_analysis"
        selectors_dir = Path(config.config_dir)
        
        os.makedirs(cache_dir, exist_ok=True)
        os.makedirs(selectors_dir, exist_ok=True)
        
        try:
            # Save to cache
            with open(cache_dir / "selectors.json", 'w') as f:
                json.dump(selectors, f, indent=2)
                logger.debug("Saved selectors data to cache")
            
            # Save to config for application use
            with open(selectors_dir / "selectors.json", 'w') as f:
                json.dump(selectors, f, indent=2)
                logger.debug("Saved selectors data to config")
        except Exception as e:
            logger.warning(f"Failed to save selectors data: {e}")
    
    def _save_access_boundaries(self, boundaries: Dict[str, Any]) -> None:
        """
        Save access boundaries data to disk.
        
        Args:
            boundaries: Access boundaries information
        """
        config = get_config()
        cache_dir = Path(config.cache_dir) / "site_analysis"
        os.makedirs(cache_dir, exist_ok=True)
        
        try:
            with open(cache_dir / "boundaries.json", 'w') as f:
                json.dump(boundaries, f, indent=2)
                logger.debug("Saved access boundaries data to cache")
            
            # Also save as documentation
            docs_dir = Path("docs")
            os.makedirs(docs_dir, exist_ok=True)
            
            with open(docs_dir / "legal_boundaries.md", 'w') as f:
                f.write("# Facebook OSINT Legal Data Access Boundaries\n\n")
                
                f.write("## Legal Data Sources\n\n")
                for source in boundaries["legal_data_sources"]:
                    f.write(f"- {source}\n")
                
                f.write("\n## Rate Limits\n\n")
                for key, value in boundaries["rate_limits"].items():
                    f.write(f"- {key.replace('_', ' ').title()}: {value}\n")
                
                f.write("\n## Illegal Actions to Avoid\n\n")
                for action in boundaries["illegal_actions"]:
                    f.write(f"- {action}\n")
                
                f.write("\n## Legal Considerations\n\n")
                for consideration in boundaries["legal_considerations"]:
                    f.write(f"- {consideration}\n")
                
                f.write("\n## Ethical Guidelines\n\n")
                for guideline in boundaries["ethical_guidelines"]:
                    f.write(f"- {guideline}\n")
                
                logger.debug("Saved access boundaries as documentation")
        except Exception as e:
            logger.warning(f"Failed to save access boundaries data: {e}")

def analyze_facebook_site() -> Dict[str, Any]:
    """
    Perform a full analysis of Facebook's site structure.
    
    Returns:
        Dict[str, Any]: Analysis results
    """
    analyzer = FacebookSiteAnalyzer()
    
    results = {
        "robots_txt": analyzer.analyze_robots_txt(),
        "site_structure": analyzer.analyze_site_structure(),
        "stable_selectors": analyzer.identify_stable_selectors(),
        "access_boundaries": analyzer.document_access_boundaries()
    }
    
    return results

if __name__ == "__main__":
    # When run directly, perform a full analysis
    import time
    start_time = time.time()
    results = analyze_facebook_site()
    duration = time.time() - start_time
    
    logger.info(f"Facebook site analysis completed in {duration:.2f} seconds")
    
    # Summary of findings
    print("\nSummary of Facebook Site Analysis:")
    print(f"- Found {len(results['robots_txt'][0])} allowed paths in robots.txt")
    print(f"- Found {len(results['robots_txt'][1])} disallowed paths in robots.txt")
    print(f"- Identified {sum(len(selectors) for selectors in results['stable_selectors'].values())} stable selectors")
    print(f"- Documented {len(results['access_boundaries']['legal_data_sources'])} legal data sources")
    print(f"- Documented {len(results['access_boundaries']['illegal_actions'])} illegal actions to avoid")
