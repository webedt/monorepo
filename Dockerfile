# Multi-stage build for WebEDT main-server
# This Dockerfile builds the main-server which consolidates:
# - API routes
# - Storage operations (MinIO)
# - GitHub operations
# - Website static files (built from website/apps/client)

FROM node:20-alpine AS base

# Install pnpm for website build
RUN npm install -g pnpm

# ============================================================================
# Stage 1: Build website client
# ============================================================================
FROM base AS website-build

WORKDIR /app/website

# Copy workspace configuration
COPY website/pnpm-workspace.yaml website/package.json website/pnpm-lock.yaml website/.npmrc ./
COPY website/tsconfig.base.json ./

# Copy all packages
COPY website/packages ./packages

# Copy client app only (server is now in main-server)
COPY website/apps/client ./apps/client

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build args for version info
ARG BUILD_VERSION=0.0.137
ARG BUILD_TIMESTAMP=
ARG BUILD_SHA=

# Generate version.ts from build args
RUN TIMESTAMP_VALUE="${BUILD_TIMESTAMP:-}" && \
    SHA_VALUE="${BUILD_SHA:-}" && \
    if [ -n "$TIMESTAMP_VALUE" ]; then TIMESTAMP_EXPORT="'$TIMESTAMP_VALUE'"; else TIMESTAMP_EXPORT="null"; fi && \
    if [ -n "$SHA_VALUE" ]; then SHA_EXPORT="'$SHA_VALUE'"; else SHA_EXPORT="null"; fi && \
    echo "// Auto-generated from build args" > /app/website/apps/client/src/version.ts && \
    echo "// Version: ${BUILD_VERSION}" >> /app/website/apps/client/src/version.ts && \
    echo "export const VERSION = '${BUILD_VERSION}';" >> /app/website/apps/client/src/version.ts && \
    echo "export const VERSION_TIMESTAMP: string | null = $TIMESTAMP_EXPORT;" >> /app/website/apps/client/src/version.ts && \
    echo "export const VERSION_SHA: string | null = $SHA_EXPORT;" >> /app/website/apps/client/src/version.ts && \
    echo "export const GITHUB_REPO_URL = 'https://github.com/webedt/monorepo';" >> /app/website/apps/client/src/version.ts && \
    echo "✓ Generated version.ts: VERSION=${BUILD_VERSION}, SHA=${SHA_VALUE:0:7}"

# Build client (React/Vite app)
RUN pnpm --filter @webedt/client build

# ============================================================================
# Stage 2: Build main-server
# ============================================================================
FROM node:20-slim AS server-build

WORKDIR /app

# Copy main-server files
COPY main-server/package*.json ./
COPY main-server/tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY main-server/src ./src

# Build TypeScript
RUN npm run build

# ============================================================================
# Stage 3: Production
# ============================================================================
FROM node:20-slim AS production

# Install git (needed for git operations)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build arguments for version tracking
ARG BUILD_COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown
ARG BUILD_IMAGE_TAG=unknown

# Copy main-server package files and install production deps
COPY main-server/package*.json ./
RUN npm install --omit=dev

# Copy built main-server
COPY --from=server-build /app/dist ./dist

# Copy built website client to expected location
# main-server expects it at ../../website/apps/client/dist relative to src
RUN mkdir -p /app/website/apps/client
COPY --from=website-build /app/website/apps/client/dist /app/website/apps/client/dist

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV BUILD_IMAGE_TAG=$BUILD_IMAGE_TAG

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
