"""
Error handling and exception management for the Facebook OSINT tool.

This module provides custom exceptions, error handling decorators,
and centralized error reporting functionality.
"""

import traceback
import sys
from typing import Optional, Callable, Any, Dict
from functools import wraps
from enum import Enum

from src.utils.logger import get_logger

logger = get_logger(__name__)

class ErrorSeverity(Enum):
    """Error severity levels."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class PPFaceError(Exception):
    """Base exception class for PPFace application."""
    
    def __init__(self, message: str, error_code: Optional[str] = None, 
                 severity: ErrorSeverity = ErrorSeverity.MEDIUM, 
                 details: Optional[Dict[str, Any]] = None):
        """
        Initialize PPFace error.
        
        Args:
            message: Error message
            error_code: Unique error code
            severity: Error severity level
            details: Additional error details
        """
        super().__init__(message)
        self.message = message
        self.error_code = error_code or self.__class__.__name__
        self.severity = severity
        self.details = details or {}
        self.timestamp = None
        
        # Log the error
        self._log_error()
    
    def _log_error(self):
        """Log the error with appropriate level."""
        error_info = {
            "error_code": self.error_code,
            "severity": self.severity.value,
            "details": self.details,
            "traceback": traceback.format_exc()
        }
        
        if self.severity == ErrorSeverity.CRITICAL:
            logger.critical(f"{self.message} | {error_info}")
        elif self.severity == ErrorSeverity.HIGH:
            logger.error(f"{self.message} | {error_info}")
        elif self.severity == ErrorSeverity.MEDIUM:
            logger.warning(f"{self.message} | {error_info}")
        else:
            logger.info(f"{self.message} | {error_info}")

class ConfigurationError(PPFaceError):
    """Exception raised for configuration-related errors."""
    pass

class DatabaseError(PPFaceError):
    """Exception raised for database-related errors."""
    pass

class ScrapingError(PPFaceError):
    """Exception raised for web scraping errors."""
    pass

class AnalysisError(PPFaceError):
    """Exception raised for analysis engine errors."""
    pass

class SecurityError(PPFaceError):
    """Exception raised for security-related errors."""
    pass

class ValidationError(PPFaceError):
    """Exception raised for data validation errors."""
    pass

class RateLimitError(ScrapingError):
    """Exception raised when rate limits are hit."""
    pass

class AuthenticationError(SecurityError):
    """Exception raised for authentication failures."""
    pass

class PluginError(PPFaceError):
    """Exception raised for plugin-related errors."""
    pass

def handle_errors(reraise: bool = True, 
                 default_return: Any = None,
                 error_types: tuple = (Exception,)):
    """
    Decorator to handle errors in functions.
    
    Args:
        reraise: Whether to reraise the exception after handling
        default_return: Default value to return if error occurs and not reraising
        error_types: Tuple of exception types to catch
        
    Returns:
        Decorated function
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except error_types as e:
                func_logger = get_logger(func.__module__)
                
                # Create error context
                error_context = {
                    "function": func.__name__,
                    "args": str(args)[:100],  # Limit length
                    "kwargs": str(kwargs)[:100],
                    "error_type": type(e).__name__,
                    "error_message": str(e)
                }
                
                func_logger.error(f"Error in {func.__name__}: {e}", extra=error_context)
                
                if reraise:
                    raise
                else:
                    return default_return
        
        return wrapper
    return decorator

def safe_execute(func: Callable, *args, 
                default_return: Any = None,
                log_errors: bool = True,
                **kwargs) -> Any:
    """
    Safely execute a function with error handling.
    
    Args:
        func: Function to execute
        *args: Function arguments
        default_return: Default value to return on error
        log_errors: Whether to log errors
        **kwargs: Function keyword arguments
        
    Returns:
        Function result or default_return on error
    """
    try:
        return func(*args, **kwargs)
    except Exception as e:
        if log_errors:
            logger.error(f"Error executing {func.__name__}: {e}")
        return default_return

