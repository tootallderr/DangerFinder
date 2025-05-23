"""
Core scraping engine for Facebook data collection.

This module provides the core functionality for legally scraping public
Facebook data with rate limiting, session handling, and proxy rotation.
"""

import os
import time
import random
import json
from pathlib import Path
from typing import Dict, List, Optional, Any, Union, Set, Tuple
import requests
from urllib.parse import urlparse, urljoin
from datetime import datetime
import logging
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException, NoSuchElementException, WebDriverException
)
from webdriver_manager.chrome import ChromeDriverManager

from src.utils.logger import get_logger, log_function_call
from src.utils.errors import handle_errors, ScrapingError, NetworkError, ParseError
from src.utils.config import get_config

logger = get_logger(__name__)

class RequestManager:
    """
    Handles HTTP requests with rate limiting and retry functionality.
    """
    
    def __init__(self, config=None):
        """
        Initialize the request manager.
        
        Args:
            config: Configuration object (optional)
        """
        self.config = config or get_config("scraping")
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": self.config.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1"
        })
        self.last_request_time = 0
        self.request_count = 0
        self._load_request_history()
    
    @log_function_call
    @handle_errors(reraise=True)
    def get(self, url: str, params: Optional[Dict[str, Any]] = None, 
            retry: bool = True, **kwargs) -> requests.Response:
        """
        Perform a rate-limited GET request with retry functionality.
        
        Args:
            url: URL to request
            params: Query parameters
            retry: Whether to retry on failure
            **kwargs: Additional arguments to pass to requests.get
            
        Returns:
            requests.Response object
            
        Raises:
            NetworkError: If all retries fail
        """
        self._respect_rate_limit()
        
        max_retries = self.config.max_retries if retry else 0
        timeout = kwargs.pop("timeout", self.config.timeout)
        
        for attempt in range(max_retries + 1):
            try:
                logger.debug(f"Making GET request to {url} (Attempt {attempt+1}/{max_retries+1})")
                response = self.session.get(url, params=params, timeout=timeout, **kwargs)
                response.raise_for_status()
                
                self._record_request(url, response.status_code)
                return response
            
            except (requests.RequestException, ConnectionError) as e:
                if attempt >= max_retries:
                    logger.error(f"Failed to fetch {url} after {max_retries + 1} attempts: {str(e)}")
                    raise NetworkError(f"Failed to fetch {url}: {str(e)}")
                
                wait_time = 2 ** attempt * self.config.request_delay
                logger.warning(f"Request failed, retrying in {wait_time:.1f}s: {str(e)}")
                time.sleep(wait_time)
    
    def _respect_rate_limit(self):
        """Ensure rate limits are respected."""
        current_time = time.time()
        elapsed = current_time - self.last_request_time
        
        if elapsed < self.config.request_delay:
            wait_time = self.config.request_delay - elapsed
            # Add some randomization to appear more human-like
            wait_time += random.uniform(0.1, 1.0)
            logger.debug(f"Rate limiting: waiting {wait_time:.2f}s before next request")
            time.sleep(wait_time)
        
        self.last_request_time = time.time()
    
    def _record_request(self, url: str, status_code: int):
        """Record request history for analysis."""
        self.request_count += 1
        
        # Save every 50 requests to avoid excessive disk I/O
        if self.request_count % 50 == 0:
            self._save_request_history()
    
    def _load_request_history(self):
        """Load request history from disk."""
        config = get_config()
        history_file = Path(config.data_dir) / "request_history.json"
        
        if history_file.exists():
            try:
                with open(history_file, 'r') as f:
                    data = json.load(f)
                    self.request_count = data.get("total_requests", 0)
                    logger.debug(f"Loaded request history, total requests: {self.request_count}")
            except Exception as e:
                logger.warning(f"Failed to load request history: {e}")
                self.request_count = 0
    
    def _save_request_history(self):
        """Save request history to disk."""
        config = get_config()
        history_dir = Path(config.data_dir)
        history_dir.mkdir(exist_ok=True)
        
        try:
            history_data = {
                "total_requests": self.request_count,
                "last_update": datetime.now().isoformat()
            }
            
            with open(history_dir / "request_history.json", 'w') as f:
                json.dump(history_data, f)
        except Exception as e:
            logger.warning(f"Failed to save request history: {e}")
    
    def close(self):
        """Close the session and clean up resources."""
        self.session.close()
        self._save_request_history()


