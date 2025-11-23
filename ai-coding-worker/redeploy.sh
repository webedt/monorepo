#!/bin/bash

# Redeploy script for AI Coding Worker
# Updates the Docker service with the latest code

set -e  # Exit on error

# Configuration
REGISTRY="dockerregistry.etdofresh.com"
IMAGE_NAME="ai-coding-worker"
SERVICE_NAME="webedt-app-ai-coding-workers-gy4wew_ai-coding-worker"
SSH_HOST="ehub2023"

echo "============================================"
echo "AI Coding Worker - Redeploy"
echo "============================================"
echo ""

# Step 1: Build TypeScript
echo "📦 Step 1/4: Building TypeScript..."
npm run build
echo "✅ TypeScript build complete"
echo ""

# Step 2: Build Docker image
echo "🐳 Step 2/4: Building Docker image..."
docker build -t ${REGISTRY}/${IMAGE_NAME}:latest .
echo "✅ Docker image built"
echo ""

# Step 3: Push to registry
echo "📤 Step 3/4: Pushing to registry..."
docker push ${REGISTRY}/${IMAGE_NAME}:latest
echo "✅ Image pushed to registry"
echo ""

# Step 4: Update service
echo "🔄 Step 4/4: Updating Docker service..."
ssh ${SSH_HOST} "docker service update --image ${REGISTRY}/${IMAGE_NAME}:latest ${SERVICE_NAME}"
echo "✅ Service updated"
echo ""

echo "============================================"
echo "🎉 Deployment complete!"
echo "============================================"
echo ""
echo "Monitor the deployment:"
echo "  ssh ${SSH_HOST} \"docker service ps ${SERVICE_NAME}\""
echo "  ssh ${SSH_HOST} \"docker service logs ${SERVICE_NAME} -f\""
