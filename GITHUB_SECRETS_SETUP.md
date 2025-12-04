# GitHub Secrets Setup Guide

This document lists all the GitHub secrets required to run the CI/CD pipelines with testing for the AI Coding Worker and Storage Worker.

## Required Secrets

### Docker Registry (Already Configured)
These should already exist from your current setup:
- `DOCKER_REGISTRY_USERNAME` - Username for dockerregistry.etdofresh.com
- `DOCKER_REGISTRY_PASSWORD` - Password for Docker registry
- `DOKPLOY_API_KEY` - API key for Dokploy deployments

### AI Coding Worker Secrets

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AI_CODING_WORKER_URL` | URL of deployed AI Coding Worker | `https://ai-coding-worker.example.com` |
| `STORAGE_WORKER_URL` | URL of deployed Storage Worker | `https://storage-worker.example.com` |
| `CODING_ASSISTANT_PROVIDER` | AI provider name | `ClaudeAgentSDK` |
| `CODING_ASSISTANT_AUTHENTICATION` | OAuth credentials JSON | `{"claudeAiOauth":{"accessToken":"sk-ant-oat01-..."}}` |
| `TEST_GITHUB_ACCESS_TOKEN` | GitHub token for integration tests | `gho_xxxxxxxxxxxx` |
| `WEBSITE_API_URL` | Website callback URL | `https://website.example.com` |
| `WORKER_CALLBACK_SECRET` | Shared secret for callbacks | `your-secret-key` |

### Storage Worker Secrets

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `STORAGE_WORKER_URL` | URL of deployed Storage Worker | `https://storage-worker.example.com` |
| `MINIO_ENDPOINT` | MinIO server hostname | `minio.example.com` |
| `MINIO_PORT` | MinIO server port | `9000` |
| `MINIO_USE_SSL` | Use SSL for MinIO | `true` or `false` |
| `MINIO_ROOT_USER` | MinIO username | `minioadmin` |
| `MINIO_ROOT_PASSWORD` | MinIO password | `your-minio-password` |
| `MINIO_BUCKET` | Bucket name for sessions | `sessions` |

## Setting Up Secrets in GitHub

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret with its name and value

## Environment Variables (GitHub Actions)

The workflows also use these repository variables (Settings → Secrets and variables → Actions → Variables):
- `DOKPLOY_URL` - Base URL for Dokploy API
- `DOKPLOY_AI_CODING_WORKER_COMPOSE_ID` - Compose ID for AI Coding Worker
- `DOKPLOY_STORAGE_WORKER_COMPOSE_ID` - Compose ID for Storage Worker

## Test Workflow

After deployment to main branch, tests will automatically run against the deployed endpoints:

### AI Coding Worker Tests
1. Health check endpoint
2. Status endpoint
3. Session listing
4. Execute endpoint validation
5. Abort endpoint
6. CORS headers
7. Container ID headers
8. SSE execution (if credentials configured)

### Storage Worker Tests
1. Health check endpoint
2. Session CRUD operations
3. File upload/download
4. Session file operations
5. Bulk delete operations
6. Path normalization
7. Error handling validation

## Running Tests Locally

### AI Coding Worker
```bash
cd ai-coding-worker
cp .env.example .env
# Edit .env with your values
npm ci
npm run test:api
```

### Storage Worker
```bash
cd storage-worker
cp .env.example .env
# Edit .env with your values
npm ci
npm run test:api
```

## Notes

- Tests run automatically after successful deployment to main branch
- Test failures won't block the deployment (they run after deployment)
- Check GitHub Actions logs for detailed test output
- The `|| true` in the workflow ensures the job continues even if some tests fail
- Remove `|| true` if you want tests to fail the workflow on errors
