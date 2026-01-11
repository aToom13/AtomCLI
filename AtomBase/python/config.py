"""
AtomBase Configuration
Simplification of AtomBase config for early-stage implementation.
"""
import os
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class ModelConfig:
    """LLM Model Ayarları"""
    supervisor: str = "glm-4.6:cloud"
    # supervisor_temp artık .atom_settings.json'dan da yönetilebilir ama burada default kalabilir
    supervisor_temp: float = 0.0

@dataclass
class ExecutionConfig:
    """Komut çalıştırma ayarları"""
    command_timeout: int = 30  # saniye
    max_output_length: int = 10000
    allowed_commands: list = field(default_factory=lambda: [
        "python", "python3", "node", "npm", "pip", "git", 
        "ls", "cat", "head", "tail", "wc", "grep", "find",
        "mkdir", "touch", "echo", "curl", "wget", "ollama",
         "cd", "ls", "mv",  "cp", "npm", "npx"
    ])
    blocked_patterns: list = field(default_factory=lambda: [
        "rm -rf /", "sudo", "chmod 777", ":(){ :|:& };:",
        "> /dev/", "mkfs", "dd if=", "shutdown", "reboot"
    ])

@dataclass
class WorkspaceConfig:
    """Workspace ayarları"""
    base_dir: str = field(default_factory=lambda: os.path.abspath("atom_workspace"))
    max_file_size: int = 1024 * 1024  # 1MB
    allowed_extensions: list = field(default_factory=lambda: [
        ".py", ".js", ".ts", ".json", ".md", ".txt", ".html", 
        ".css", ".yaml", ".yml", ".toml", ".sh", ".sql"
    ])

@dataclass
class MemoryConfig:
    """Memory/Checkpoint ayarları"""
    checkpoint_dir: str = field(default_factory=lambda: os.path.abspath(".atom_checkpoints"))
    max_history_messages: int = 20
    summary_token_limit: int = 1000

@dataclass 
class Config:
    """Ana konfigürasyon sınıfı"""
    models: ModelConfig = field(default_factory=ModelConfig)
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    workspace: WorkspaceConfig = field(default_factory=WorkspaceConfig)
    memory: MemoryConfig = field(default_factory=MemoryConfig)
    
    # Logging
    log_level: str = "INFO"
    log_file: Optional[str] = "atombase.log"
    log_to_console: bool = True

# Global config instance
config = Config()

# Workspace dizinini oluştur
os.makedirs(config.workspace.base_dir, exist_ok=True)
os.makedirs(config.memory.checkpoint_dir, exist_ok=True)
