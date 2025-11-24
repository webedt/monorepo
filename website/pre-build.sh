#!/bin/bash
set -e

echo "🔄 Pre-build: Generating version from git..."

# Run version generation script
node scripts/generate-version.js --update

echo "🔄 Pre-build: Updating Dockerfile cache bust..."

# Get current commit SHA (short form) and timestamp
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Update the Dockerfile cache bust line
# Use | as delimiter to avoid issues with / in dates
sed -i "s|^RUN echo \"Cache bust:.*|RUN echo \"Cache bust: ${TIMESTAMP} commit:${COMMIT_SHA}\"|" Dockerfile

echo "✅ Pre-build complete: Version files generated and Dockerfile updated"
echo "   Commit: ${COMMIT_SHA}"
echo "   Timestamp: ${TIMESTAMP}"