class BrowserManager:
    """
    Manages browser instances for automated browsing with fingerprint randomization.
    """
    
    def __init__(self, config=None):
        """
        Initialize the browser manager.
        
        Args:
            config: Configuration object (optional)
        """
        self.config = config or get_config("scraping")
        self.browser = None
        self.cookies = {}
        self.user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0"
        ]
        self._load_cookies()
    
    @log_function_call
    @handle_errors(reraise=True)
    def initialize_browser(self) -> webdriver.Chrome:
        """
        Initialize a Chrome browser instance with randomized fingerprint.
        
        Returns:
            webdriver.Chrome: Browser instance
        """
        if self.browser:
            return self.browser
        
        try:
            options = Options()
            
            if self.config.headless:
                options.add_argument("--headless=new")
            
            # Randomize browser fingerprint
            user_agent = random.choice(self.user_agents)
            options.add_argument(f"--user-agent={user_agent}")
            
            # Other common options to avoid detection
            options.add_argument("--disable-blink-features=AutomationControlled")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_experimental_option("excludeSwitches", ["enable-automation"])
            options.add_experimental_option("useAutomationExtension", False)
            
            # Screen resolution randomization
            resolutions = ["1920,1080", "1366,768", "1440,900", "1536,864"]
            resolution = random.choice(resolutions)
            options.add_argument(f"--window-size={resolution}")
            
            service = Service(ChromeDriverManager().install())
            self.browser = webdriver.Chrome(service=service, options=options)
            
            # Execute JavaScript to hide WebDriver
            self.browser.execute_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            
            # Set cookies if available
            if self.cookies:
                logger.debug("Loading saved cookies")
                self.browser.get("https://www.facebook.com")
                for cookie in self.cookies.values():
                    self.browser.add_cookie(cookie)
            
            logger.info(f"Browser initialized with user agent: {user_agent[:30]}...")
            return self.browser
            
        except WebDriverException as e:
            logger.error(f"Failed to initialize browser: {str(e)}")
            raise ScrapingError(f"Failed to initialize browser: {str(e)}")
    
    @log_function_call
    @handle_errors(reraise=True)
    def navigate_to(self, url: str, wait_time: int = 5) -> bool:
        """
        Navigate browser to URL and wait for page to load.
        
        Args:
            url: URL to navigate to
            wait_time: Time to wait for page to load in seconds
            
        Returns:
            bool: True if navigation was successful
            
        Raises:
            NetworkError: If navigation fails
        """
        if not self.browser:
            self.initialize_browser()
        
        try:
            logger.debug(f"Navigating to {url}")
            self.browser.get(url)
            
            # Wait for page to load
            WebDriverWait(self.browser, wait_time).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            
            # Save cookies
            self._update_cookies()
            
            return True
            
        except (WebDriverException, TimeoutException) as e:
            logger.error(f"Failed to navigate to {url}: {str(e)}")
            raise NetworkError(f"Failed to navigate to {url}: {str(e)}")
    
    def find_element(self, selector: str, by: By = By.CSS_SELECTOR, 
                    wait_time: int = 10, optional: bool = False):
        """
        Find an element on the page using a selector.
        
        Args:
            selector: CSS selector or XPath
            by: Selector type (CSS_SELECTOR, XPATH, etc.)
            wait_time: Time to wait for element in seconds
            optional: If True, return None if element not found, else raise exception
            
        Returns:
            WebElement or None
            
        Raises:
            ParseError: If element not found and optional=False
        """
        if not self.browser:
            raise ScrapingError("Browser not initialized")
        
        try:
            element = WebDriverWait(self.browser, wait_time).until(
                EC.presence_of_element_located((by, selector))
            )
            return element
        except (TimeoutException, NoSuchElementException) as e:
            if optional:
                return None
            logger.error(f"Element not found with selector: {selector}")
            raise ParseError(f"Element not found with selector: {selector}")
    
    def find_elements(self, selector: str, by: By = By.CSS_SELECTOR, 
                     wait_time: int = 10) -> List:
        """
        Find all elements on the page using a selector.
        
        Args:
            selector: CSS selector or XPath
            by: Selector type (CSS_SELECTOR, XPATH, etc.)
            wait_time: Time to wait for elements in seconds
            
        Returns:
            List of WebElements (possibly empty)
        """
        if not self.browser:
            raise ScrapingError("Browser not initialized")
        
        try:
            # Wait for at least one element to appear
            WebDriverWait(self.browser, wait_time).until(
                EC.presence_of_element_located((by, selector))
            )
            
            # Get all elements
            return self.browser.find_elements(by, selector)
        except (TimeoutException, NoSuchElementException):
            return []
    
    def _update_cookies(self):
        """Update cookies dictionary from current browser session."""
        if self.browser:
            for cookie in self.browser.get_cookies():
                self.cookies[cookie["name"]] = cookie
    
    def _load_cookies(self):
        """Load cookies from disk."""
        config = get_config()
        cookies_file = Path(config.data_dir) / "browser_cookies.json"
        
        if cookies_file.exists():
            try:
                with open(cookies_file, 'r') as f:
                    self.cookies = json.load(f)
                logger.debug(f"Loaded {len(self.cookies)} cookies from disk")
            except Exception as e:
                logger.warning(f"Failed to load cookies: {e}")
                self.cookies = {}
    
    def _save_cookies(self):
        """Save cookies to disk."""
        if not self.cookies:
            return
        
        config = get_config()
        data_dir = Path(config.data_dir)
        data_dir.mkdir(exist_ok=True)
        
        try:
            with open(data_dir / "browser_cookies.json", 'w') as f:
                json.dump(self.cookies, f)
            logger.debug(f"Saved {len(self.cookies)} cookies to disk")
        except Exception as e:
            logger.warning(f"Failed to save cookies: {e}")
    
    def close(self):
        """Close browser and save session data."""
        if self.browser:
            try:
                self._update_cookies()
                self._save_cookies()
                self.browser.quit()
                self.browser = None
                logger.debug("Browser session closed")
            except Exception as e:
                logger.warning(f"Error closing browser: {e}")


