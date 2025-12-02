FROM node:20-slim

# Build arguments for version tracking
ARG BUILD_COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown
ARG BUILD_IMAGE_TAG=unknown

# Install git (required for cloning repositories)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Create non-root user (required for Claude Code --dangerously-skip-permissions)
RUN useradd -m -u 1001 worker && \
    mkdir -p /workspace && \
    chown -R worker:worker /workspace

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Switch to non-root user
USER worker

# Configure Git identity for commits
RUN git config --global user.email "worker@ai-coding-worker.local" && \
    git config --global user.name "AI Coding Worker"

# Set environment variables
ENV PORT=5000
ENV WORKSPACE_DIR=/workspace
ENV NODE_ENV=production
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV BUILD_IMAGE_TAG=$BUILD_IMAGE_TAG

# Expose port
EXPOSE 5000

# Start the server
CMD ["npm", "start"]
