"""
Plugin architecture for the Facebook OSINT tool.

This module provides a flexible plugin system that allows for modular
extension of the application's functionality.
"""

import os
import sys
import importlib
import inspect
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Any, Optional, Type, Callable
from dataclasses import dataclass

from src.utils.logger import get_logger
from src.utils.errors import PluginError, ErrorSeverity
from src.utils.config import get_config_manager

logger = get_logger(__name__)

@dataclass
class PluginInfo:
    """Information about a plugin."""
    name: str
    version: str
    description: str
    author: str
    category: str
    dependencies: List[str]
    enabled: bool = True

class PluginBase(ABC):
    """Base class for all plugins."""
    
    def __init__(self):
        """Initialize the plugin."""
        self.name = self.__class__.__name__
        self.enabled = True
        self.config_manager = get_config_manager()
        self.logger = get_logger(self.__class__.__module__)
    
    @abstractmethod
    def get_info(self) -> PluginInfo:
        """
        Get plugin information.
        
        Returns:
            PluginInfo object with plugin details
        """
        pass
    
    @abstractmethod
    def initialize(self) -> bool:
        """
        Initialize the plugin.
        
        Returns:
            True if initialization was successful, False otherwise
        """
        pass
    
    @abstractmethod
    def cleanup(self) -> None:
        """Clean up plugin resources."""
        pass
    
    def get_config(self, key: str, default: Any = None) -> Any:
        """
        Get plugin-specific configuration.
        
        Args:
            key: Configuration key
            default: Default value if key not found
            
        Returns:
            Configuration value
        """
        plugin_config = self.config_manager.get_config("plugins", {})
        return plugin_config.get(self.name, {}).get(key, default)
    
    def set_config(self, key: str, value: Any) -> None:
        """
        Set plugin-specific configuration.
        
        Args:
            key: Configuration key
            value: Configuration value
        """
        plugin_config = self.config_manager.get_config("plugins", {})
        if self.name not in plugin_config:
            plugin_config[self.name] = {}
        plugin_config[self.name][key] = value

class DataCollectorPlugin(PluginBase):
    """Base class for data collection plugins."""
    
    @abstractmethod
    def collect_data(self, target: str, **kwargs) -> Dict[str, Any]:
        """
        Collect data from the target.
        
        Args:
            target: Target to collect data from
            **kwargs: Additional parameters
            
        Returns:
            Collected data
        """
        pass

class AnalysisPlugin(PluginBase):
    """Base class for analysis plugins."""
    
    @abstractmethod
    def analyze(self, data: Dict[str, Any], **kwargs) -> Dict[str, Any]:
        """
        Analyze the provided data.
        
        Args:
            data: Data to analyze
            **kwargs: Additional parameters
            
        Returns:
            Analysis results
        """
        pass

class ExportPlugin(PluginBase):
    """Base class for export plugins."""
    
    @abstractmethod
    def export(self, data: Dict[str, Any], output_path: str, **kwargs) -> bool:
        """
        Export data to the specified format.
        
        Args:
            data: Data to export
            output_path: Output file path
            **kwargs: Additional parameters
            
        Returns:
            True if export was successful, False otherwise
        """
        pass

class VisualizationPlugin(PluginBase):
    """Base class for visualization plugins."""
    
    @abstractmethod
    def visualize(self, data: Dict[str, Any], **kwargs) -> Any:
        """
        Create visualization from the data.
        
        Args:
            data: Data to visualize
            **kwargs: Additional parameters
            
        Returns:
            Visualization object or path
        """
        pass

