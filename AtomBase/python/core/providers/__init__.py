"""
LLM Provider System - Modular Version
Aggregates individual provider modules.
"""
import os
import json
import importlib
from typing import Optional, Dict, List
from dotenv import load_dotenv

from utils.logger import get_logger
# Configuration Classes (formerly in base.py)
from dataclasses import dataclass, field

@dataclass
class ProviderConfig:
    """Provider configuration"""
    name: str
    api_key_env: str = ""
    base_url: Optional[str] = None
    default_model: str = ""

@dataclass
class FallbackConfig:
    """Fallback provider configuration"""
    provider: str
    model: str
    
    def to_dict(self):
        return {"provider": self.provider, "model": self.model}
    
    @staticmethod
    def from_dict(data: dict):
        return FallbackConfig(data.get("provider", "ollama"), data.get("model", "llama3.2"))

@dataclass
class AgentModelConfig:
    """Configuration for a specific agent role with fallback support"""
    provider: str = "ollama"
    model: str = "llama3.2"
    temperature: float = 0.0
    fallbacks: List[FallbackConfig] = field(default_factory=list)
    
    def to_dict(self):
        return {
            "provider": self.provider,
            "model": self.model,
            "temperature": self.temperature,
            "fallbacks": [f.to_dict() for f in self.fallbacks]
        }

# Load .env file
load_dotenv()

logger = get_logger()

# Fallback settings file
FALLBACK_SETTINGS_FILE = ".atom_fallback.json"
SETTINGS_FILE = ".atom_settings.json"

# Registered providers map
PROVIDER_MODULES = {
    "ollama": ".ollama",
    "openai": ".openai",
    "anthropic": ".anthropic",
    "google": ".google",
    "openrouter": ".openrouter",
    "huggingface": ".huggingface",
    "cerebras": ".cerebras",
    "xai": ".xai",
    "groq": ".groq",
    "together": ".together"
}

PROVIDERS: Dict[str, ProviderConfig] = {}

# Dynamically load configurations
for name, module_path in PROVIDER_MODULES.items():
    try:
        module = importlib.import_module(module_path, package=__package__)
        PROVIDERS[name] = module.CONFIG
    except ImportError as e:
        logger.warning(f"Could not load provider module {name}: {e}")
    except AttributeError:
        logger.warning(f"Provider module {name} missing CONFIG")


def get_all_api_keys(provider: str) -> List[str]:
    """Get all API keys for a provider"""
    config = PROVIDERS.get(provider)
    if not config or not config.api_key_env:
        return []
    
    keys_str = os.getenv(config.api_key_env, "")
    if not keys_str:
        return []
    
    return [k.strip() for k in keys_str.split(",") if k.strip()]


def get_api_key(provider: str) -> Optional[str]:
    """Get first available API key"""
    keys = get_all_api_keys(provider)
    return keys[0] if keys else None


def check_api_key(provider: str) -> bool:
    if provider == "ollama":
        return True
    return bool(get_api_key(provider))


def create_llm(provider: str, model: str, temperature: float = 0.0):
    """Factory function to create LLM instance"""
    if provider not in PROVIDER_MODULES:
        logger.error(f"Unknown provider: {provider}")
        return None
        
    try:
        module_path = PROVIDER_MODULES[provider]
        module = importlib.import_module(module_path, package=__package__)
        
        api_key = get_api_key(provider)
        if provider != "ollama" and not api_key:
             logger.error(f"API key missing for {provider}")
             return None
             
        return module.create_llm(
            model=model, 
            temperature=temperature, 
            api_key=api_key
        )
    except Exception as e:
        logger.error(f"Failed to create LLM for {provider}: {e}")
        return None

# Re-implement utilities (simplified for brevity but keeping core logic)
def is_rate_limit_error(error: Exception) -> bool:
    error_str = str(error).lower()
    return "rate limit" in error_str or "429" in error_str or "quota" in error_str

def handle_rate_limit(provider: str) -> bool:
    # Simplified version for now
    logger.warning(f"Rate limit handler called for {provider} (impl pending)")
    return False

# Model Manager Class (Simplified adaptation)
class ModelManager:
    ROLES = ["supervisor", "coder", "researcher", "vision", "video", "audio", "tts"]
    
    def __init__(self):
        self.configs: Dict[str, AgentModelConfig] = {
            role: AgentModelConfig() for role in self.ROLES
        }
        self._load_settings()
        self._load_fallback_settings()
    
    def _load_settings(self):
        try:
            if os.path.exists(SETTINGS_FILE):
                with open(SETTINGS_FILE, "r") as f:
                    data = json.load(f)
                
                models = data.get("models", {})
                for role, role_data in models.items():
                    if role in self.configs:
                        self.configs[role].provider = role_data.get("provider", "ollama")
                        self.configs[role].model = role_data.get("model", "llama3.2")
                        self.configs[role].temperature = role_data.get("temperature", 0.0)
        except Exception as e:
            logger.warning(f"Settings load error: {e}")

    def _load_fallback_settings(self):
        try:
            if os.path.exists(FALLBACK_SETTINGS_FILE):
                with open(FALLBACK_SETTINGS_FILE, "r") as f:
                    data = json.load(f)
                for role, role_data in data.items():
                    if role in self.configs:
                        self.configs[role].fallbacks = [
                            FallbackConfig.from_dict(fb) for fb in role_data.get("fallbacks", [])
                        ]
        except Exception as e:
            logger.warning(f"Fallback load error: {e}")

    def get_llm(self, role: str):
        config = self.configs.get(role)
        if not config: return None
        
        # Try primary
        llm = create_llm(config.provider, config.model, config.temperature)
        if llm: return llm
        
        # Try fallbacks
        for fb in config.fallbacks:
            logger.info(f"Using fallback for {role}: {fb.provider}/{fb.model}")
            llm = create_llm(fb.provider, fb.model, config.temperature)
            if llm: return llm
            
        return None

model_manager = ModelManager()
