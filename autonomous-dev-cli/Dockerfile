FROM node:20-slim

# Build arguments for versioning
ARG BUILD_DATE
ARG BUILD_ID

# Install git and tmux
RUN apt-get update && apt-get install -y git tmux && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally (required for Claude Agent SDK)
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (required for Claude Code --dangerously-skip-permissions)
RUN useradd -m -u 1001 worker

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src
COPY bin ./bin

# Build TypeScript
RUN npm run build

# Write build info to a JSON file
RUN echo "{\"buildDate\":\"${BUILD_DATE:-unknown}\",\"buildId\":\"${BUILD_ID:-unknown}\"}" > /app/build-info.json

# Change ownership to worker user
RUN chown -R worker:worker /app

# Switch to non-root user
USER worker

# Configure git identity
RUN git config --global user.email "autonomous-dev@webedt.com" && \
    git config --global user.name "Autonomous Dev CLI"

# Set environment variables
ENV NODE_ENV=production

# Default command: sleep forever (user will terminal in to run commands)
CMD ["tail", "-f", "/dev/null"]
