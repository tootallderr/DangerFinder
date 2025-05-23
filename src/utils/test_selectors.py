"""
Test selectors against Facebook profiles.

This script tests the configured CSS selectors against a Facebook profile
to verify they correctly extract the intended data elements.
"""

import argparse
import json
import sys
import os
from pathlib import Path
import time
from typing import Dict, List, Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from src.utils.logger import setup_logger, get_logger
from src.utils.config import get_config
from src.utils.errors import handle_errors, ScrapingError
from src.collectors.scraper import get_scraper

logger = get_logger(__name__)

class SelectorTester:
    """
    Test CSS selectors against Facebook profiles.
    """
    
    def __init__(self, config_file: str):
        """
        Initialize selector tester.
        
        Args:
            config_file: Path to selectors configuration file
        """
        self.config_file = config_file
        self.selectors = self._load_selectors()
        self.scraper = get_scraper()
        self.browser = None
    
    def _load_selectors(self) -> Dict[str, Dict[str, List[str]]]:
        """Load selectors from configuration file."""
        try:
            with open(self.config_file, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            logger.error(f"Selectors config file not found: {self.config_file}")
            sys.exit(1)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON in selectors config: {self.config_file}")
            sys.exit(1)
    
    @handle_errors(reraise=True)
    def test_selectors(self, url: Optional[str] = None) -> Dict[str, Any]:
        """
        Test selectors against a Facebook profile or the default one.
        
        Args:
            url: Facebook profile URL to test against (optional)
            
        Returns:
            Dictionary with test results
        """
        logger.info("Testing selectors against Facebook profile")
        
        # Use provided URL or default test URL
        test_url = url or "https://www.facebook.com/zuck"
        
        # Initialize browser
        self.browser = self.scraper.browser_manager.initialize_browser()
        
        # Navigate to profile
        logger.info(f"Navigating to {test_url}")
        self.scraper.browser_manager.navigate_to(test_url)
        
        results = {
            "profile_url": test_url,
            "test_time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "results": {}
        }
        
        # Test profile page selectors
        if "profile_page" in self.selectors:
            logger.info("Testing profile page selectors")
            results["results"]["profile_page"] = self._test_page_selectors(
                self.selectors["profile_page"]
            )
        
        # Navigate to friends page
        logger.info("Navigating to friends page")
        friends_url = test_url.rstrip("/") + "/friends"
        self.scraper.browser_manager.navigate_to(friends_url)
        
        # Test friends page selectors
        if "friends_page" in self.selectors:
            logger.info("Testing friends page selectors")
            results["results"]["friends_page"] = self._test_page_selectors(
                self.selectors["friends_page"]
            )
        
        # Save results
        self._save_results(results)
        
        logger.info("Selector testing completed")
        return results
    
    def _test_page_selectors(self, page_selectors: Dict[str, List[str]]) -> Dict[str, Any]:
        """
        Test all selectors for a specific page type.
        
        Args:
            page_selectors: Selectors to test
            
        Returns:
            Dictionary with test results
        """
        results = {}
        
        for element_type, selectors in page_selectors.items():
            element_results = []
            
            for i, selector in enumerate(selectors):
                try:
                    elements = self.scraper.browser_manager.find_elements(selector)
                    count = len(elements)
                    
                    sample_text = None
                    sample_attr = None
                    
                    if elements:
                        # Extract sample text and attributes
                        sample_text = elements[0].text[:100] if elements[0].text else None
                        
                        if elements[0].tag_name == "img":
                            sample_attr = elements[0].get_attribute("src")
                        elif elements[0].tag_name == "a":
                            sample_attr = elements[0].get_attribute("href")
                    
                    element_results.append({
                        "selector": selector,
                        "working": count > 0,
                        "count": count,
                        "sample_text": sample_text,
                        "sample_attribute": sample_attr
                    })
                    
                except Exception as e:
                    element_results.append({
                        "selector": selector,
                        "working": False,
                        "error": str(e)
                    })
            
            results[element_type] = element_results
        
        return results
    
    def _save_results(self, results: Dict[str, Any]) -> None:
        """
        Save test results to file.
        
        Args:
            results: Test results
        """
        config = get_config()
        output_dir = Path(config.data_dir) / "selector_tests"
        output_dir.mkdir(exist_ok=True)
        
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        output_file = output_dir / f"selector_test_{timestamp}.json"
        
        try:
            with open(output_file, 'w') as f:
                json.dump(results, f, indent=2)
            logger.info(f"Test results saved to {output_file}")
        except Exception as e:
            logger.error(f"Failed to save test results: {e}")
    
    def print_summary(self, results: Dict[str, Any]) -> None:
        """
        Print summary of test results.
        
        Args:
            results: Test results
        """
        print("\nSelector Test Summary")
        print("====================\n")
        print(f"Profile URL: {results['profile_url']}")
        print(f"Test Time: {results['test_time']}\n")
        
        for page_type, page_results in results["results"].items():
            print(f"\n{page_type.upper()}:")
            print("-" * (len(page_type) + 1))
            
            working_count = 0
            total_count = 0
            
            for element_type, selectors in page_results.items():
                working_selectors = [s for s in selectors if s["working"]]
                
                print(f"\n  {element_type}:")
                print(f"    Working selectors: {len(working_selectors)}/{len(selectors)}")
                
                working_count += len(working_selectors)
                total_count += len(selectors)
                
                # Show one working selector as example
                if working_selectors:
                    best = working_selectors[0]
                    for selector in working_selectors:
                        if selector["count"] > best["count"]:
                            best = selector
                    
                    print(f"    Best selector: {best['selector']} ({best['count']} elements)")
                    if best["sample_text"]:
                        print(f"    Sample text: {best['sample_text'][:50]}...")
            
            print(f"\n  Total working selectors: {working_count}/{total_count} "
                  f"({working_count/total_count*100:.1f}%)")
    
    def close(self) -> None:
        """Close browser and clean up."""
        self.scraper.close()


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Test Facebook selectors")
    parser.add_argument(
        "--config",
        type=str,
        default="config/selectors.json",
        help="Path to selectors configuration file"
    )
    parser.add_argument(
        "--url",
        type=str,
        help="Facebook profile URL to test against (optional)"
    )
    return parser.parse_args()


def main():
    """Main function."""
    # Set up logging
    setup_logger()
    
    # Parse arguments
    args = parse_arguments()
    
    try:
        # Initialize and run tests
        tester = SelectorTester(args.config)
        results = tester.test_selectors(args.url)
        
        # Print summary
        tester.print_summary(results)
        
    except Exception as e:
        logger.error(f"Error testing selectors: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        sys.exit(1)
        
    finally:
        # Clean up
        if 'tester' in locals():
            tester.close()


if __name__ == "__main__":
    main()
