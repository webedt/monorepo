# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build args for version info and API configuration
ARG BUILD_VERSION=0.0.137
ARG BUILD_TIMESTAMP=
ARG BUILD_SHA=
ARG VITE_API_BASE_URL=https://webedt.etdofresh.com

# Set environment variable for Vite build
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Generate version.ts from build args
RUN TIMESTAMP_VALUE="${BUILD_TIMESTAMP:-}" && \
    SHA_VALUE="${BUILD_SHA:-}" && \
    if [ -n "$TIMESTAMP_VALUE" ]; then TIMESTAMP_EXPORT="'$TIMESTAMP_VALUE'"; else TIMESTAMP_EXPORT="null"; fi && \
    if [ -n "$SHA_VALUE" ]; then SHA_EXPORT="'$SHA_VALUE'"; else SHA_EXPORT="null"; fi && \
    echo "// Auto-generated from build args" > /app/src/version.ts && \
    echo "// Version: ${BUILD_VERSION}" >> /app/src/version.ts && \
    echo "export const VERSION = '${BUILD_VERSION}';" >> /app/src/version.ts && \
    echo "export const VERSION_TIMESTAMP: string | null = $TIMESTAMP_EXPORT;" >> /app/src/version.ts && \
    echo "export const VERSION_SHA: string | null = $SHA_EXPORT;" >> /app/src/version.ts && \
    echo "export const GITHUB_REPO_URL = 'https://github.com/webedt/monorepo';" >> /app/src/version.ts && \
    echo "✓ Generated version.ts: VERSION=${BUILD_VERSION}, SHA=${SHA_VALUE:0:7}"

# Build the app
RUN npm run build

# Production stage - serve with nginx
FROM nginx:alpine AS production

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config for SPA routing
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
