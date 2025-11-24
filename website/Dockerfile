# Multi-stage build for WebEDT monorepo
FROM node:20-alpine AS base

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json ./

# Copy all packages
COPY packages ./packages

# Cache bust to ensure fresh code is copied
# Change the date/commit to invalidate cache
RUN echo "Cache bust: 2025-11-23T18:00:00Z commit:d9488ab"

# Copy apps (this will be rebuilt when cache is invalidated)
COPY apps ./apps

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS build

WORKDIR /app

# Note: Version is pre-generated in version.ts before committing
# Run 'pnpm version:generate' locally to update the version

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

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json ./

# Copy package.json files for all workspaces
COPY packages/shared/package.json ./packages/shared/
COPY apps/client/package.json ./apps/client/
COPY apps/server/package.json ./apps/server/

# Install all dependencies (needed for rebuilding native modules)
RUN pnpm install --frozen-lockfile

# Manually rebuild native modules using npm in pnpm store
RUN cd /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release
RUN cd /app/node_modules/.pnpm/bcrypt@*/node_modules/bcrypt && npm rebuild

# Copy built artifacts from build stage
COPY --from=build /app/apps/client/dist ./apps/client/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist

# Expose port 3000 (unified server port)
EXPOSE 3000

# Set working directory to server
WORKDIR /app/apps/server

# Start the server
CMD ["node", "dist/index.js"]
