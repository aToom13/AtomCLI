"""
AtomBase Core - Semantic Version
Simplified for AtomBase
"""
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

from config import config
from core.providers import model_manager, create_llm, is_rate_limit_error, handle_rate_limit
# from prompts import load_prompt # Prompts folder not fully populated yet, might need to copy/simplify
from utils.logger import get_logger

# Tools
from tools.files import write_file, read_file, list_files
from tools.execution import run_terminal_command
from tools.basic import run_neofetch, get_current_time
# from tools.memory import ... # Need to verify memory tool dependencies

logger = get_logger()
_memory_saver = MemorySaver()

_tools = [
    write_file, read_file, list_files,
    run_terminal_command,
    run_neofetch, get_current_time
]

def get_agent_executor():
    """Create agent executor with current model settings"""
    # Simple setup for Base
    llm = model_manager.get_llm("supervisor")
    if not llm:
        from langchain_ollama import ChatOllama
        llm = ChatOllama(model="llama3.2", temperature=0.1)
    
    # Load System Prompt
    from prompts.prompts import load_prompt
    supervisor_prompt = load_prompt("supervisor")
    
    orchestrator = create_react_agent(
        llm,
        _tools,
        prompt=supervisor_prompt,
        checkpointer=_memory_saver
    )
    
    return orchestrator, _memory_saver, supervisor_prompt

def get_thread_config(thread_id: str = "default"):
    return {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": 50
    }
