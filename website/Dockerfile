# Stage 1: Build the React client
FROM node:20-alpine AS client-build

WORKDIR /app/client

# Copy client package files and local tarball dependencies
COPY client/package*.json ./
COPY client/*.tgz ./

# Install client dependencies
RUN npm install

# Copy client source
COPY client/ .

# Build args for version info
ARG BUILD_VERSION=0.0.0
ARG BUILD_TIMESTAMP=
ARG BUILD_SHA=

# Generate version.ts from build args
RUN TIMESTAMP_VALUE="${BUILD_TIMESTAMP:-}" && \
    SHA_VALUE="${BUILD_SHA:-}" && \
    if [ -n "$TIMESTAMP_VALUE" ]; then TIMESTAMP_EXPORT="'$TIMESTAMP_VALUE'"; else TIMESTAMP_EXPORT="null"; fi && \
    if [ -n "$SHA_VALUE" ]; then SHA_EXPORT="'$SHA_VALUE'"; else SHA_EXPORT="null"; fi && \
    echo "// Auto-generated from build args" > /app/client/src/version.ts && \
    echo "// Version: ${BUILD_VERSION}" >> /app/client/src/version.ts && \
    echo "export const VERSION = '${BUILD_VERSION}';" >> /app/client/src/version.ts && \
    echo "export const VERSION_TIMESTAMP: string | null = $TIMESTAMP_EXPORT;" >> /app/client/src/version.ts && \
    echo "export const VERSION_SHA: string | null = $SHA_EXPORT;" >> /app/client/src/version.ts && \
    echo "export const GITHUB_REPO_URL = 'https://github.com/webedt/monorepo';" >> /app/client/src/version.ts

# Build the client (no VITE_API_BASE_URL needed - using same-origin /api)
RUN npm run build

# Stage 2: Build the server
FROM node:20-alpine AS server-build

WORKDIR /app/server

# Copy server package files
COPY server/package*.json ./

# Install server dependencies
RUN npm install

# Copy server source
COPY server/ .

# Build TypeScript
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine AS production

WORKDIR /app

# Copy server build and dependencies
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/package.json ./server/

# Copy client build
COPY --from=client-build /app/client/dist ./client/dist

# Set working directory to server
WORKDIR /app/server

# Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
