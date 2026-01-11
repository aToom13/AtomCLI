from langchain_groq import ChatGroq
from . import ProviderConfig

CONFIG = ProviderConfig(
    name="Groq",
    api_key_env="GROQ_API_KEY",
    default_model="llama-3.1-70b-versatile"
)

def create_llm(model: str, temperature: float = 0.0, api_key: str = None, **kwargs):
    return ChatGroq(model=model, temperature=temperature, api_key=api_key)
