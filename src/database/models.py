"""
Database models for PPFace.

This module provides data models for Facebook profiles, posts, and relationships.
"""

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Any, Union
from datetime import datetime
import json
from pathlib import Path
import uuid

@dataclass
class ProfileModel:
    """Data model for Facebook profiles."""
    
    profile_id: str  # Facebook profile ID
    username: Optional[str] = None  # Facebook username
    full_name: Optional[str] = None  # Full name
    profile_url: Optional[str] = None  # Profile URL
    profile_image_url: Optional[str] = None  # Profile image URL
    cover_image_url: Optional[str] = None  # Cover image URL
    bio: Optional[str] = None  # Profile bio
    location: Optional[str] = None  # Location
    work_info: List[Dict[str, Any]] = field(default_factory=list)  # Work information
    education_info: List[Dict[str, Any]] = field(default_factory=list)  # Education information
    contact_info: Dict[str, Any] = field(default_factory=dict)  # Contact information
    relationship_status: Optional[str] = None  # Relationship status
    interests: List[str] = field(default_factory=list)  # Interests
    likes: List[Dict[str, Any]] = field(default_factory=list)  # Liked pages
    metadata: Dict[str, Any] = field(default_factory=dict)  # Additional metadata
    collection_date: datetime = field(default_factory=datetime.now)  # Date of data collection
    last_updated: datetime = field(default_factory=datetime.now)  # Last update date
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert model to dictionary."""
        data = asdict(self)
        # Convert datetime objects to ISO format strings
        data['collection_date'] = data['collection_date'].isoformat()
        data['last_updated'] = data['last_updated'].isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProfileModel':
        """Create model from dictionary."""
        # Convert ISO format strings back to datetime objects
        if 'collection_date' in data and isinstance(data['collection_date'], str):
            data['collection_date'] = datetime.fromisoformat(data['collection_date'])
        if 'last_updated' in data and isinstance(data['last_updated'], str):
            data['last_updated'] = datetime.fromisoformat(data['last_updated'])
        return cls(**data)
    
    def update(self, new_data: Dict[str, Any]) -> None:
        """Update model with new data."""
        for key, value in new_data.items():
            if hasattr(self, key):
                setattr(self, key, value)
        self.last_updated = datetime.now()


@dataclass
class PostModel:
    """Data model for Facebook posts."""
    
    post_id: str  # Facebook post ID
    profile_id: str  # ID of the profile that made the post
    content: Optional[str] = None  # Text content
    post_url: Optional[str] = None  # URL to the post
    post_date: Optional[datetime] = None  # Date of the post
    media_urls: List[str] = field(default_factory=list)  # Media URLs (images, videos)
    reactions: Dict[str, int] = field(default_factory=dict)  # Reaction counts
    comments_count: int = 0  # Number of comments
    shares_count: int = 0  # Number of shares
    comments: List[Dict[str, Any]] = field(default_factory=list)  # Comment data
    privacy_setting: Optional[str] = None  # Privacy setting (public, friends, etc.)
    location: Optional[Dict[str, Any]] = None  # Location data
    tags: List[str] = field(default_factory=list)  # Tagged profiles
    metadata: Dict[str, Any] = field(default_factory=dict)  # Additional metadata
    collection_date: datetime = field(default_factory=datetime.now)  # Date of data collection
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert model to dictionary."""
        data = asdict(self)
        # Convert datetime objects to ISO format strings
        data['collection_date'] = data['collection_date'].isoformat()
        if data['post_date']:
            data['post_date'] = data['post_date'].isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'PostModel':
        """Create model from dictionary."""
        # Convert ISO format strings back to datetime objects
        if 'collection_date' in data and isinstance(data['collection_date'], str):
            data['collection_date'] = datetime.fromisoformat(data['collection_date'])
        if 'post_date' in data and isinstance(data['post_date'], str):
            data['post_date'] = datetime.fromisoformat(data['post_date'])
        return cls(**data)


@dataclass
class FriendshipModel:
    """Data model for Facebook friendships."""
    
    friendship_id: str = field(default_factory=lambda: str(uuid.uuid4()))  # Unique ID for this friendship
    source_id: str = ""  # ID of the source profile
    target_id: str = ""  # ID of the target profile
    friendship_date: Optional[datetime] = None  # Date of friendship if available
    relationship_type: str = "friend"  # Type of relationship (friend, follower, etc.)
    metadata: Dict[str, Any] = field(default_factory=dict)  # Additional metadata
    collection_date: datetime = field(default_factory=datetime.now)  # Date of data collection
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert model to dictionary."""
        data = asdict(self)
        # Convert datetime objects to ISO format strings
        data['collection_date'] = data['collection_date'].isoformat()
        if data['friendship_date']:
            data['friendship_date'] = data['friendship_date'].isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'FriendshipModel':
        """Create model from dictionary."""
        # Convert ISO format strings back to datetime objects
        if 'collection_date' in data and isinstance(data['collection_date'], str):
            data['collection_date'] = datetime.fromisoformat(data['collection_date'])
        if 'friendship_date' in data and isinstance(data['friendship_date'], str):
            data['friendship_date'] = datetime.fromisoformat(data['friendship_date'])
        return cls(**data)
