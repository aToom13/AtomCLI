from langchain_ollama import ChatOllama
from . import ProviderConfig

CONFIG = ProviderConfig(
    name="Ollama (Local)",
    api_key_env="",
    base_url="http://localhost:11434",
    default_model="llama3.2"
)

def create_llm(model: str, temperature: float = 0.0, api_key: str = None, base_url: str = None, **kwargs):
    url = base_url or CONFIG.base_url
    return ChatOllama(model=model, temperature=temperature, base_url=url)
