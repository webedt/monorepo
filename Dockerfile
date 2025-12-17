# =============================================================================
# WebEDT Consolidated Services - Single Image Build
# =============================================================================
# This Dockerfile builds all services into a single image:
# - Website (React client + API facade)
# - Internal API Server
# - AI Coding Workers
# =============================================================================

# Build arguments for version tracking
ARG BUILD_COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown
ARG BUILD_IMAGE_TAG=unknown
ARG BUILD_VERSION=0.0.0

# =============================================================================
# Stage 1: Build shared package
# =============================================================================
FROM node:20-slim AS shared-build

WORKDIR /app/shared
COPY shared/package*.json ./
COPY shared/tsconfig.json ./
COPY shared/src ./src
RUN npm install && npm run build

# =============================================================================
# Stage 2: Build website client (React)
# =============================================================================
FROM node:20-slim AS client-build

ARG BUILD_VERSION
ARG BUILD_TIMESTAMP
ARG BUILD_COMMIT_SHA

WORKDIR /app/client
COPY website/client/package*.json ./
COPY website/client/*.tgz ./
RUN npm install

COPY website/client/ .

# Generate version.ts
RUN TIMESTAMP_VALUE="${BUILD_TIMESTAMP:-}" && \
    SHA_VALUE="${BUILD_COMMIT_SHA:-}" && \
    if [ -n "$TIMESTAMP_VALUE" ]; then TIMESTAMP_EXPORT="'$TIMESTAMP_VALUE'"; else TIMESTAMP_EXPORT="null"; fi && \
    if [ -n "$SHA_VALUE" ]; then SHA_EXPORT="'$SHA_VALUE'"; else SHA_EXPORT="null"; fi && \
    echo "// Auto-generated from build args" > src/version.ts && \
    echo "export const VERSION = '${BUILD_VERSION}';" >> src/version.ts && \
    echo "export const VERSION_TIMESTAMP: string | null = $TIMESTAMP_EXPORT;" >> src/version.ts && \
    echo "export const VERSION_SHA: string | null = $SHA_EXPORT;" >> src/version.ts && \
    echo "export const GITHUB_REPO_URL = 'https://github.com/webedt/monorepo';" >> src/version.ts

RUN npm run build

# =============================================================================
# Stage 3: Build internal-api-server
# =============================================================================
FROM node:20-slim AS api-build

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shared package
COPY --from=shared-build /app/shared ./shared

# Build internal-api-server
WORKDIR /app/internal-api-server
COPY internal-api-server/package*.json ./
COPY internal-api-server/tsconfig.json ./
RUN npm install
COPY internal-api-server/src ./src
RUN npm run build

# =============================================================================
# Stage 4: Build ai-coding-worker
# =============================================================================
FROM node:20-slim AS worker-build

WORKDIR /app

# Copy shared package
COPY --from=shared-build /app/shared ./shared

# Build ai-coding-worker
WORKDIR /app/ai-coding-worker
COPY ai-coding-worker/package*.json ./
COPY ai-coding-worker/tsconfig.json ./
RUN npm install
COPY ai-coding-worker/src ./src
RUN npm run build

# =============================================================================
# Stage 5: Build services (main entry point)
# =============================================================================
FROM node:20-slim AS services-build

WORKDIR /app

# Copy shared package
COPY --from=shared-build /app/shared ./shared

# Build services
WORKDIR /app/services
COPY services/package*.json ./
COPY services/tsconfig.json ./
RUN npm install
COPY services/src ./src
RUN npm run build

# =============================================================================
# Stage 6: Production image
# =============================================================================
FROM node:20-slim AS production

ARG BUILD_COMMIT_SHA
ARG BUILD_TIMESTAMP
ARG BUILD_IMAGE_TAG

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (direct binary download - avoids apt repository timeout issues)
RUN GH_VERSION="2.63.2" && \
    ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then ARCH="arm64"; else ARCH="amd64"; fi && \
    curl -fsSL --retry 3 --retry-delay 5 "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH}.tar.gz" -o /tmp/gh.tar.gz && \
    tar -xzf /tmp/gh.tar.gz -C /tmp && \
    mv /tmp/gh_${GH_VERSION}_linux_${ARCH}/bin/gh /usr/local/bin/gh && \
    chmod +x /usr/local/bin/gh && \
    rm -rf /tmp/gh* && \
    gh --version

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for worker processes
RUN useradd -m -u 1001 worker

# Create workspace directory
RUN mkdir -p /workspace && chown -R worker:worker /workspace

WORKDIR /app

# Copy shared package (with node_modules and dist)
COPY --from=shared-build /app/shared ./shared

# Copy website client build
COPY --from=client-build /app/client/dist ./website/client/dist

# Copy internal-api-server
COPY --from=api-build /app/internal-api-server/dist ./internal-api-server/dist
COPY --from=api-build /app/internal-api-server/node_modules ./internal-api-server/node_modules
COPY --from=api-build /app/internal-api-server/package.json ./internal-api-server/

# Copy ai-coding-worker
COPY --from=worker-build /app/ai-coding-worker/dist ./ai-coding-worker/dist
COPY --from=worker-build /app/ai-coding-worker/node_modules ./ai-coding-worker/node_modules
COPY --from=worker-build /app/ai-coding-worker/package.json ./ai-coding-worker/

# Copy services (main entry point)
COPY --from=services-build /app/services/dist ./services/dist
COPY --from=services-build /app/services/node_modules ./services/node_modules
COPY --from=services-build /app/services/package.json ./services/

# Configure git for worker processes
RUN git config --global user.email "worker@webedt.local" && \
    git config --global user.name "WebEDT Worker"

# Set environment variables
ENV NODE_ENV=production
ENV WEBSITE_PORT=3000
ENV API_PORT=3001
ENV WORKER_BASE_PORT=5001
ENV WORKER_POOL_SIZE=2
ENV WORKSPACE_DIR=/workspace
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV BUILD_IMAGE_TAG=$BUILD_IMAGE_TAG

# Expose main port
EXPOSE 3000

# Set working directory
WORKDIR /app/services

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the consolidated services
CMD ["node", "dist/index.js"]
