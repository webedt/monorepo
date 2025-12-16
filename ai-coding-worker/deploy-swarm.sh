#!/bin/bash
set -e

echo "=================================================="
echo "  AI Coding Worker - Docker Swarm Deployment"
echo "=================================================="

# Check if running in swarm mode
if ! docker info | grep -q "Swarm: active"; then
  echo "ERROR: Docker is not in swarm mode"
  echo "Run: docker swarm init"
  exit 1
fi

echo ""
echo "Note: Authentication is handled via API requests."
echo "No pre-configuration needed - credentials are written when requests are received."

# Build the image
echo ""
echo "Building ai-coding-worker image..."
docker build -t ghcr.io/webedt/monorepo/ai-coding-worker:latest .
echo "✓ Image built: ghcr.io/webedt/monorepo/ai-coding-worker:latest"

# Push to registry
echo ""
echo "Pushing image to registry..."
docker push ghcr.io/webedt/monorepo/ai-coding-worker:latest
echo "✓ Image pushed to ghcr.io"

# Deploy the stack
echo ""
echo "Deploying stack: ai-coding-worker-stack"
docker stack deploy -c swarm.yml ai-coding-worker-stack
echo "✓ Stack deployed"

# Wait a moment for services to start
sleep 3

# Show service status
echo ""
echo "Service status:"
docker service ls | grep ai-coding-worker-stack

echo ""
echo "=================================================="
echo "  Deployment Complete!"
echo "=================================================="
echo ""
echo "Monitor with:"
echo "  docker service ls"
echo "  docker service ps ai-coding-worker-stack_ai-coding-worker"
echo "  docker service logs ai-coding-worker-stack_ai-coding-worker -f"
echo ""
echo "Test with:"
echo '  curl -X POST http://localhost:5001/execute \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{'
echo '      "userRequest": "Create a hello.txt file",'
echo '      "codingAssistantProvider": "ClaudeAgentSDK",'
echo '      "codingAssistantAuthentication": "{\"claudeAiOauth\":{...}}"'
echo '    }'"'"
echo ""
echo "Stop with:"
echo "  docker stack rm ai-coding-worker-stack"
echo "=================================================="
