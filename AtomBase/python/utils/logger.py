"""
AtomBase Logging System
Merkezi loglama altyapısı.
"""
import logging
import sys
import json
from datetime import datetime
from pathlib import Path
from typing import Optional
from functools import wraps
import traceback

class ColoredFormatter(logging.Formatter):
    """Renkli log formatı"""
    
    COLORS = {
        'DEBUG': '\033[36m',     # Cyan
        'INFO': '\033[32m',      # Green
        'WARNING': '\033[33m',   # Yellow
        'ERROR': '\033[31m',     # Red
        'CRITICAL': '\033[35m',  # Magenta
        'RESET': '\033[0m'
    }
    
    def format(self, record):
        color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
        reset = self.COLORS['RESET']
        record.levelname = f"{color}{record.levelname}{reset}"
        return super().format(record)

class JSONFormatter(logging.Formatter):
    """JSON log formatı"""
    def format(self, record):
        log_obj = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "message": record.getMessage(),
        }
        
        if record.exc_info:
            log_obj["exception"] = self.formatException(record.exc_info)
            
        # Extra fields
        for key, value in record.__dict__.items():
            if key not in ["args", "asctime", "created", "exc_info", "exc_text", "filename", 
                          "funcName", "levelname", "levelno", "lineno", "module", "msecs", 
                          "message", "msg", "name", "pathname", "process", "processName", 
                          "relativeCreated", "stack_info", "thread", "threadName"]:
                log_obj[key] = value
                
        return json.dumps(log_obj, ensure_ascii=False)

class AtomLogger:
    """AtomBase için özelleştirilmiş logger"""
    
    _instance: Optional['AtomLogger'] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
            
        self._initialized = True
        self.logger = logging.getLogger("AtomBase")
        self.logger.setLevel(logging.DEBUG)
        self.logger.handlers.clear()
        
        # Import config here to avoid circular import
        from config import config
        
        # File handler (JSON)
        if config.log_file:
            file_handler = logging.FileHandler(config.log_file, encoding='utf-8')
            file_handler.setLevel(getattr(logging, config.log_level))
            file_handler.setFormatter(JSONFormatter())
            self.logger.addHandler(file_handler)
        
        # Console handler (optional)
        if config.log_to_console:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(getattr(logging, config.log_level))
            console_handler.setFormatter(ColoredFormatter(
                '%(asctime)s | %(levelname)s | %(message)s',
                datefmt='%H:%M:%S'
            ))
            self.logger.addHandler(console_handler)
    
    def debug(self, msg: str, **kwargs):
        self.logger.debug(msg, extra=kwargs)
    
    def info(self, msg: str, **kwargs):
        self.logger.info(msg, extra=kwargs)
    
    def warning(self, msg: str, **kwargs):
        self.logger.warning(msg, extra=kwargs)
    
    def error(self, msg: str, exc_info: bool = False, **kwargs):
        self.logger.error(msg, exc_info=exc_info, extra=kwargs)
    
    def critical(self, msg: str, exc_info: bool = True, **kwargs):
        self.logger.critical(msg, exc_info=exc_info, extra=kwargs)
    
    def tool_start(self, tool_name: str, agent: str = "", inputs: dict = None):
        """Tool başlangıcını logla"""
        self.info(f"🔧 TOOL_START | {agent}/{tool_name} | inputs={inputs}")
    
    def tool_end(self, tool_name: str, agent: str = "", output_preview: str = ""):
        """Tool bitişini logla"""
        preview = output_preview[:200] + "..." if len(output_preview) > 200 else output_preview
        self.info(f"✅ TOOL_END | {agent}/{tool_name} | output={preview}")
    
    def agent_route(self, from_agent: str, to_agent: str, reason: str = ""):
        """Agent yönlendirmesini logla"""
        self.info(f"🔀 ROUTE | {from_agent} -> {to_agent} | reason={reason}")
    
    def user_input(self, message: str):
        """Kullanıcı girdisini logla"""
        self.info(f"👤 USER | {message[:100]}...")
    
    def agent_response(self, agent: str, response: str):
        """Agent yanıtını logla"""
        preview = response[:200] + "..." if len(response) > 200 else response
        self.info(f"🤖 {agent} | {preview}")

def log_execution(func):
    """Fonksiyon çalışmasını loglayan decorator"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        logger = get_logger()
        func_name = func.__name__
        logger.debug(f"Executing {func_name} with args={args[:2]}... kwargs={list(kwargs.keys())}")
        try:
            result = func(*args, **kwargs)
            logger.debug(f"Completed {func_name}")
            return result
        except Exception as e:
            logger.error(f"Error in {func_name}: {e}", exc_info=True)
            raise
    return wrapper

def get_logger() -> AtomLogger:
    """Global logger instance döndür"""
    return AtomLogger()