class ProxyManager:
    """
    Manages proxy rotation for avoiding IP-based rate limiting.
    """
    
    def __init__(self, proxy_list_path: Optional[str] = None):
        """
        Initialize proxy manager.
        
        Args:
            proxy_list_path: Path to JSON file with proxy list (optional)
        """
        self.config = get_config()
        self.proxies = []
        self.current_proxy = None
        self.failed_proxies = set()
        
        # Try to load proxies from provided path or config directory
        if proxy_list_path:
            self._load_proxies(proxy_list_path)
        else:
            default_path = Path(self.config.config_dir) / "proxies.json"
            if default_path.exists():
                self._load_proxies(str(default_path))
    
    def _load_proxies(self, path: str):
        """
        Load proxies from a JSON file.
        
        Args:
            path: Path to proxy list JSON file
        """
        try:
            with open(path, 'r') as f:
                data = json.load(f)
                self.proxies = data.get("proxies", [])
            logger.debug(f"Loaded {len(self.proxies)} proxies")
        except Exception as e:
            logger.warning(f"Failed to load proxies from {path}: {e}")
    
    def get_proxy(self) -> Optional[Dict[str, str]]:
        """
        Get next working proxy.
        
        Returns:
            Dict with proxy configuration or None if no proxies available
        """
        if not self.proxies:
            return None
        
        # Filter out failed proxies
        available_proxies = [p for p in self.proxies if p["address"] not in self.failed_proxies]
        
        if not available_proxies:
            logger.warning("No working proxies available")
            return None
        
        # Select a random proxy
        self.current_proxy = random.choice(available_proxies)
        
        # Format for requests
        proxy_dict = {
            "http": f"{self.current_proxy['type']}://{self.current_proxy['address']}:{self.current_proxy['port']}",
            "https": f"{self.current_proxy['type']}://{self.current_proxy['address']}:{self.current_proxy['port']}"
        }
        
        # Add authentication if provided
        if "username" in self.current_proxy and "password" in self.current_proxy:
            auth = f"{self.current_proxy['username']}:{self.current_proxy['password']}@"
            proxy_dict["http"] = proxy_dict["http"].replace("://", "://" + auth)
            proxy_dict["https"] = proxy_dict["https"].replace("://", "://" + auth)
        
        logger.debug(f"Selected proxy: {self.current_proxy['address']}")
        return proxy_dict
    
    def mark_proxy_failed(self):
        """Mark the current proxy as failed."""
        if self.current_proxy:
            self.failed_proxies.add(self.current_proxy["address"])
            logger.debug(f"Marked proxy {self.current_proxy['address']} as failed")
            self.current_proxy = None


class FacebookScraper:
    """
    Main scraper class for Facebook data collection.
    """
    
    def __init__(self):
        """Initialize the Facebook scraper."""
        self.config = get_config("scraping")
        self.request_manager = RequestManager()
        self.browser_manager = BrowserManager()
        self.proxy_manager = ProxyManager()
        self.site_analyzer = None  # Will be initialized when needed
    
    @log_function_call
    @handle_errors(reraise=True)
    def initialize(self) -> bool:
        """
        Initialize the scraper and required components.
        
        Returns:
            bool: True if initialization was successful
        """
        try:
            # Initialize browser
            self.browser_manager.initialize_browser()
            
            # Test connection
            self.browser_manager.navigate_to("https://www.facebook.com")
            
            # Initialize site analyzer if needed
            from src.collectors.site_analyzer import FacebookSiteAnalyzer
            self.site_analyzer = FacebookSiteAnalyzer()
            
            logger.info("Facebook scraper initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize Facebook scraper: {e}")
            return False
    
    def close(self):
        """Close the scraper and release resources."""
        self.browser_manager.close()
        self.request_manager.close()
        logger.info("Facebook scraper closed")


# Singleton instance
_scraper_instance = None

def get_scraper() -> FacebookScraper:
    """
    Get the singleton scraper instance.
    
    Returns:
        FacebookScraper: The scraper instance
    """
    global _scraper_instance
    if _scraper_instance is None:
        _scraper_instance = FacebookScraper()
    
    return _scraper_instance


if __name__ == "__main__":
    # Test the scraper functionality
    scraper = get_scraper()
    
    if scraper.initialize():
        print("Scraper initialized successfully")
        
        # Add test code here
        
        scraper.close()
    else:
        print("Failed to initialize scraper")
