import datetime
import platform
import subprocess
import shutil
from langchain_core.tools import tool


@tool
def get_current_time():
    """Returns the current local time formatted as YYYY-MM-DD HH:MM:SS."""
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@tool
def get_system_info():
    """Returns basic system information (OS, Node, Release)."""
    return f"System: {platform.system()}, Node: {platform.node()}, Release: {platform.release()}"


@tool
def run_neofetch():
    """Runs neofetch to display system info with ASCII art."""
    if shutil.which("neofetch"):
        try:
            result = subprocess.run(
                ["neofetch", "--color_blocks", "on", "--stdout"],
                capture_output=True,
                text=True,
                check=True
            )
            return result.stdout
        except subprocess.CalledProcessError as e:
            return f"Error: {e}"
    else:
        return "Neofetch is not installed.on this system. Please install it to see the logo and specs."
