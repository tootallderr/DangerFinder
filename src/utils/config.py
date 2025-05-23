"""
Configuration management system for the Facebook OSINT tool.

This module provides a centralized way to manage application configuration
with support for environment variables, JSON files, and runtime overrides.
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional, Union
from dataclasses import dataclass, asdict
from dotenv import load_dotenv

from src.utils.logger import get_logger

logger = get_logger(__name__)

@dataclass
class DatabaseConfig:
    """Database configuration settings."""
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "password"
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_database: str = "ppface"

@dataclass
class ScrapingConfig:
    """Web scraping configuration settings."""
    request_delay: float = 2.0  # seconds between requests
    max_retries: int = 3
    timeout: int = 30
    user_agent: str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    headless: bool = True
    max_profiles: int = 100
    recursion_depth: int = 1

@dataclass
class AnalysisConfig:
    """Analysis engine configuration settings."""
    risk_threshold: float = 0.7
    age_detection_enabled: bool = True
    content_analysis_enabled: bool = True
    pattern_recognition_enabled: bool = True
    ml_model_path: str = "models/risk_classifier.pkl"

@dataclass
class SecurityConfig:
    """Security configuration settings."""
    encryption_key: Optional[str] = None
    session_timeout: int = 3600  # seconds
    max_login_attempts: int = 5
    data_encryption_enabled: bool = True

@dataclass
class UIConfig:
    """User interface configuration settings."""
    theme: str = "light"
    auto_refresh: bool = True
    refresh_interval: int = 300  # seconds
    max_graph_nodes: int = 1000

@dataclass
class AppConfig:
    """Main application configuration."""
    debug: bool = False
    log_level: str = "INFO"
    data_dir: str = "data"
    cache_dir: str = "data/cache"
    temp_dir: str = "data/temp"
    database: Optional[DatabaseConfig] = None
    scraping: Optional[ScrapingConfig] = None
    analysis: Optional[AnalysisConfig] = None
    security: Optional[SecurityConfig] = None
    ui: Optional[UIConfig] = None
    
    def __post_init__(self):
        if self.database is None:
            self.database = DatabaseConfig()
        if self.scraping is None:
            self.scraping = ScrapingConfig()
        if self.analysis is None:
            self.analysis = AnalysisConfig()
        if self.security is None:
            self.security = SecurityConfig()
        if self.ui is None:
            self.ui = UIConfig()

class ConfigManager:
    """
    Configuration manager for loading and managing application settings.
    """
    
    def __init__(self, config_dir: str = "config"):
        """
        Initialize the configuration manager.
        
        Args:
            config_dir: Directory containing configuration files
        """
        self.config_dir = Path(config_dir)
        self.config_dir.mkdir(exist_ok=True)
        self.config: AppConfig = AppConfig()
        self._config_cache: Dict[str, Any] = {}
        
        # Load environment variables
        load_dotenv()
        
        # Load configuration
        self._load_config()
    
    def _load_config(self) -> None:
        """Load configuration from files and environment variables."""
        try:
            # Load from JSON file if it exists
            config_file = self.config_dir / "config.json"
            if config_file.exists():
                with open(config_file, 'r') as f:
                    config_data = json.load(f)
                if isinstance(config_data, dict):
                    self._merge_config(config_data)
                else:
                    logger.warning("Configuration file contains invalid data format")
            
            # Override with environment variables
            self._load_from_env()
            
            logger.info("Configuration loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load configuration: {e}")
            logger.info("Using default configuration")
    
    def _merge_config(self, config_data: Dict[str, Any]) -> None:
        """
        Merge configuration data into the current config.
        
        Args:
            config_data: Configuration data to merge
        """
        if not isinstance(config_data, dict):
            logger.warning(f"Expected dict for config_data, got {type(config_data)}")
            return
            
        for section, values in config_data.items():
            if hasattr(self.config, section):
                section_config = getattr(self.config, section)
                if section_config is not None and isinstance(values, dict):
                    for key, value in values.items():
                        if hasattr(section_config, key):
                            setattr(section_config, key, value)
            else:
                # Handle top-level config attributes
                if hasattr(self.config, section):
                    setattr(self.config, section, values)
    
    def _load_from_env(self) -> None:
        """Load configuration from environment variables."""
        # Database configuration
        neo4j_uri = os.getenv('NEO4J_URI')
        if neo4j_uri and self.config.database:
            self.config.database.neo4j_uri = neo4j_uri
            
        neo4j_user = os.getenv('NEO4J_USER')
        if neo4j_user and self.config.database:
            self.config.database.neo4j_user = neo4j_user
            
        neo4j_password = os.getenv('NEO4J_PASSWORD')
        if neo4j_password and self.config.database:
            self.config.database.neo4j_password = neo4j_password
            
        mongodb_uri = os.getenv('MONGODB_URI')
        if mongodb_uri and self.config.database:
            self.config.database.mongodb_uri = mongodb_uri
        
        # Application configuration
        debug = os.getenv('DEBUG')
        if debug:
            self.config.debug = debug.lower() == 'true'
            
        log_level = os.getenv('LOG_LEVEL')
        if log_level:
            self.config.log_level = log_level
        
        # Security configuration
        encryption_key = os.getenv('ENCRYPTION_KEY')
        if encryption_key and self.config.security:
            self.config.security.encryption_key = encryption_key
    
    def get_config(self, section: Optional[str] = None, default: Any = None) -> Any:
        """
        Get configuration for a specific section or the entire config.
        
        Args:
            section: Configuration section name. If None, returns entire config.
            default: Default value if section not found
            
        Returns:
            Configuration object or value
        """
        if section is None:
            return self.config
        
        if hasattr(self.config, section):
            return getattr(self.config, section)
        
        return default
    
    def set_config(self, section: str, key: str, value: Any) -> None:
        """
        Set a configuration value.
        
        Args:
            section: Configuration section name
            key: Configuration key
            value: Value to set
        """
        if hasattr(self.config, section):
            section_config = getattr(self.config, section)
            if section_config is not None and hasattr(section_config, key):
                setattr(section_config, key, value)
                logger.debug(f"Updated {section}.{key} = {value}")
            else:
                logger.warning(f"Unknown configuration key: {section}.{key}")
        else:
            logger.warning(f"Unknown configuration section: {section}")
    
    def save_config(self, config_file_path: Optional[Union[str, Path]] = None) -> None:
        """
        Save current configuration to file.
        
        Args:
            config_file_path: Path to save configuration. If None, uses default.
        """
        if config_file_path is None:
            file_path = self.config_dir / "config.json"
        elif isinstance(config_file_path, str):
            file_path = Path(config_file_path)
        else:
            file_path = config_file_path
        
        try:
            config_dict = asdict(self.config)
            with open(file_path, 'w') as f:
                json.dump(config_dict, f, indent=2)
            
            logger.info(f"Configuration saved to {file_path}")
            
        except Exception as e:
            logger.error(f"Failed to save configuration: {e}")
    
    def reload_config(self) -> None:
        """Reload configuration from files and environment."""
        self._load_config()
    
    def get_cache_key(self, *args) -> str:
        """
        Generate a cache key from arguments.
        
        Args:
            *args: Arguments to generate key from
            
        Returns:
            Cache key string
        """
        return "_".join(str(arg) for arg in args)
    
    def cache_get(self, key: str, default: Any = None) -> Any:
        """
        Get value from configuration cache.
        
        Args:
            key: Cache key
            default: Default value if key not found
            
        Returns:
            Cached value or default
        """
        return self._config_cache.get(key, default)
    
    def cache_set(self, key: str, value: Any) -> None:
        """
        Set value in configuration cache.
        
        Args:
            key: Cache key
            value: Value to cache
        """
        self._config_cache[key] = value
    
    def cache_clear(self) -> None:
        """Clear configuration cache."""
        self._config_cache.clear()

# Global configuration manager instance
_config_manager: Optional[ConfigManager] = None

def get_config_manager() -> ConfigManager:
    """
    Get the global configuration manager instance.
    
    Returns:
        ConfigManager instance
    """
    global _config_manager
    if _config_manager is None:
        _config_manager = ConfigManager()
    return _config_manager

def get_config(section: Optional[str] = None, default: Any = None) -> Any:
    """
    Convenience function to get configuration.
    
    Args:
        section: Configuration section name
        default: Default value if section not found
        
    Returns:
        Configuration object or value
    """
    return get_config_manager().get_config(section, default)
