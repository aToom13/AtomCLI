from langchain_openai import ChatOpenAI
from . import ProviderConfig

CONFIG = ProviderConfig(
    name="OpenAI",
    api_key_env="OPENAI_API_KEY",
    default_model="gpt-4o-mini"
)

def create_llm(model: str, temperature: float = 0.0, api_key: str = None, **kwargs):
    return ChatOpenAI(model=model, temperature=temperature, api_key=api_key)
