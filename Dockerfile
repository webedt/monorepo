# =============================================================================
# WebEDT Monorepo - Single Image Build
# =============================================================================
# Builds all services into one image:
# - Website (React client + Express server)
# - Internal API Server (with Claude Remote Sessions)
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
RUN npm install
COPY shared/tsconfig.json ./
COPY shared/src ./src
RUN npm run build

# =============================================================================
# Stage 2: Build website client (React)
# =============================================================================
FROM node:20-slim AS client-build

ARG BUILD_VERSION
ARG BUILD_TIMESTAMP
ARG BUILD_COMMIT_SHA

WORKDIR /app/client
COPY website/client/package*.json ./
# Copy local tarballs if they exist (using shell to handle missing files gracefully)
RUN --mount=type=bind,source=website/client,target=/tmp/client \
    find /tmp/client -maxdepth 1 -name "*.tgz" -exec cp {} ./ \; 2>/dev/null || true
RUN npm install

COPY website/client/ .

# Generate version.ts (create src dir if it doesn't exist)
RUN mkdir -p src && \
    TIMESTAMP_VALUE="${BUILD_TIMESTAMP:-}" && \
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
# Stage 3: Build website server (Express)
# =============================================================================
FROM node:20-slim AS server-build

WORKDIR /app/server
COPY website/server/package*.json ./
RUN npm install
COPY website/server/tsconfig.json ./
COPY website/server/src ./src
RUN npm run build

# =============================================================================
# Stage 4: Build internal-api-server
# =============================================================================
FROM node:20-slim AS api-build

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shared package first
COPY --from=shared-build /app/shared ./shared

# Build internal-api-server
WORKDIR /app/internal-api-server
COPY internal-api-server/package*.json ./
RUN npm install
COPY internal-api-server/tsconfig.json ./
COPY internal-api-server/src ./src
RUN npm run build

# =============================================================================
# Stage 5: Production image
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

# Install GitHub CLI
RUN GH_VERSION="2.63.2" && \
    ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then ARCH="arm64"; else ARCH="amd64"; fi && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH}.tar.gz" -o /tmp/gh.tar.gz && \
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

# Copy shared package
COPY --from=shared-build /app/shared ./shared

# Copy website client build
COPY --from=client-build /app/client/dist ./website/client/dist

# Copy website server
COPY --from=server-build /app/server/dist ./website/server/dist
COPY --from=server-build /app/server/node_modules ./website/server/node_modules
COPY --from=server-build /app/server/package.json ./website/server/

# Copy internal-api-server
COPY --from=api-build /app/internal-api-server/dist ./internal-api-server/dist
COPY --from=api-build /app/internal-api-server/node_modules ./internal-api-server/node_modules
COPY --from=api-build /app/internal-api-server/package.json ./internal-api-server/

# Copy orchestrator script
COPY scripts/start.js ./scripts/start.js

# Configure git for worker processes
RUN git config --global user.email "worker@webedt.local" && \
    git config --global user.name "WebEDT Worker"

# Set environment variables
ENV NODE_ENV=production
ENV WEBSITE_PORT=3000
ENV API_PORT=3001
ENV WORKSPACE_DIR=/workspace
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV BUILD_IMAGE_TAG=$BUILD_IMAGE_TAG

# Expose main port (website)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start all services via orchestrator
CMD ["node", "scripts/start.js"]
