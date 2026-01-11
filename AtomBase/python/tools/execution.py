"""
Terminal Command Execution with Permission System
"""
from langchain_core.tools import tool
import subprocess
import shlex
import os
import json
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict
from config import config
from utils.logger import get_logger

WORKSPACE_DIR = config.workspace.base_dir
logger = get_logger()

# Runtime'da eklenen izinli komutlar
_runtime_allowed_commands = set()

# Bekleyen komut onayları (UI tarafından kontrol edilir)
_pending_command = None
_command_callback = None


class CommandPermissionRequired(Exception):
    """Komut için izin gerektiğinde fırlatılır"""
    def __init__(self, command: str, base_cmd: str):
        self.command = command
        self.base_cmd = base_cmd
        super().__init__(f"Permission required for: {base_cmd}")


def add_allowed_command(cmd: str):
    """Runtime'da izinli komut ekler"""
    _runtime_allowed_commands.add(cmd)
    logger.info(f"Command added to allowed list: {cmd}")


def get_all_allowed_commands() -> list:
    """Tüm izinli komutları döndürür"""
    return list(config.execution.allowed_commands) + list(_runtime_allowed_commands)


def set_command_callback(callback):
    """UI'dan komut onay callback'i ayarlar"""
    global _command_callback
    _command_callback = callback


def _is_command_safe(command: str) -> tuple[bool, str, str]:
    """
    Komutu güvenlik açısından kontrol eder.
    Returns: (is_safe, reason, base_cmd)
    """
    # Blocked patterns kontrolü
    for pattern in config.execution.blocked_patterns:
        if pattern.lower() in command.lower():
            return False, f"Blocked: {pattern}", ""
    
    # Tehlikeli karakterler
    dangerous_chars = [';', '&&', '||', '`', '$(']
    for char in dangerous_chars:
        if char in command:
            return False, f"Dangerous: {char}", ""
    
    # İlk komutun allowed listesinde olup olmadığını kontrol et
    try:
        parts = shlex.split(command)
        if parts:
            base_cmd = os.path.basename(parts[0])
            all_allowed = get_all_allowed_commands()
            
            if base_cmd not in all_allowed:
                return False, f"Not allowed: {base_cmd}", base_cmd
    except ValueError:
        return False, "Invalid syntax", ""
    
    return True, "OK", ""


@tool
def run_terminal_command(command: str) -> str:
    """
    Executes a terminal command in the workspace.
    
    Args:
        command: Command to execute (e.g., 'python script.py')
        
    Returns:
        Command output or error message
    """
    logger.info(f"Command: {command}")
    
    # Güvenlik kontrolü
    is_safe, reason, base_cmd = _is_command_safe(command)
    
    if not is_safe:
        if base_cmd:
            # İzin gerekiyor - özel mesaj döndür
            logger.warning(f"Permission needed: {base_cmd}")
            return f"⚠️ PERMISSION_REQUIRED:{base_cmd}:{command}"
        else:
            # Tamamen engellendi
            logger.warning(f"Blocked: {command}")
            return f"❌ {reason}"
    
    # Güvenli, çalıştır
    return execute_command_direct(command)
