from langchain_google_genai import ChatGoogleGenerativeAI
from . import ProviderConfig

CONFIG = ProviderConfig(
    name="Google (Gemini)",
    api_key_env="GOOGLE_API_KEY",
    default_model="ggemini-3-flash-preview"
)

def create_llm(model: str, temperature: float = 0.0, api_key: str = None, **kwargs):
    return ChatGoogleGenerativeAI(model=model, temperature=temperature, google_api_key=api_key)
