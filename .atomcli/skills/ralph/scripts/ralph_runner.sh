#!/bin/bash

# Configuration
MAX_RETRIES=3
PARALLEL_LIMIT=1 # Default to sequential
LOG_FILE="ralph_runner.log"

# Function to run a single task
run_task() {
    local task="$1"
    local attempt=1
    local success=false

    echo "[Ralph] Starting Task: $task" | tee -a "$LOG_FILE"

    while [ $attempt -le $MAX_RETRIES ]; do
        # Here we invoke the atomcli to perform the task
        # We pass the task as a prompt to the generic agent or a specific skill context
        # Ideally, we use 'atomcli' command if available, or just verify the plan
        
        # NOTE: Since we are inside the agent, spawning another full agent might be heavy.
        # Ideally this connects to an API or CLI. Assuming 'atomcli' CLI is available.
        
        echo "[Ralph] Attempt $attempt/$MAX_RETRIES..." | tee -a "$LOG_FILE"
        
        # Execute the task using atomcli (simulated here with a placeholder)
        # In a real scenario, this would be: 
        # atomcli run "$task" --approve-all
        
        # Execute the task using atomcli
        # We removed invalid flags (--approve-all --max-turns) that caused failures.
        # We simply pass the task message to the CLI.
        
        if atomcli run "$task"; then
             echo "[Ralph] Task Complete: $task" | tee -a "$LOG_FILE"
             success=true
             break
        else
             echo "[Ralph] Task Failed, retrying..." | tee -a "$LOG_FILE"
             ((attempt++))
             sleep 2
        fi
    done

    if [ "$success" = false ]; then
        echo "[Ralph] Task Failed after $MAX_RETRIES attempts: $task" | tee -a "$LOG_FILE"
        exit 1
    fi
}

# Parse Arguments
PROMPT_FILE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --parallel)
            PARALLEL_LIMIT=${2:-3}
            shift 2
            ;;
        --file)
            PROMPT_FILE="$2"
            shift 2
            ;;
        *)
            # Assume it's a direct task string if not a flag
            SINGLE_TASK="$1"
            shift
            ;;
    esac
done

# Main Execution
echo "--- Ralph Runner Initiated ---" > "$LOG_FILE"

if [ -n "$SINGLE_TASK" ]; then
    run_task "$SINGLE_TASK"
elif [ -n "$PROMPT_FILE" ] && [ -f "$PROMPT_FILE" ]; then
    # Read tasks from file
    # If parallel, use xargs or background jobs
    if [ "$PARALLEL_LIMIT" -gt 1 ]; then
        echo "[Ralph] Running in PARALLEL (Max $PARALLEL_LIMIT)"
        export -f run_task
        export MAX_RETRIES LOG_FILE
        # Use GNU parallel if available, otherwise simple implementation
        if command -v parallel >/dev/null; then
            cat "$PROMPT_FILE" | parallel -j "$PARALLEL_LIMIT" run_task {}
        else
            # Simple bash background loop (fragile but functional for MVP)
            while IFS= read -r task; do
                ((i=i%PARALLEL_LIMIT)); ((i++==0)) && wait
                run_task "$task" & 
            done < "$PROMPT_FILE"
            wait
        fi
    else
        echo "[Ralph] Running TASKS sequentially"
        while IFS= read -r task; do
             run_task "$task"
        done < "$PROMPT_FILE"
    fi
else
    echo "Usage: ./ralph_runner.sh --file tasks.md OR ./ralph_runner.sh 'My Task'"
fi
