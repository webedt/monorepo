#!/bin/bash

# Pull the latest image from registry
echo "Pulling storage-worker image from registry..."
docker pull dockerregistry.etdofresh.com/storage-worker:latest

# Create network if it doesn't exist
docker network inspect workers-network >/dev/null 2>&1 || docker network create --driver overlay workers-network

# Deploy to swarm
echo "Deploying to Docker Swarm..."
docker stack deploy -c swarm.yml storage

echo "Deployment complete!"
echo "Storage Worker API: http://localhost:3000"
echo "MinIO Console: http://localhost:9001"
echo ""
echo "Check status:"
echo "  docker service ls | grep storage"
echo "  docker service logs storage_storage-worker"
