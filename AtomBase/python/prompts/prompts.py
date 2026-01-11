import os

# Project root directory
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
PROMPTS_DIR = os.path.join(PROJECT_ROOT, "prompts")

def load_prompt(name: str) -> str:
    """
    Load a prompt from the prompts directory.
    
    Args:
        name: Name of the prompt file (without extension)
        
    Returns:
        Content of the prompt file
    """
    if not name.endswith('.txt'):
        filename = f"{name}.txt"
    else:
        filename = name
        
    filepath = os.path.join(PROMPTS_DIR, filename)
    
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        # Fallback or error handling
        print(f"Warning: Prompt file used but not found: {filepath}")
        return f"System prompt for {name}"
