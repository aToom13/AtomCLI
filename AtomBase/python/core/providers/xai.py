from langchain_openai import ChatOpenAI
from . import ProviderConfig

CONFIG = ProviderConfig(
    name="xAI (Grok)",
    api_key_env="XAI_API_KEY",
    base_url="https://api.x.ai/v1",
    default_model="grok-beta"
)

def create_llm(model: str, temperature: float = 0.0, api_key: str = None, base_url: str = None, **kwargs):
    url = base_url or CONFIG.base_url
    return ChatOpenAI(model=model, temperature=temperature, api_key=api_key, base_url=url)
