FROM node:20-alpine

# Build arguments for version tracking
ARG BUILD_COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown
ARG BUILD_IMAGE_TAG=unknown

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (needed for build)
RUN npm install

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

# Set build info as environment variables
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
ENV BUILD_IMAGE_TAG=$BUILD_IMAGE_TAG

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]
