FROM node:20-slim

# Build arguments for version tracking
ARG BUILD_COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown
ARG BUILD_IMAGE_TAG=unknown

# Install git, python3, and build tools (needed for bcrypt native compilation on ARM64)
# Uses retry logic for transient network failures
RUN for i in 1 2 3 4 5; do \
        rm -rf /var/lib/apt/lists/* && \
        apt-get update && \
        apt-get install -y git python3 make g++ && \
        break || { echo "Retry $i/5 apt install failed, waiting $((i * 2))s..."; sleep $((i * 2)); }; \
    done && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy shared package first and build it
COPY shared/package*.json ./shared/
COPY shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
WORKDIR /app/shared
RUN npm install && npm run build

# Copy internal-api-server package files
WORKDIR /app/internal-api-server
COPY internal-api-server/package*.json ./
COPY internal-api-server/tsconfig.json ./

# Install dependencies (this will link to ../shared)
RUN npm install

# Copy source code
COPY internal-api-server/src ./src

# Build TypeScript
RUN npm run build

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
