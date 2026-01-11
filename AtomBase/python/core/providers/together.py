from langchain_openai import ChatOpenAI
from . import ProviderConfig

CONFIG = ProviderConfig(
    name="Together AI",
    api_key_env="TOGETHER_API_KEY",
    base_url="https://api.together.xyz/v1",
    default_model="meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo"
)

def create_llm(model: str, temperature: float = 0.0, api_key: str = None, base_url: str = None, **kwargs):
    url = base_url or CONFIG.base_url
    return ChatOpenAI(model=model, temperature=temperature, api_key=api_key, base_url=url)
