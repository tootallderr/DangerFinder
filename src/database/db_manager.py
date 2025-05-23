"""
Database manager for PPFace.

This module provides a central database manager that handles
connections to different database backends.
"""

import os
from pathlib import Path
from typing import Optional, Dict, Any, Type, List, Union
import json
import logging
from enum import Enum
from abc import ABC, abstractmethod

from src.utils.logger import get_logger
from src.utils.config import get_config_manager

class DatabaseType(Enum):
    """Types of databases supported by the application."""
    JSON = "json"
    MONGO = "mongo"
    NEO4J = "neo4j"
    SQLITE = "sqlite"

class DatabaseInterface(ABC):
    """Abstract interface for database implementations."""
    
    @abstractmethod
    def initialize(self) -> bool:
        """
        Initialize the database connection.
        
        Returns:
            bool: True if successful, False otherwise
        """
        pass
    
    @abstractmethod
    def close(self) -> None:
        """Close the database connection."""
        pass
    
    @abstractmethod
    def store_profile(self, profile_data: Dict[str, Any]) -> str:
        """
        Store profile data.
        
        Args:
            profile_data: Dictionary containing profile data
            
        Returns:
            str: ID of the stored profile
        """
        pass
    
    @abstractmethod
    def get_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve profile data by ID.
        
        Args:
            profile_id: ID of the profile to retrieve
            
        Returns:
            Optional[Dict]: Profile data or None if not found
        """
        pass
    
    @abstractmethod
    def store_post(self, post_data: Dict[str, Any]) -> str:
        """
        Store post data.
        
        Args:
            post_data: Dictionary containing post data
            
        Returns:
            str: ID of the stored post
        """
        pass
    
    @abstractmethod
    def get_posts_by_profile(self, profile_id: str) -> List[Dict[str, Any]]:
        """
        Retrieve posts for a specific profile.
        
        Args:
            profile_id: ID of the profile to retrieve posts for
            
        Returns:
            List[Dict]: List of post data
        """
        pass
    
    @abstractmethod
    def store_friendship(self, source_id: str, target_id: str, metadata: Dict[str, Any] = None) -> str:
        """
        Store friendship relationship.
        
        Args:
            source_id: ID of the source profile
            target_id: ID of the target profile
            metadata: Optional metadata about the relationship
            
        Returns:
            str: ID of the stored relationship
        """
        pass
    
    @abstractmethod
    def get_friends(self, profile_id: str) -> List[str]:
        """
        Retrieve friends for a profile.
        
        Args:
            profile_id: ID of the profile to retrieve friends for
            
        Returns:
            List[str]: List of friend profile IDs
        """
        pass
    
    @abstractmethod
    def search_profiles(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Search profiles based on criteria.
        
        Args:
            query: Dictionary containing search criteria
            
        Returns:
            List[Dict]: List of matching profile data
        """
        pass

class DatabaseManager:
    """
    Central manager for database operations.
    
    This class handles database connections, switching between
    different database backends, and providing a unified interface
    for data storage and retrieval.
    """
    
    def __init__(self):
        """Initialize the database manager."""
        self.logger = get_logger(__name__)
        self.config_manager = get_config_manager()
        self.config = self.config_manager.get_config()
        self.db_implementations = {}
        self.active_db = None
        self.initialized = False
    
    def register_implementation(self, db_type: DatabaseType, implementation: Type[DatabaseInterface]) -> None:
        """
        Register a database implementation.
        
        Args:
            db_type: Type of database
            implementation: Class implementing DatabaseInterface
        """
        self.db_implementations[db_type] = implementation
        self.logger.debug(f"Registered {db_type.value} database implementation")
    
    def initialize(self) -> bool:
        """
        Initialize the database system.
        
        Returns:
            bool: True if successful, False otherwise
        """
        if self.initialized:
            return True
            
        try:
            db_type = DatabaseType(self.config.database_type)
            
            if db_type not in self.db_implementations:
                self.logger.error(f"No implementation registered for database type: {db_type.value}")
                return False
                
            implementation_class = self.db_implementations[db_type]
            self.active_db = implementation_class()
            
            success = self.active_db.initialize()
            if success:
                self.initialized = True
                self.logger.info(f"Database initialized successfully: {db_type.value}")
                return True
            else:
                self.logger.error(f"Failed to initialize {db_type.value} database")
                return False
                
        except Exception as e:
            self.logger.error(f"Error initializing database: {e}", exc_info=True)
            return False
    
    def close(self) -> None:
        """Close the database connection."""
        if self.active_db:
            try:
                self.active_db.close()
                self.logger.info("Database connection closed")
            except Exception as e:
                self.logger.error(f"Error closing database connection: {e}", exc_info=True)
    
    def get_interface(self) -> DatabaseInterface:
        """
        Get the active database interface.
        
        Returns:
            DatabaseInterface: Active database interface
        
        Raises:
            RuntimeError: If database not initialized
        """
        if not self.initialized or not self.active_db:
            raise RuntimeError("Database not initialized")
        return self.active_db

# Singleton instance
_instance = None

def get_database_manager() -> DatabaseManager:
    """
    Get singleton instance of DatabaseManager.
    
    Returns:
        DatabaseManager: Singleton instance
    """
    global _instance
    if _instance is None:
        _instance = DatabaseManager()
    return _instance
