import os
from typing import List, Optional
from langchain_core.tools import tool
from config import config
from utils.logger import get_logger

WORKSPACE_DIR = config.workspace.base_dir
logger = get_logger()

def _get_safe_path(filename: str) -> str:
    """Ensures the path is within the workspace directory."""
    file_path = os.path.abspath(os.path.join(WORKSPACE_DIR, filename))
    if not file_path.startswith(WORKSPACE_DIR):
        logger.warning(f"Access denied attempt: {filename}")
        raise ValueError(f"Access denied: {filename} is outside the workspace.")
    return file_path

@tool
def write_file(filename: str, content: str) -> str:
    """
    Writes content to a file in the workspace.
    Overwrites the file if it exists.
    """
    try:
        file_path = _get_safe_path(filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Successfully wrote to {filename}"
    except Exception as e:
        return f"Error writing file: {e}"

@tool
def read_file(filename: str) -> str:
    """
    Reads content from a file in the workspace.
    """
    try:
        file_path = _get_safe_path(filename)
        if not os.path.exists(file_path):
            return f"Error: File {filename} does not exist."
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {e}"

@tool
def list_files(directory: str = ".") -> str:
    """Lists files in the workspace directory."""
    try:
        dir_path = _get_safe_path(directory)
        if not os.path.exists(dir_path):
            return f"Error: Directory {directory} does not exist."
        
        files = []
        for root, _, filenames in os.walk(dir_path):
            for filename in filenames:
                rel_path = os.path.relpath(os.path.join(root, filename), WORKSPACE_DIR)
                files.append(rel_path)
        
        return "\n".join(files) if files else "Empty"
    except Exception as e:
        return f"Error: {e}"


@tool
def scan_workspace(max_depth: int = 2) -> str:
    """
    Scans workspace and returns file tree.
    
    Args:
        max_depth: Max directory depth (default 2)
    """
    if not os.path.exists(WORKSPACE_DIR):
        return "Workspace yok"
    
    if not os.listdir(WORKSPACE_DIR):
        return "Workspace boş"
    
    ignore = {'__pycache__', '.git', 'node_modules', '.venv', 'venv'}
    lines = []
    
    for root, dirs, files in os.walk(WORKSPACE_DIR):
        level = root.replace(WORKSPACE_DIR, '').count(os.sep)
        if level >= max_depth:
            dirs[:] = []
            continue
        
        dirs[:] = [d for d in dirs if d not in ignore]
        indent = "  " * level
        
        if level > 0:
            lines.append(f"{indent}📁 {os.path.basename(root)}/")
        
        for f in files:
            if f not in ignore:
                lines.append(f"{indent}  📄 {f}")
    
    return "\n".join(lines) if lines else "Boş"

@tool
def create_directory(directory_path: str) -> str:
    """
    Creates a new directory in the workspace.
    Creates parent directories if they don't exist.
    """
    try:
        dir_path = _get_safe_path(directory_path)
        os.makedirs(dir_path, exist_ok=True)
        logger.info(f"Directory created: {directory_path}")
        return f"Directory '{directory_path}' created successfully."
    except Exception as e:
        logger.error(f"Error creating directory {directory_path}: {e}")
        return f"Error creating directory: {e}"

@tool
def delete_file(filename: str) -> str:
    """
    Deletes a file from the workspace.
    Use with caution - this action cannot be undone.
    
    Args:
        filename: Path to the file to delete (relative to workspace)
    
    Returns:
        Success or error message
    """
    try:
        file_path = _get_safe_path(filename)
        
        if not os.path.exists(file_path):
            return f"Error: File '{filename}' does not exist."
        
        if os.path.isdir(file_path):
            return f"Error: '{filename}' is a directory. Use delete_directory instead."
        
        os.remove(file_path)
        logger.info(f"File deleted: {filename}")
        return f"Successfully deleted '{filename}'"
        
    except Exception as e:
        logger.error(f"Error deleting file {filename}: {e}")
        return f"Error deleting file: {e}"

@tool
def delete_directory(directory_path: str, force: bool = False) -> str:
    """
    Deletes a directory from the workspace.
    
    Args:
        directory_path: Path to the directory to delete (relative to workspace)
        force: If True, delete even if directory is not empty
    
    Returns:
        Success or error message
    """
    import shutil
    
    try:
        dir_path = _get_safe_path(directory_path)
        
        if not os.path.exists(dir_path):
            return f"Error: Directory '{directory_path}' does not exist."
        
        if not os.path.isdir(dir_path):
            return f"Error: '{directory_path}' is not a directory."
        
        if force:
            shutil.rmtree(dir_path)
        else:
            os.rmdir(dir_path)  # Only works if empty
            
        logger.info(f"Directory deleted: {directory_path}")
        return f"Successfully deleted directory '{directory_path}'"
        
    except OSError as e:
        if "not empty" in str(e).lower() or "directory not empty" in str(e).lower():
            return f"Error: Directory '{directory_path}' is not empty. Use force=True to delete anyway."
        logger.error(f"Error deleting directory {directory_path}: {e}")
        return f"Error deleting directory: {e}"
    except Exception as e:
        logger.error(f"Error deleting directory {directory_path}: {e}")
        return f"Error deleting directory: {e}"
