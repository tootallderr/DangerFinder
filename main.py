"""
Main application entry point for the Facebook OSINT tool.

This module initializes the core components and provides the main
application interface.
"""

import sys
import os
import argparse
from pathlib import Path

# Add src directory to Python path
src_path = Path(__file__).parent / "src"
sys.path.insert(0, str(src_path))

from src.utils.logger import setup_logger, LoggerConfig, get_logger
from src.utils.config import get_config_manager
from src.utils.errors import setup_global_exception_handler, get_error_reporter
from src.core.plugin_system import get_plugin_manager

class PPFaceApp:
    """Main application class for the Facebook OSINT tool."""
    
    def __init__(self):
        """Initialize the application."""
        self.config_manager = None
        self.plugin_manager = None
        self.logger = None
        self.initialized = False
    
    def initialize(self) -> bool:
        """
        Initialize the application components.
        
        Returns:
            True if initialization was successful, False otherwise
        """
        try:
            # Initialize configuration manager
            self.config_manager = get_config_manager()
            
            # Initialize logger with configuration
            app_config = self.config_manager.get_config()
            logger_config = LoggerConfig(
                log_level=app_config.log_level,
                log_dir="logs",
                console_output=True,
                structured_logging=not app_config.debug
            )
            setup_logger(logger_config)
            self.logger = get_logger(__name__)
            
            self.logger.info("Starting PPFace Facebook OSINT Tool")
            
            # Set up global exception handler
            setup_global_exception_handler()
            
            # Initialize plugin manager
            self.plugin_manager = get_plugin_manager()
            self.plugin_manager.load_plugins()
            
            # Create necessary directories
            self._create_directories()
            
            self.initialized = True
            self.logger.info("Application initialized successfully")
            return True
            
        except Exception as e:
            if self.logger:
                self.logger.critical(f"Failed to initialize application: {e}")
            else:
                print(f"CRITICAL: Failed to initialize application: {e}")
            return False
    
    def _create_directories(self):
        """Create necessary application directories."""
        if not self.config_manager:
            if self.logger:
                self.logger.error("Config manager not initialized")
            else:
                print("ERROR: Config manager not initialized")
            return
            
        app_config = self.config_manager.get_config()
        
        directories = [
            app_config.data_dir,
            app_config.cache_dir,
            app_config.temp_dir,
            "logs",
            "config",
            "plugins",
            Path(app_config.data_dir) / "profiles",
            Path(app_config.data_dir) / "posts",
            Path(app_config.data_dir) / "friends",
            Path(app_config.data_dir) / "graph",
            Path(app_config.data_dir) / "traversals"
        ]
        
        for directory in directories:
            Path(directory).mkdir(parents=True, exist_ok=True)
            if self.logger:
                self.logger.debug(f"Created directory: {directory}")
            else:
                print(f"DEBUG: Created directory: {directory}")
    
    def run(self, args=None):
        """
        Run the main application.
        
        Args:
            args: Command line arguments
            
        Returns:
            True if successful, False otherwise
        """
        if not self.initialized:
            if not self.initialize():
                return False
        
        try:
            # At this point self.logger should be initialized, but let's be safe
            if not self.logger:
                self.logger = get_logger(__name__)
                
            self.logger.info("Application is running")
            
            # Parse command line arguments
            if args is None:
                args = self._parse_args()
            
            # Handle commands
            if args.command:
                return self._handle_command(args)
            else:
                # Start the interactive mode
                self._interactive_mode()
            
            return True
            
        except KeyboardInterrupt:
            if self.logger:
                self.logger.info("Application interrupted by user")
            return True
        except Exception as e:
            if self.logger:
                self.logger.critical(f"Unhandled error in main application: {e}")
            else:
                print(f"CRITICAL: Unhandled error in main application: {e}")
            return False
        finally:
            self.cleanup()
    
    def _parse_args(self):
        """Parse command line arguments."""
        parser = argparse.ArgumentParser(
            description='Facebook OSINT Tool'
        )
        
        subparsers = parser.add_subparsers(dest='command', help='Available commands')
        
        # Analyze site structure command
        analyze_parser = subparsers.add_parser('analyze-site', help='Analyze Facebook site structure')
        
        # Profile extraction command
        profile_parser = subparsers.add_parser('extract-profile', help='Extract data from a Facebook profile')
        profile_parser.add_argument('url', help='Facebook profile URL')
        
        # Friend list collection command
        friends_parser = subparsers.add_parser('collect-friends', help='Collect friend list from a Facebook profile')
        friends_parser.add_argument('url', help='Facebook profile URL')
        friends_parser.add_argument('--max', type=int, default=50, help='Maximum number of friends to collect')
        
        # Network traversal command
        traverse_parser = subparsers.add_parser('traverse-network', help='Traverse the friend network')
        traverse_parser.add_argument('url', help='Seed Facebook profile URL')
        traverse_parser.add_argument('--depth', type=int, default=1, help='Maximum traversal depth')
        traverse_parser.add_argument('--max-profiles', type=int, default=20, help='Maximum profiles to visit')
        traverse_parser.add_argument('--max-friends', type=int, default=20, help='Maximum friends to collect per profile')
        
        # Test selectors command
        selectors_parser = subparsers.add_parser('test-selectors', help='Test selectors against a Facebook profile')
        selectors_parser.add_argument('--url', help='Facebook profile URL to test against')
        selectors_parser.add_argument('--config', default='config/selectors.json', help='Path to selectors configuration file')
        
        return parser.parse_args()
    def _handle_command(self, args):
        """Handle command line arguments."""
        if args.command == 'analyze-site':
            return self._analyze_site_structure()
        elif args.command == 'extract-profile':
            return self._extract_profile(args.url)
        elif args.command == 'collect-friends':
            return self._collect_friends(args.url, args.max)
        elif args.command == 'traverse-network':
            return self._traverse_network(args.url, args.depth, args.max_profiles, args.max_friends)
        elif args.command == 'test-selectors':
            return self._test_selectors(args.url, args.config)
        else:
            logger = get_logger(__name__)
            logger.error(f"Unknown command: {args.command}")
            return False
    def _analyze_site_structure(self):
        """Analyze Facebook site structure."""
        logger = get_logger(__name__)
        logger.info("Analyzing Facebook site structure")
        try:
            from src.collectors.site_analyzer import analyze_facebook_site
            results = analyze_facebook_site()
            
            print("\nFacebook Site Analysis Results:")
            print(f"- Found {len(results['robots_txt'][0])} allowed paths in robots.txt")
            print(f"- Found {len(results['robots_txt'][1])} disallowed paths in robots.txt")
            print(f"- Identified {sum(len(selectors) for selectors in results['stable_selectors'].values())} stable selectors")
            print(f"- Documented {len(results['access_boundaries']['legal_data_sources'])} legal data sources")
            
            logger.info("Facebook site analysis completed successfully")
            return True
        except Exception as e:
            logger.error(f"Error analyzing site structure: {e}")
            return False
    def _extract_profile(self, url):
        """Extract data from a Facebook profile."""
        logger = get_logger(__name__)
        logger.info(f"Extracting profile data from {url}")
        try:
            from src.collectors.profile_extractor import get_profile_extractor
            from src.collectors.scraper import get_scraper
            
            extractor = get_profile_extractor()
            profile = extractor.extract_profile(url)
            posts = extractor.extract_posts(url, max_posts=10)
            
            print(f"\nExtracted profile: {profile.name}")
            if profile.username:
                print(f"Username: {profile.username}")
            if profile.bio:
                print(f"Bio: {profile.bio}")
            if profile.current_city:
                print(f"Location: {profile.current_city}")
            if profile.work:
                print(f"Works at: {profile.work[0]['description'] if profile.work else 'Unknown'}")
            
            print(f"\nCollected {len(posts)} posts")
            
            # Clean up
            scraper = get_scraper()
            scraper.close()
            
            logger.info(f"Profile extraction from {url} completed successfully")
            return True
        except Exception as e:
            logger.error(f"Error extracting profile: {e}")
            return False
    def _collect_friends(self, url, max_friends=50):
        """Collect friend list from a Facebook profile."""
        logger = get_logger(__name__)
        logger.info(f"Collecting friends from {url} (max: {max_friends})")
        try:
            from src.collectors.friend_collector import get_friend_collector
            from src.collectors.scraper import get_scraper
            
            collector = get_friend_collector()
            friends = collector.collect_friends(url, max_friends=max_friends)
            
            print(f"\nCollected {len(friends)} friends")
            
            if friends:
                print("\nSample friends:")
                for i, friend in enumerate(friends[:5]):
                    print(f"- {friend.name}")
                    if i >= 4:
                        break
                        
                if len(friends) > 5:
                    print(f"...and {len(friends) - 5} more")
            
            # Clean up
            scraper = get_scraper()
            scraper.close()
            
            logger.info(f"Friend collection from {url} completed successfully")
            return True
        except Exception as e:
            logger.error(f"Error collecting friends: {e}")
            return False
    def _traverse_network(self, seed_url, max_depth=1, max_profiles=20, max_friends_per_profile=20):
        """Traverse the friend network."""
        logger = get_logger(__name__)
        logger.info(f"Traversing network from {seed_url} (depth: {max_depth}, max profiles: {max_profiles})")
        try:
            from src.collectors.friend_collector import get_friend_collector
            from src.collectors.scraper import get_scraper
            
            collector = get_friend_collector()
            results = collector.traverse_network(
                seed_url=seed_url,
                max_depth=max_depth,
                max_profiles=max_profiles,
                max_friends_per_profile=max_friends_per_profile
            )
            
            print("\nNetwork Traversal Results:")
            print(f"Seed profile: {results['seed_profile']}")
            print(f"Profiles visited: {results['profiles_visited']}")
            print(f"Max depth reached: {results['max_depth_reached']}")
            print(f"Profiles collected: {results['profiles_collected']}")
            print(f"Friendship edges: {results['friendship_edges']}")
            
            # Clean up
            scraper = get_scraper()
            scraper.close()
            
            logger.info(f"Network traversal from {seed_url} completed successfully")
            return True
        except Exception as e:
            logger.error(f"Error traversing network: {e}")
            return False
    def _test_selectors(self, url=None, config_file='config/selectors.json'):
        """Test selectors against a Facebook profile."""
        logger = get_logger(__name__)
        logger.info("Testing selectors against Facebook profile")
        try:
            from src.utils.test_selectors import SelectorTester
            from src.collectors.scraper import get_scraper
            
            tester = SelectorTester(config_file)
            results = tester.test_selectors(url)
            tester.print_summary(results)
            
            # Clean up
            scraper = get_scraper()
            scraper.close()
            
            logger.info("Selector testing completed successfully")
            return True
        except Exception as e:
            logger.error(f"Error testing selectors: {e}")
            return False

    def _interactive_mode(self):
        """Run the application in interactive mode."""
        logger = get_logger(__name__)
        logger.info("Starting interactive mode")
        print("\n==== PPFace Facebook OSINT Tool ====\n")
        
        while True:
            print("\nAvailable commands:")
            print("1. Analyze Facebook site structure")
            print("2. Extract data from a profile")
            print("3. Collect friend list")
            print("4. Traverse friend network")
            print("5. Test selectors")
            print("0. Exit")
            
            choice = input("\nEnter your choice (0-5): ")
            
            if choice == '0':
                print("Exiting application...")
                break
            elif choice == '1':
                self._analyze_site_structure()
            elif choice == '2':
                url = input("Enter Facebook profile URL: ")
                self._extract_profile(url)
            elif choice == '3':
                url = input("Enter Facebook profile URL: ")
                max_friends = input("Maximum number of friends to collect (default 50): ")
                self._collect_friends(url, int(max_friends) if max_friends.isdigit() else 50)
            elif choice == '4':
                url = input("Enter seed profile URL: ")
                depth = input("Maximum traversal depth (default 1): ")
                max_profiles = input("Maximum profiles to visit (default 20): ")
                max_friends = input("Maximum friends per profile (default 20): ")
                
                self._traverse_network(
                    url,
                    int(depth) if depth.isdigit() else 1,
                    int(max_profiles) if max_profiles.isdigit() else 20,
                    int(max_friends) if max_friends.isdigit() else 20
                )
            elif choice == '5':
                url = input("Enter Facebook profile URL (optional): ")
                self._test_selectors(url if url else None)
            else:
                print("Invalid choice. Please try again.")
    
    def cleanup(self):
        """Clean up application resources."""
        if self.logger:
            self.logger.info("Cleaning up application resources")
        
        # Clean up plugins
        if self.plugin_manager:
            self.plugin_manager.cleanup()
        
        # Clean up scraper if it was initialized
        try:
            from src.collectors.scraper import get_scraper
            scraper = get_scraper()
            scraper.close()
        except (ImportError, AttributeError):
            pass
        
        # Log error summary
        error_reporter = get_error_reporter()
        error_summary = error_reporter.get_error_summary()
        if error_summary["total_errors"] > 0:
            if self.logger:
                self.logger.warning(f"Application finished with {error_summary['total_errors']} errors")
        
        if self.logger:
            self.logger.info("Application shutdown complete")

def main():
    """Main entry point."""
    app = PPFaceApp()
    success = app.run()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
