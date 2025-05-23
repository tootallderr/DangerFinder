"""
Facebook DOM structure analyzer.

This script analyzes a Facebook profile page DOM structure to identify
stable selectors for various UI elements.
"""

import argparse
import json
import sys
import os
from pathlib import Path
import time
import re
from typing import Dict, List, Any, Set, Tuple, Optional
from urllib.parse import urlparse
import random
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from src.utils.logger import setup_logger, get_logger
from src.utils.config import get_config
from src.utils.errors import handle_errors, ScrapingError
from src.collectors.scraper import get_scraper

logger = get_logger(__name__)

class DOMAnalyzer:
    """
    Analyzes DOM structure to identify stable selectors.
    """
    
    def __init__(self):
        """Initialize DOM analyzer."""
        self.scraper = get_scraper()
        self.browser = None
        self.selectors = {}
        
    @handle_errors(reraise=True)
    def analyze_dom(self, url: str) -> Dict[str, Any]:
        """
        Analyze the DOM structure of a Facebook page.
        
        Args:
            url: URL of the Facebook page to analyze
            
        Returns:
            Dictionary with analysis results
        """
        logger.info(f"Analyzing DOM structure of {url}")
        
        # Normalize URL
        parsed_url = urlparse(url)
        if parsed_url.netloc not in ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com"]:
            raise ValueError("Invalid Facebook URL")
        
        # Initialize browser
        self.browser = self.scraper.browser_manager.initialize_browser()
        
        # Navigate to the URL
        self.scraper.browser_manager.navigate_to(url)
        
        # Wait for content to load fully
        time.sleep(5)
        
        # Get page type
        page_type = self._determine_page_type(url)
        
        # Get page source
        page_source = self.browser.page_source
        
        # Parse with BeautifulSoup
        soup = BeautifulSoup(page_source, 'html.parser')
        
        # Analyze DOM structure
        analysis = {
            "url": url,
            "page_type": page_type,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "elements": self._analyze_elements(soup, page_type),
            "possible_selectors": self._generate_selectors(soup, page_type)
        }
        
        return analysis
    
    def _determine_page_type(self, url: str) -> str:
        """
        Determine the type of Facebook page (profile, group, page, etc.).
        
        Args:
            url: Facebook URL
            
        Returns:
            Page type as string
        """
        # Check URL path
        parsed = urlparse(url)
        path = parsed.path.lower().strip("/")
        
        if "groups" in path:
            return "group_page"
        elif any(segment in path for segment in ["pages", "pg"]):
            return "facebook_page"
        elif "friends" in path:
            return "friends_page"
        elif "photos" in path:
            return "photos_page"
        elif "videos" in path:
            return "videos_page"
        elif "about" in path:
            return "about_page"
        else:
            # Default to profile page
            return "profile_page"
    
    def _analyze_elements(self, soup: BeautifulSoup, page_type: str) -> Dict[str, Any]:
        """
        Analyze important elements on the page.
        
        Args:
            soup: BeautifulSoup object
            page_type: Type of page
            
        Returns:
            Dictionary of element analysis
        """
        elements = {}
        
        # Common elements to look for based on page type
        if page_type == "profile_page":
            elements.update({
                "name": self._find_profile_name(soup),
                "profile_picture": self._find_profile_picture(soup),
                "cover_photo": self._find_cover_photo(soup),
                "nav_items": self._find_navigation_items(soup),
                "posts": self._find_posts(soup),
                "intro_section": self._find_intro_section(soup)
            })
        elif page_type == "friends_page":
            elements.update({
                "friends_count": self._find_friends_count(soup),
                "friend_items": self._find_friend_items(soup)
            })
        elif page_type == "facebook_page":
            elements.update({
                "page_name": self._find_page_name(soup),
                "page_category": self._find_page_category(soup),
                "page_likes": self._find_page_likes(soup),
                "page_posts": self._find_posts(soup)
            })
        
        return elements
    
    def _find_profile_name(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze profile name element."""
        # Look for h1 elements that might contain the name
        h1_elements = soup.find_all('h1')
        candidates = []
        
        for h1 in h1_elements:
            # Filter out empty or very long text
            text = h1.get_text(strip=True)
            if text and len(text) < 100:
                candidates.append({
                    "element": "h1",
                    "text": text,
                    "classes": h1.get('class', []),
                    "id": h1.get('id', ''),
                    "attributes": {k: v for k, v in h1.attrs.items() if k not in ['class', 'id']},
                    "path": self._get_css_path(h1)
                })
        
        return {
            "candidates": candidates,
            "count": len(candidates),
            "most_likely": candidates[0] if candidates else None
        }
    
    def _find_profile_picture(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze profile picture element."""
        # Look for images that might be profile pictures
        img_elements = soup.find_all('img')
        candidates = []
        
        for img in img_elements:
            src = img.get('src', '')
            
            # Filter image sources that look like profile pictures
            if src and ('profile' in src.lower() or 'avatar' in src.lower() or 
                       'photo' in src.lower() or 'picture' in src.lower() or
                       'scontent' in src.lower()):
                
                candidates.append({
                    "element": "img",
                    "src": src,
                    "alt": img.get('alt', ''),
                    "classes": img.get('class', []),
                    "id": img.get('id', ''),
                    "attributes": {k: v for k, v in img.attrs.items() if k not in ['class', 'id', 'src', 'alt']},
                    "path": self._get_css_path(img)
                })
        
        # Sort by certain heuristics (e.g., presence of 'profile' in src)
        candidates.sort(key=lambda x: ('profile' in x['src'].lower(), x['alt'] != ''), reverse=True)
        
        return {
            "candidates": candidates[:5],  # Limit to top 5
            "count": len(candidates),
            "most_likely": candidates[0] if candidates else None
        }
    
    def _find_cover_photo(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze cover photo element."""
        # Look for large images at the top of the page
        img_elements = soup.find_all('img')
        candidates = []
        
        for img in img_elements:
            src = img.get('src', '')
            
            # Filter for cover photos
            if src and ('cover' in src.lower() or 'header' in src.lower()):
                candidates.append({
                    "element": "img",
                    "src": src,
                    "classes": img.get('class', []),
                    "id": img.get('id', ''),
                    "path": self._get_css_path(img)
                })
        
        return {
            "candidates": candidates,
            "count": len(candidates),
            "most_likely": candidates[0] if candidates else None
        }
    
    def _find_navigation_items(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze navigation elements."""
        # Look for a elements that might be navigation items
        nav_items = []
        
        # These are common navigation item texts on Facebook profiles
        nav_keywords = ["Posts", "About", "Photos", "Videos", "Friends", "Check-ins"]
        
        for a in soup.find_all('a'):
            text = a.get_text(strip=True)
            href = a.get('href', '')
            
            # Check if the text matches any of the nav keywords
            if any(keyword.lower() in text.lower() for keyword in nav_keywords) or \
               any(keyword.lower() in href.lower() for keyword in nav_keywords):
                
                nav_items.append({
                    "element": "a",
                    "text": text,
                    "href": href,
                    "classes": a.get('class', []),
                    "path": self._get_css_path(a)
                })
        
        return {
            "items": nav_items,
            "count": len(nav_items)
        }
    
    def _find_posts(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze post elements."""
        # Posts are typically in article elements or divs with role=article
        post_elements = soup.find_all('div', attrs={'role': 'article'})
        if not post_elements:
            post_elements = soup.find_all('article')
        
        posts = []
        
        for post in post_elements[:5]:  # Limit to 5 posts for analysis
            # Find post content
            content_text = ""
            content_elements = post.find_all('div', attrs={'data-ad-comet-preview': 'message'})
            if content_elements:
                content_text = content_elements[0].get_text(strip=True)
            
            # Find post date
            date_text = ""
            for span in post.find_all('span'):
                text = span.get_text(strip=True)
                if re.match(r"^(January|February|March|April|May|June|July|August|September|October|November|December|[0-9]+h|[0-9]+d|[0-9]+m|Yesterday|Today)", text):
                    date_text = text
                    break
            
            posts.append({
                "element_type": post.name,
                "classes": post.get('class', []),
                "content_preview": content_text[:100] + "..." if len(content_text) > 100 else content_text,
                "date": date_text,
                "path": self._get_css_path(post)
            })
        
        return {
            "items": posts,
            "count": len(post_elements)
        }
    
    def _find_intro_section(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze profile intro section."""
        # Look for common intro section elements
        intro_items = []
        
        # Common intro keywords
        intro_keywords = ["Lives in", "From", "Studied at", "Works at", "Relationship", "Joined"]
        
        for div in soup.find_all(['div', 'span']):
            text = div.get_text(strip=True)
            
            if text and any(keyword.lower() in text.lower() for keyword in intro_keywords):
                intro_items.append({
                    "element_type": div.name,
                    "text": text,
                    "classes": div.get('class', []),
                    "path": self._get_css_path(div)
                })
        
        return {
            "items": intro_items,
            "count": len(intro_items)
        }
    
    def _find_friends_count(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze friends count element."""
        count_candidates = []
        
        # Look for elements that might contain friend counts
        for element in soup.find_all(['h1', 'h2', 'div', 'span']):
            text = element.get_text(strip=True)
            
            # Look for patterns like "123 Friends", "Friends (456)", etc.
            if re.search(r'(\d+) friends', text.lower()) or re.search(r'friends \((\d+)\)', text.lower()):
                count_candidates.append({
                    "element_type": element.name,
                    "text": text,
                    "classes": element.get('class', []),
                    "path": self._get_css_path(element)
                })
        
        return {
            "candidates": count_candidates,
            "count": len(count_candidates),
            "most_likely": count_candidates[0] if count_candidates else None
        }
    
    def _find_friend_items(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze friend list items."""
        friend_items = []
        
        # First, try to find a container that might hold friend items
        container = None
        for div in soup.find_all('div', attrs={'role': 'main'}):
            if div.find_all('a'):
                container = div
                break
        
        if not container:
            container = soup
        
        # Look for links that might be friend items
        for a in container.find_all('a'):
            href = a.get('href', '')
            
            # Filter links that look like they lead to profiles
            if href and ('profile.php' in href or '/user/' in href or 
                        (not any(keyword in href for keyword in ['facebook.com', '/pages/', '/groups/', '/hashtag/']))):
                
                # Try to find name and image
                name = a.get_text(strip=True)
                img = a.find('img')
                img_src = img.get('src', '') if img else ''
                
                if name or img_src:
                    friend_items.append({
                        "element": "a",
                        "href": href,
                        "name": name,
                        "img_src": img_src,
                        "classes": a.get('class', []),
                        "path": self._get_css_path(a)
                    })
        
        return {
            "items": friend_items[:10],  # Limit to 10 friends for analysis
            "count": len(friend_items)
        }
    
    def _find_page_name(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze page name element."""
        # Similar to profile name but for pages
        return self._find_profile_name(soup)
    
    def _find_page_category(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze page category element."""
        category_candidates = []
        
        for element in soup.find_all(['div', 'span']):
            text = element.get_text(strip=True)
            
            # Categories are typically short, don't contain many spaces, and appear near the top
            if text and len(text) < 50 and text.count(' ') <= 3 and not any(c.isdigit() for c in text):
                parent = element.parent
                if parent and parent.name == 'div':
                    category_candidates.append({
                        "element_type": element.name,
                        "text": text,
                        "classes": element.get('class', []),
                        "path": self._get_css_path(element)
                    })
        
        return {
            "candidates": category_candidates[:5],
            "count": len(category_candidates),
            "most_likely": category_candidates[0] if category_candidates else None
        }
    
    def _find_page_likes(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Find and analyze page likes count element."""
        likes_candidates = []
        
        for element in soup.find_all(['div', 'span']):
            text = element.get_text(strip=True)
            
            # Look for patterns like "123 likes", "456 people follow this", etc.
            if re.search(r'(\d+)[\s,]*likes', text.lower()) or re.search(r'(\d+)[\s,]*people like this', text.lower()):
                likes_candidates.append({
                    "element_type": element.name,
                    "text": text,
                    "classes": element.get('class', []),
                    "path": self._get_css_path(element)
                })
        
        return {
            "candidates": likes_candidates,
            "count": len(likes_candidates),
            "most_likely": likes_candidates[0] if likes_candidates else None
        }
    
    def _get_css_path(self, element) -> str:
        """
        Generate a CSS path for the element.
        
        Args:
            element: BeautifulSoup element
            
        Returns:
            CSS selector path
        """
        path_parts = []
        current = element
        
        for _ in range(6):  # Limit path depth
            if not current or current.name == '[document]':
                break
            
            selector = current.name
            
            # Add classes (but avoid using too many)
            classes = current.get('class', [])
            if classes and len(classes) <= 2:
                selector += '.' + '.'.join(classes)
            
            # Add id if available
            if current.get('id'):
                selector += f'#{current["id"]}'
            
            # Add to path
            path_parts.append(selector)
            
            # Move to parent
            current = current.parent
        
        # Reverse path and join
        return ' > '.join(reversed(path_parts[-3:]))  # Keep only last 3 parts
    
    def _generate_selectors(self, soup: BeautifulSoup, page_type: str) -> Dict[str, List[str]]:
        """
        Generate potential CSS selectors for important page elements.
        
        Args:
            soup: BeautifulSoup object
            page_type: Type of page
            
        Returns:
            Dictionary of element types to potential selectors
        """
        selectors = {}
        
        if page_type == "profile_page":
            selectors.update({
                "name": self._generate_element_selectors(self._find_profile_name(soup)),
                "profile_picture": self._generate_element_selectors(self._find_profile_picture(soup), "img"),
                "posts": self._generate_element_selectors({"items": self._find_posts(soup).get("items", [])}, "div[role='article']")
            })
        elif page_type == "friends_page":
            selectors.update({
                "friend_items": self._generate_element_selectors({"items": self._find_friend_items(soup).get("items", [])}, "a")
            })
        
        return selectors
    
    def _generate_element_selectors(self, element_data: Dict[str, Any], fallback_selector: str = None) -> List[str]:
        """
        Generate CSS selectors for an element type based on analysis data.
        
        Args:
            element_data: Element analysis data
            fallback_selector: Fallback selector to use if no good candidates
            
        Returns:
            List of potential CSS selectors
        """
        selectors = []
        
        # Handle different data structures
        if "candidates" in element_data and element_data["candidates"]:
            candidates = element_data["candidates"]
            
            for candidate in candidates:
                # Add path-based selector
                if "path" in candidate:
                    selectors.append(candidate["path"])
                
                # Add class-based selector if available
                if "classes" in candidate and candidate["classes"]:
                    element_type = candidate.get("element", candidate.get("element_type", "div"))
                    for cls in candidate["classes"]:
                        selectors.append(f"{element_type}.{cls}")
                    
                    # Add selector with multiple classes (if available)
                    if len(candidate["classes"]) >= 2:
                        classes_selector = '.'.join(candidate["classes"])
                        selectors.append(f"{element_type}.{classes_selector}")
                
                # Add id-based selector if available
                if "id" in candidate and candidate["id"]:
                    element_type = candidate.get("element", candidate.get("element_type", "div"))
                    selectors.append(f"{element_type}#{candidate['id']}")
        
        # Handle items list
        elif "items" in element_data and element_data["items"]:
            items = element_data["items"]
            
            for item in items:
                # Add path-based selector
                if "path" in item:
                    selectors.append(item["path"])
                
                # Add class-based selector if available
                if "classes" in item and item["classes"]:
                    element_type = item.get("element", item.get("element_type", "div"))
                    
                    # For items, we look for common class patterns
                    class_patterns = {}
                    for cls in item["classes"]:
                        if cls not in class_patterns:
                            class_patterns[cls] = 0
                        class_patterns[cls] += 1
                    
                    # Add most common class patterns
                    for cls, count in sorted(class_patterns.items(), key=lambda x: x[1], reverse=True)[:2]:
                        selectors.append(f"{element_type}.{cls}")
        
        # Add fallback selector if provided and no other selectors found
        if not selectors and fallback_selector:
            selectors.append(fallback_selector)
        
        # Remove duplicates while preserving order
        unique_selectors = []
        for selector in selectors:
            if selector not in unique_selectors:
                unique_selectors.append(selector)
        
        return unique_selectors[:5]  # Limit to 5 selectors
    
    def save_analysis(self, analysis: Dict[str, Any], output_file: str) -> None:
        """
        Save analysis results to a file.
        
        Args:
            analysis: Analysis results
            output_file: Output file path
        """
        # Make sure output directory exists
        output_path = Path(output_file)
        output_path.parent.mkdir(exist_ok=True, parents=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(analysis, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Analysis saved to {output_file}")
    
    def extract_selectors(self, analysis: Dict[str, Any]) -> Dict[str, Dict[str, List[str]]]:
        """
        Extract selectors from analysis results.
        
        Args:
            analysis: Analysis results
            
        Returns:
            Dictionary of page types to element types to selectors
        """
        selectors = {}
        page_type = analysis["page_type"]
        
        if "possible_selectors" in analysis:
            selectors[page_type] = analysis["possible_selectors"]
        
        return selectors
    
    def close(self) -> None:
        """Close browser and clean up."""
        self.scraper.close()


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Analyze Facebook DOM structure")
    parser.add_argument(
        "--url",
        type=str,
        required=True,
        help="Facebook URL to analyze"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="data/dom_analysis.json",
        help="Output file path"
    )
    return parser.parse_args()


def main():
    """Main function."""
    # Set up logging
    setup_logger()
    
    # Parse arguments
    args = parse_arguments()
    
    try:
        # Initialize analyzer
        analyzer = DOMAnalyzer()
        
        # Analyze DOM
        analysis = analyzer.analyze_dom(args.url)
        
        # Save results
        analyzer.save_analysis(analysis, args.output)
        
        # Extract selectors
        selectors = analyzer.extract_selectors(analysis)
        
        # Save selectors to config directory
        selectors_file = Path("config") / "selectors.json"
        
        # If selectors file exists, merge with existing selectors
        if selectors_file.exists():
            try:
                with open(selectors_file, 'r') as f:
                    existing_selectors = json.load(f)
                
                # Merge selectors
                for page_type, elements in selectors.items():
                    if page_type not in existing_selectors:
                        existing_selectors[page_type] = {}
                    
                    for element_type, element_selectors in elements.items():
                        existing_selectors[page_type][element_type] = element_selectors
                
                selectors = existing_selectors
            except (json.JSONDecodeError, FileNotFoundError):
                pass
        
        # Save selectors
        with open(selectors_file, 'w') as f:
            json.dump(selectors, f, indent=2)
        
        logger.info(f"Selectors saved to {selectors_file}")
        
        # Print summary
        print("\nDOM Analysis Summary")
        print("==================\n")
        print(f"URL: {analysis['url']}")
        print(f"Page Type: {analysis['page_type']}")
        print(f"Timestamp: {analysis['timestamp']}")
        
        for page_type, elements in selectors.items():
            print(f"\n{page_type.upper()}:")
            for element_type, element_selectors in elements.items():
                print(f"  {element_type}: {len(element_selectors)} selectors")
        
    except Exception as e:
        logger.error(f"Error analyzing DOM: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        sys.exit(1)
        
    finally:
        # Clean up
        if 'analyzer' in locals():
            analyzer.close()


if __name__ == "__main__":
    main()
