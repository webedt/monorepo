FROM node:20-slim

# Build arguments for version tracking
ARG BUILD_COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown
ARG BUILD_IMAGE_TAG=unknown

# Install git (required for cloning repositories) and GitHub CLI (for Copilot)
# Uses retry logic for transient network failures
RUN for i in 1 2 3 4 5; do \
        rm -rf /var/lib/apt/lists/* && \
        apt-get update && \
        apt-get install -y git curl && \
        break || { echo "Retry $i/5 apt install failed, waiting $((i * 2))s..."; sleep $((i * 2)); }; \
    done && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    for i in 1 2 3 4 5; do \
        apt-get update && apt-get install -y gh && break || { echo "Retry $i/5 gh install failed, waiting $((i * 2))s..."; sleep $((i * 2)); }; \
    done && \
    rm -rf /var/lib/apt/lists/*

# Install Gemini CLI globally (for OAuth-based Gemini access)
# The official Google Gemini CLI package - try multiple possible names
RUN npm install -g @anthropic-ai/claude-code && \
    (npm install -g @google-gemini/cli 2>/dev/null || \
     npm install -g gemini-cli 2>/dev/null || \
     npm install -g @google/gemini-cli 2>/dev/null || \
     echo "Gemini CLI not found - will use SDK fallback")

# Create non-root user (required for Claude Code --dangerously-skip-permissions)
RUN useradd -m -u 1001 worker && \
    mkdir -p /workspace && \
    chown -R worker:worker /workspace

# Set working directory
WORKDIR /app

# Copy shared package first (dependency)
COPY shared/package*.json ./shared/
COPY shared/tsconfig.json ./shared/
COPY shared/src ./shared/src

# Build shared package
WORKDIR /app/shared
RUN npm install && npm run build

# Copy ai-coding-worker package files
WORKDIR /app/ai-coding-worker
COPY ai-coding-worker/package*.json ./
COPY ai-coding-worker/tsconfig.json ./

# Install dependencies (will use local file:../shared reference)
RUN npm install

# Copy source code
COPY ai-coding-worker/src ./src

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

# Set working directory for runtime
WORKDIR /app/ai-coding-worker

# Expose port
EXPOSE 5000

# Start the server
CMD ["npm", "start"]
