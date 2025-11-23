#!/bin/bash
set -e

echo "🔄 Pre-build: Generating version from git..."

# Run version generation script
node scripts/generate-version.js --update

echo "✅ Pre-build complete: Version files generated"
