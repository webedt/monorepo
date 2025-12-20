# =============================================================================
# WebEDT Monorepo - Single Image Build
# =============================================================================
# Builds all services into one image:
# - Shared library (@webedt/shared)
# - Website Frontend (React client)
# - Website Backend (Express server serving API + static files)
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
# Stage 2: Build website frontend (React)
# =============================================================================
FROM node:20-slim AS frontend-build

ARG BUILD_VERSION
ARG BUILD_TIMESTAMP
ARG BUILD_COMMIT_SHA

WORKDIR /app/frontend
COPY website/frontend/package*.json ./
# Copy local tarballs if they exist (using shell to handle missing files gracefully)
RUN --mount=type=bind,source=website/frontend,target=/tmp/frontend \
    find /tmp/frontend -maxdepth 1 -name "*.tgz" -exec cp {} ./ \; 2>/dev/null || true
RUN npm install

COPY website/frontend/ .

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
# Stage 3: Build website backend (Express + API)
# =============================================================================
FROM node:20-slim AS backend-build

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shared package first (backend depends on it)
COPY --from=shared-build /app/shared ./shared

# Build website backend
WORKDIR /app/backend
COPY website/backend/package*.json ./
RUN npm install
COPY website/backend/tsconfig.json ./
COPY website/backend/src ./src
RUN npm run build

# =============================================================================
# Stage 4: Production image
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

# Copy website frontend build (static files)
COPY --from=frontend-build /app/frontend/dist ./website/frontend/dist

# Copy website backend
COPY --from=backend-build /app/backend/dist ./website/backend/dist
COPY --from=backend-build /app/backend/node_modules ./website/backend/node_modules
COPY --from=backend-build /app/backend/package.json ./website/backend/

# Configure git for worker processes
RUN git config --global user.email "worker@webedt.local" && \
    git config --global user.name "WebEDT Worker"

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV WORKSPACE_DIR=/workspace
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV BUILD_IMAGE_TAG=$BUILD_IMAGE_TAG

# Expose main port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the backend server (serves both API and static frontend)
WORKDIR /app/website/backend
CMD ["node", "dist/index.js"]
