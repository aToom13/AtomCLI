from langchain_anthropic import ChatAnthropic
from . import ProviderConfig

CONFIG = ProviderConfig(
    name="Anthropic (Claude)",
    api_key_env="ANTHROPIC_API_KEY",
    default_model="claude-3-5-sonnet-20241022"
)

def create_llm(model: str, temperature: float = 0.0, api_key: str = None, **kwargs):
    return ChatAnthropic(model=model, temperature=temperature, api_key=api_key)
