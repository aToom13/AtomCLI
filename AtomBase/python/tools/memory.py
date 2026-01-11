"""
Simplified Memory System for AtomBase
Focuses on conversation context and basic persistence.
"""
import os
import json
from datetime import datetime
from typing import List, Dict, Optional
from langchain_core.tools import tool

from config import config
from utils.logger import get_logger

logger = get_logger()

MEMORY_DIR = os.path.join(config.workspace.base_dir, ".memory")
CONTEXT_FILE = os.path.join(MEMORY_DIR, "context.json")
SUMMARY_FILE = os.path.join(MEMORY_DIR, "summary.json")

# Ensure memory directory exists
os.makedirs(MEMORY_DIR, exist_ok=True)


class ConversationMemory:
    """Basic conversation memory with summarization and context persistence."""
    
    def __init__(self, max_messages: int = 20, summary_threshold: int = 15):
        self.max_messages = max_messages
        self.summary_threshold = summary_threshold
        self.messages: List[Dict] = []
        self.summaries: List[str] = []
        self.context: Dict = {}
        self._load()
    
    def _load(self):
        """Load memory from disk."""
        try:
            if os.path.exists(CONTEXT_FILE):
                with open(CONTEXT_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.messages = data.get("messages", [])
                    self.context = data.get("context", {})
            
            if os.path.exists(SUMMARY_FILE):
                with open(SUMMARY_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.summaries = data.get("summaries", [])
        except Exception as e:
            logger.warning(f"Memory load failed: {e}")
    
    def _save(self):
        """Save memory to disk."""
        try:
            with open(CONTEXT_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "messages": self.messages[-self.max_messages:],
                    "context": self.context,
                    "updated": datetime.now().isoformat()
                }, f, ensure_ascii=False, indent=2)
            
            with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "summaries": self.summaries[-10:],
                    "updated": datetime.now().isoformat()
                }, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Memory save failed: {e}")
    
    def add_message(self, role: str, content: str):
        """Add a message to memory."""
        self.messages.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })
        
        if len(self.messages) >= self.summary_threshold:
            self._summarize_old_messages()
        
        self._save()
    
    def _summarize_old_messages(self):
        """Summarize older messages to save context window."""
        if len(self.messages) < self.summary_threshold:
            return
        
        half = len(self.messages) // 2
        old_messages = self.messages[:half]
        
        summary_parts = []
        for msg in old_messages:
            role = msg["role"]
            content = msg["content"][:100]
            summary_parts.append(f"{role}: {content}")
        
        summary = " | ".join(summary_parts)
        self.summaries.append({
            "summary": summary,
            "message_count": half,
            "timestamp": datetime.now().isoformat()
        })
        
        self.messages = self.messages[half:]
        logger.info(f"Summarized {half} messages")
    
    def get_context_messages(self) -> List[Dict]:
        """Get messages formatted for context."""
        context_msgs = []
        
        if self.summaries:
            summary_text = "Previous conversation summary:\n"
            for s in self.summaries[-3:]:
                summary_text += f"- {s['summary'][:200]}\n"
            context_msgs.append({
                "role": "system",
                "content": summary_text
            })
        
        context_msgs.extend(self.messages[-self.max_messages:])
        return context_msgs
    
    def set_context(self, key: str, value: str):
        """Set a persistent context value."""
        self.context[key] = {
            "value": value,
            "timestamp": datetime.now().isoformat()
        }
        self._save()
    
    def get_context(self, key: str) -> Optional[str]:
        """Get a persistent context value."""
        if key in self.context:
            return self.context[key]["value"]
        return None
    
    def clear(self):
        """Clear all memory."""
        self.messages = []
        self.summaries = []
        self.context = {}
        self._save()
        logger.info("Memory cleared")
    
    def get_stats(self) -> Dict:
        """Get memory statistics."""
        return {
            "message_count": len(self.messages),
            "summary_count": len(self.summaries),
            "context_keys": list(self.context.keys()),
            "estimated_tokens": sum(len(m["content"]) // 4 for m in self.messages)
        }


# Global memory instance
_memory = ConversationMemory()


@tool
def save_context(key: str, value: str) -> str:
    """
    Save important information to persistent memory.
    
    Args:
        key: Information key (e.g. "project_name", "preferred_style")
        value: The value to save
    """
    _memory.set_context(key, value)
    logger.info(f"Context saved: {key}")
    return f"✓ '{key}' saved to memory"


@tool
def get_context_info(key: str) -> str:
    """
    Retrieve information from persistent memory.
    
    Args:
        key: Information key
    """
    value = _memory.get_context(key)
    if value:
        return value
    return f"'{key}' not found in memory"


@tool
def get_memory_stats() -> str:
    """Show memory statistics."""
    stats = _memory.get_stats()
    return f"""📊 Memory Stats:
- Messages: {stats['message_count']}
- Summaries: {stats['summary_count']}
- Context Keys: {', '.join(stats['context_keys']) or 'none'}
- Estimated Tokens: ~{stats['estimated_tokens']}"""


@tool
def clear_memory() -> str:
    """Clear conversation memory. Use when starting a completely new task."""
    _memory.clear()
    return "✓ Memory cleared"


# Internal helpers
def add_to_memory(role: str, content: str):
    _memory.add_message(role, content)


def get_memory_context() -> List[Dict]:
    return _memory.get_context_messages()


def get_persistent_context() -> str:
    if not _memory.context:
        return ""
    
    lines = ["[Persistent Context]"]
    for key, data in _memory.context.items():
        lines.append(f"- {key}: {data['value']}")
    
    return "\n".join(lines)