class PluginManager:
    """Manager for loading and managing plugins."""
    
    def __init__(self, plugin_dir: str = "plugins"):
        """
        Initialize the plugin manager.
        
        Args:
            plugin_dir: Directory containing plugins
        """
        self.plugin_dir = Path(plugin_dir)
        self.plugin_dir.mkdir(exist_ok=True)
        
        self.plugins: Dict[str, PluginBase] = {}
        self.plugin_info: Dict[str, PluginInfo] = {}
        self.hooks: Dict[str, List[Callable]] = {}
        
        # Add plugin directory to Python path
        if str(self.plugin_dir) not in sys.path:
            sys.path.insert(0, str(self.plugin_dir))
    
    def load_plugins(self) -> None:
        """Load all plugins from the plugin directory."""
        logger.info(f"Loading plugins from {self.plugin_dir}")
        
        try:
            # Load plugins from .py files
            for plugin_file in self.plugin_dir.glob("*.py"):
                if plugin_file.name.startswith("_"):
                    continue  # Skip private files
                
                try:
                    self._load_plugin_file(plugin_file)
                except Exception as e:
                    logger.error(f"Failed to load plugin {plugin_file.name}: {e}")
            
            # Load plugins from subdirectories
            for plugin_dir in self.plugin_dir.iterdir():
                if plugin_dir.is_dir() and not plugin_dir.name.startswith("_"):
                    try:
                        self._load_plugin_directory(plugin_dir)
                    except Exception as e:
                        logger.error(f"Failed to load plugin directory {plugin_dir.name}: {e}")
            
            logger.info(f"Loaded {len(self.plugins)} plugins")
            
        except Exception as e:
            raise PluginError(
                f"Failed to load plugins: {e}",
                error_code="PLUGIN_LOAD_FAILED",
                severity=ErrorSeverity.HIGH
            )
    
    def _load_plugin_file(self, plugin_file: Path) -> None:
        """
        Load a plugin from a Python file.
        
        Args:
            plugin_file: Path to the plugin file
        """
        module_name = plugin_file.stem
        spec = importlib.util.spec_from_file_location(module_name, plugin_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        # Find plugin classes in the module
        for name, obj in inspect.getmembers(module):
            if (inspect.isclass(obj) and 
                issubclass(obj, PluginBase) and 
                obj != PluginBase and
                not inspect.isabstract(obj)):
                
                self._register_plugin(obj)
    
    def _load_plugin_directory(self, plugin_dir: Path) -> None:
        """
        Load a plugin from a directory (package).
        
        Args:
            plugin_dir: Path to the plugin directory
        """
        init_file = plugin_dir / "__init__.py"
        if not init_file.exists():
            return
        
        module_name = plugin_dir.name
        spec = importlib.util.spec_from_file_location(module_name, init_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        # Find plugin classes in the module
        for name, obj in inspect.getmembers(module):
            if (inspect.isclass(obj) and 
                issubclass(obj, PluginBase) and 
                obj != PluginBase and
                not inspect.isabstract(obj)):
                
                self._register_plugin(obj)
    
    def _register_plugin(self, plugin_class: Type[PluginBase]) -> None:
        """
        Register a plugin class.
        
        Args:
            plugin_class: Plugin class to register
        """
        try:
            # Create plugin instance
            plugin = plugin_class()
            
            # Get plugin info
            info = plugin.get_info()
            
            # Check dependencies
            if not self._check_dependencies(info.dependencies):
                logger.warning(f"Plugin {info.name} has unmet dependencies")
                return
            
            # Initialize plugin
            if plugin.initialize():
                self.plugins[info.name] = plugin
                self.plugin_info[info.name] = info
                logger.info(f"Registered plugin: {info.name} v{info.version}")
            else:
                logger.error(f"Failed to initialize plugin: {info.name}")
                
        except Exception as e:
            logger.error(f"Failed to register plugin {plugin_class.__name__}: {e}")
    
    def _check_dependencies(self, dependencies: List[str]) -> bool:
        """
        Check if plugin dependencies are met.
        
        Args:
            dependencies: List of required dependencies
            
        Returns:
            True if all dependencies are met, False otherwise
        """
        for dep in dependencies:
            try:
                importlib.import_module(dep)
            except ImportError:
                logger.warning(f"Missing dependency: {dep}")
                return False
        return True
    
    def get_plugin(self, name: str) -> Optional[PluginBase]:
        """
        Get a plugin by name.
        
        Args:
            name: Plugin name
            
        Returns:
            Plugin instance or None if not found
        """
        return self.plugins.get(name)
    
    def get_plugins_by_category(self, category: str) -> List[PluginBase]:
        """
        Get all plugins in a specific category.
        
        Args:
            category: Plugin category
            
        Returns:
            List of plugin instances
        """
        return [
            plugin for plugin in self.plugins.values()
            if self.plugin_info[plugin.name].category == category
        ]
    
    def enable_plugin(self, name: str) -> bool:
        """
        Enable a plugin.
        
        Args:
            name: Plugin name
            
        Returns:
            True if plugin was enabled successfully, False otherwise
        """
        plugin = self.plugins.get(name)
        if plugin:
            plugin.enabled = True
            self.plugin_info[name].enabled = True
            logger.info(f"Enabled plugin: {name}")
            return True
        return False
    
    def disable_plugin(self, name: str) -> bool:
        """
        Disable a plugin.
        
        Args:
            name: Plugin name
            
        Returns:
            True if plugin was disabled successfully, False otherwise
        """
        plugin = self.plugins.get(name)
        if plugin:
            plugin.enabled = False
            self.plugin_info[name].enabled = False
            logger.info(f"Disabled plugin: {name}")
            return True
        return False
    
    def unload_plugin(self, name: str) -> bool:
        """
        Unload a plugin.
        
        Args:
            name: Plugin name
            
        Returns:
            True if plugin was unloaded successfully, False otherwise
        """
        plugin = self.plugins.get(name)
        if plugin:
            try:
                plugin.cleanup()
                del self.plugins[name]
                del self.plugin_info[name]
                logger.info(f"Unloaded plugin: {name}")
                return True
            except Exception as e:
                logger.error(f"Failed to unload plugin {name}: {e}")
        return False
    
    def register_hook(self, hook_name: str, callback: Callable) -> None:
        """
        Register a hook callback.
        
        Args:
            hook_name: Name of the hook
            callback: Callback function
        """
        if hook_name not in self.hooks:
            self.hooks[hook_name] = []
        self.hooks[hook_name].append(callback)
    
    def call_hook(self, hook_name: str, *args, **kwargs) -> List[Any]:
        """
        Call all callbacks registered for a hook.
        
        Args:
            hook_name: Name of the hook
            *args: Arguments to pass to callbacks
            **kwargs: Keyword arguments to pass to callbacks
            
        Returns:
            List of results from callbacks
        """
        results = []
        for callback in self.hooks.get(hook_name, []):
            try:
                result = callback(*args, **kwargs)
                results.append(result)
            except Exception as e:
                logger.error(f"Error in hook callback {callback.__name__}: {e}")
        return results
    
    def cleanup(self) -> None:
        """Clean up all plugins."""
        for plugin in self.plugins.values():
            try:
                plugin.cleanup()
            except Exception as e:
                logger.error(f"Error cleaning up plugin {plugin.name}: {e}")

# Global plugin manager instance
_plugin_manager: Optional[PluginManager] = None

def get_plugin_manager() -> PluginManager:
    """
    Get the global plugin manager instance.
    
    Returns:
        PluginManager instance
    """
    global _plugin_manager
    if _plugin_manager is None:
        _plugin_manager = PluginManager()
    return _plugin_manager
