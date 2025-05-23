"""
Logging configuration and utilities for the Facebook OSINT tool.

This module provides centralized logging configuration using loguru,
with support for different log levels, file rotation, and structured logging.
"""

import os
import sys
from pathlib import Path
from loguru import logger
from typing import Optional, Dict, Any

class LoggerConfig:
    """Configuration class for logging setup."""
    
    def __init__(self, 
                 log_level: str = "INFO",
                 log_dir: str = "logs",
                 log_file: str = "ppface.log",
                 max_file_size: str = "10 MB",
                 retention: str = "1 week",
                 rotation: str = "1 day",
                 console_output: bool = True,
                 structured_logging: bool = True):
        """
        Initialize logger configuration.
        
        Args:
            log_level: Minimum log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
            log_dir: Directory for log files
            log_file: Name of the log file
            max_file_size: Maximum size before rotation
            retention: How long to keep old log files
            rotation: When to rotate log files
            console_output: Whether to output logs to console
            structured_logging: Whether to use structured JSON logging
        """
        self.log_level = log_level
        self.log_dir = Path(log_dir)
        self.log_file = log_file
        self.max_file_size = max_file_size
        self.retention = retention
        self.rotation = rotation
        self.console_output = console_output
        self.structured_logging = structured_logging
        
        # Ensure log directory exists
        self.log_dir.mkdir(exist_ok=True)

def setup_logger(config: Optional[LoggerConfig] = None) -> None:
    """
    Set up the logger with the given configuration.
    
    Args:
        config: Logger configuration object. If None, uses defaults.
    """
    if config is None:
        config = LoggerConfig()
    
    # Remove default logger
    logger.remove()
    
    # Console handler
    if config.console_output:
        console_format = (
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        )
        logger.add(
            sys.stdout,
            format=console_format,
            level=config.log_level,
            colorize=True
        )
    
    # File handler
    log_file_path = config.log_dir / config.log_file
    
    if config.structured_logging:
        # JSON format for structured logging
        file_format = (
            "{{"
            '"timestamp": "{time:YYYY-MM-DD HH:mm:ss.SSS}", '
            '"level": "{level}", '
            '"module": "{name}", '
            '"function": "{function}", '
            '"line": {line}, '
            '"message": "{message}"'
            "}}"
        )
    else:
        # Human-readable format
        file_format = (
            "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | "
            "{name}:{function}:{line} | {message}"
        )
    
    logger.add(
        log_file_path,
        format=file_format,
        level=config.log_level,
        rotation=config.rotation,
        retention=config.retention,
        compression="zip",
        encoding="utf-8"
    )
    
    # Add error-specific log file
    error_log_path = config.log_dir / f"error_{config.log_file}"
    logger.add(
        error_log_path,
        format=file_format,
        level="ERROR",
        rotation=config.rotation,
        retention=config.retention,
        compression="zip",
        encoding="utf-8"
    )

def get_logger(name: str = None) -> logger:
    """
    Get a logger instance with the specified name.
    
    Args:
        name: Name for the logger. If None, uses the calling module name.
        
    Returns:
        Logger instance
    """
    if name is None:
        import inspect
        frame = inspect.currentframe().f_back
        name = frame.f_globals.get('__name__', 'unknown')
    
    return logger.bind(name=name)

def log_function_call(func):
    """
    Decorator to log function calls with parameters and return values.
    
    Args:
        func: Function to decorate
        
    Returns:
        Decorated function
    """
    def wrapper(*args, **kwargs):
        func_logger = get_logger(func.__module__)
        func_logger.debug(f"Calling {func.__name__} with args={args}, kwargs={kwargs}")
        
        try:
            result = func(*args, **kwargs)
            func_logger.debug(f"{func.__name__} returned: {result}")
            return result
        except Exception as e:
            func_logger.error(f"{func.__name__} raised {type(e).__name__}: {e}")
            raise
    
    return wrapper

def log_performance(func):
    """
    Decorator to log function execution time.
    
    Args:
        func: Function to decorate
        
    Returns:
        Decorated function
    """
    import time
    
    def wrapper(*args, **kwargs):
        func_logger = get_logger(func.__module__)
        start_time = time.time()
        
        try:
            result = func(*args, **kwargs)
            execution_time = time.time() - start_time
            func_logger.info(f"{func.__name__} executed in {execution_time:.4f} seconds")
            return result
        except Exception as e:
            execution_time = time.time() - start_time
            func_logger.error(f"{func.__name__} failed after {execution_time:.4f} seconds: {e}")
            raise
    
    return wrapper

# Initialize default logger
try:
    setup_logger()
    get_logger(__name__).info("Logger initialized successfully")
except Exception as e:
    print(f"Failed to initialize logger: {e}")
    # Fallback to basic logging
    import logging
    logging.basicConfig(level=logging.INFO)
