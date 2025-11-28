# Multi-stage build for WebEDT monorepo - Website
# This Dockerfile is placed at the root of the monorepo for deployment systems
# It builds the website application located in the website/ subdirectory

FROM node:20-alpine AS base

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app/website

# Copy workspace configuration
COPY website/pnpm-workspace.yaml website/package.json website/pnpm-lock.yaml website/.npmrc ./
COPY website/tsconfig.base.json ./

# Copy all packages
COPY website/packages ./packages

# Copy apps
COPY website/apps ./apps

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS build

WORKDIR /app/website

# Build args for version info (passed from GitHub Actions via Dokploy)
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

# Build server (Express API)
RUN pnpm --filter @webedt/server build

# Production stage
FROM node:20-alpine AS production

# Install build dependencies for native modules and SQLite
RUN apk add --no-cache \
    python3 \
    py3-setuptools \
    make \
    g++ \
    sqlite-dev

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app/website

# Copy workspace configuration
COPY website/pnpm-workspace.yaml website/package.json website/pnpm-lock.yaml website/.npmrc ./
COPY website/tsconfig.base.json ./

# Copy package.json files for all workspaces
COPY website/packages/shared/package.json ./packages/shared/
COPY website/apps/client/package.json ./apps/client/
COPY website/apps/server/package.json ./apps/server/

# Install all dependencies (needed for rebuilding native modules)
RUN pnpm install --frozen-lockfile

# Manually rebuild native modules using npm in pnpm store
RUN cd /app/website/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release
RUN cd /app/website/node_modules/.pnpm/bcrypt@*/node_modules/bcrypt && npm rebuild

# Copy built artifacts from build stage
COPY --from=build /app/website/apps/client/dist ./apps/client/dist
COPY --from=build /app/website/apps/server/dist ./apps/server/dist

# Expose port 3000 (unified server port)
EXPOSE 3000

# Set working directory to server
WORKDIR /app/website/apps/server

# Start the server
CMD ["node", "dist/index.js"]
