FROM node:20-slim

# Install git (needed for git operations)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src
COPY bin ./bin

# Build TypeScript
RUN npm run build

# Set environment variables
ENV NODE_ENV=production

# Default command: sleep forever (user will terminal in to run commands)
CMD ["tail", "-f", "/dev/null"]
