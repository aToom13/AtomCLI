from langchain_huggingface import ChatHuggingFace, HuggingFaceEndpoint
from . import ProviderConfig

CONFIG = ProviderConfig(
    name="HuggingFace",
    api_key_env="HUGGINGFACE_API_KEY",
    default_model="meta-llama/Llama-3.1-8B-Instruct"
)

def create_llm(model: str, temperature: float = 0.0, api_key: str = None, **kwargs):
    llm = HuggingFaceEndpoint(repo_id=model, temperature=temperature, huggingfacehub_api_token=api_key)
    return ChatHuggingFace(llm=llm)
