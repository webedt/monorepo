#!/bin/bash
# Connect to autonomous-dev-cli container and run dev mode in tmux

SERVICE_NAME="webedt-app-autonomous-dev-cli-xpmnee"
TMUX_SESSION="dev"

echo "Connecting to ehub2023..."

# SSH into the server
ssh -t ehub2023 "
  # Get container ID
  CONTAINER_ID=\$(docker ps --filter 'name=${SERVICE_NAME}' --format '{{.ID}}' | head -1)

  if [ -z \"\$CONTAINER_ID\" ]; then
    echo 'Error: Could not find container for service ${SERVICE_NAME}'
    echo 'Available containers:'
    docker ps --format 'table {{.Names}}\t{{.Status}}'
    exit 1
  fi

  echo \"Found container: \$CONTAINER_ID\"

  # Check if tmux session exists inside container
  if docker exec \$CONTAINER_ID tmux has-session -t ${TMUX_SESSION} 2>/dev/null; then
    echo 'Attaching to existing tmux session...'
    docker exec -it \$CONTAINER_ID tmux attach-session -t ${TMUX_SESSION}
  else
    echo 'Creating new tmux session and starting dev server...'
    docker exec -it \$CONTAINER_ID tmux new-session -s ${TMUX_SESSION} 'cd /app && npm run dev start'
  fi
"