def validate_input(validation_func: Callable, 
                  error_message: str = "Input validation failed"):
    """
    Decorator to validate function inputs.
    
    Args:
        validation_func: Function that takes same args as decorated function and returns bool
        error_message: Error message to raise if validation fails
        
    Returns:
        Decorated function
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            if not validation_func(*args, **kwargs):
                raise ValidationError(
                    error_message,
                    error_code="VALIDATION_FAILED",
                    severity=ErrorSeverity.MEDIUM,
                    details={"function": func.__name__, "args": args, "kwargs": kwargs}
                )
            return func(*args, **kwargs)
        return wrapper
    return decorator

def retry_on_error(max_retries: int = 3, 
                  delay: float = 1.0,
                  backoff_factor: float = 2.0,
                  exceptions: tuple = (Exception,)):
    """
    Decorator to retry function on specific exceptions.
    
    Args:
        max_retries: Maximum number of retry attempts
        delay: Initial delay between retries in seconds
        backoff_factor: Factor to multiply delay by after each retry
        exceptions: Tuple of exception types to retry on
        
    Returns:
        Decorated function
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            import time
            
            last_exception = None
            current_delay = delay
            
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    
                    if attempt < max_retries:
                        logger.warning(f"Attempt {attempt + 1} failed for {func.__name__}: {e}. "
                                     f"Retrying in {current_delay} seconds...")
                        time.sleep(current_delay)
                        current_delay *= backoff_factor
                    else:
                        logger.error(f"All {max_retries + 1} attempts failed for {func.__name__}")
                        break
            
            # If we get here, all retries failed
            raise last_exception
        
        return wrapper
    return decorator

class ErrorReporter:
    """Class for collecting and reporting errors."""
    
    def __init__(self):
        """Initialize error reporter."""
        self.errors: list = []
        self.error_counts: Dict[str, int] = {}
    
    def report_error(self, error: Exception, context: Optional[Dict[str, Any]] = None):
        """
        Report an error.
        
        Args:
            error: Exception that occurred
            context: Additional context information
        """
        error_info = {
            "type": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(),
            "context": context or {},
            "timestamp": None
        }
        
        self.errors.append(error_info)
        
        # Update error counts
        error_type = type(error).__name__
        self.error_counts[error_type] = self.error_counts.get(error_type, 0) + 1
        
        logger.error(f"Error reported: {error_info}")
    
    def get_error_summary(self) -> Dict[str, Any]:
        """
        Get summary of reported errors.
        
        Returns:
            Dictionary with error summary
        """
        return {
            "total_errors": len(self.errors),
            "error_counts": self.error_counts.copy(),
            "recent_errors": self.errors[-10:] if self.errors else []
        }
    
    def clear_errors(self):
        """Clear all reported errors."""
        self.errors.clear()
        self.error_counts.clear()

# Global error reporter instance
_error_reporter: Optional[ErrorReporter] = None

def get_error_reporter() -> ErrorReporter:
    """
    Get the global error reporter instance.
    
    Returns:
        ErrorReporter instance
    """
    global _error_reporter
    if _error_reporter is None:
        _error_reporter = ErrorReporter()
    return _error_reporter

def setup_global_exception_handler():
    """Set up global exception handler for unhandled exceptions."""
    def handle_exception(exc_type, exc_value, exc_traceback):
        if issubclass(exc_type, KeyboardInterrupt):
            # Allow keyboard interrupt to proceed normally
            sys.__excepthook__(exc_type, exc_value, exc_traceback)
            return
        
        logger.critical(
            "Unhandled exception occurred",
            exc_info=(exc_type, exc_value, exc_traceback)
        )
        
        # Report to error reporter
        get_error_reporter().report_error(
            exc_value,
            {"type": "unhandled_exception", "traceback": exc_traceback}
        )
    
    sys.excepthook = handle_exception

# Initialize global exception handler
setup_global_exception_handler()
