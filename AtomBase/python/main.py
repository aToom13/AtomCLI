"""
AtomBase - CLI Entry Point
"""
import sys
import uuid
import asyncio
from core.agent import get_agent_executor, get_thread_config
from utils.logger import get_logger

logger = get_logger()

# Renkler
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

async def main():
    print(f"{Colors.HEADER}{Colors.BOLD}AtomBase v0.1 - CLI Agent{Colors.ENDC}")
    print(f"{Colors.CYAN}Başlatılıyor...{Colors.ENDC}")
    
    try:
        agent, memory, system_prompt = get_agent_executor()
        thread_id = str(uuid.uuid4())[:8]
        config = get_thread_config(thread_id)
        
        print(f"{Colors.GREEN}Sistem Hazır! (Oturum: {thread_id}){Colors.ENDC}")
        print("Çıkmak için 'exit' veya 'quit' yazın.\n")
        
        while True:
            try:
                user_input = input(f"{Colors.BLUE}Sen: {Colors.ENDC}").strip()
                
                if not user_input:
                    continue
                    
                if user_input.lower() in ['exit', 'quit', 'q']:
                    print(f"{Colors.CYAN}Görüşürüz!{Colors.ENDC}")
                    break
                
                print(f"{Colors.WARNING}AtomBase Düşünüyor...{Colors.ENDC}")
                
                # Stream responses
                async for event in agent.astream_events(
                    {"messages": [("user", user_input)]},
                    config,
                    version="v1"
                ):
                    kind = event["event"]
                    
                    if kind == "on_chat_model_stream":
                        chunk = event["data"]["chunk"]
                        content = chunk.content
                        
                        if content:
                            if isinstance(content, str):
                                print(content, end="", flush=True)
                            elif isinstance(content, list):
                                for item in content:
                                    if isinstance(item, dict) and "text" in item:
                                        print(item["text"], end="", flush=True)
                                    elif isinstance(item, str):
                                        print(item, end="", flush=True)
                            
            except KeyboardInterrupt:
                print("\nİşlem iptal edildi.")
                continue
            except Exception as e:
                print(f"\n{Colors.FAIL}Hata: {str(e)}{Colors.ENDC}")
                
            print("\n") # New line after response
            
    except Exception as e:
        print(f"{Colors.FAIL}Kritik Başlangıç Hatası: {str(e)}{Colors.ENDC}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
