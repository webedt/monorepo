# Monorepo

This repository consolidates multiple projects into a single monorepo with independent CI/CD pipelines for each project.

## Repository Structure

```
.
├── website/                           # Website project (pnpm workspace)
├── ai-coding-worker/                  # AI Coding Worker service
├── collaborative-session-worker/       # Collaborative Session Worker service
├── storage-worker/                    # Storage Worker service
└── .github/
    └── workflows/                     # Centralized GitHub Actions workflows
        ├── website-deploy-dokploy.yml
        ├── website-cleanup-dokploy.yml
        ├── ai-coding-worker-docker-build-push.yml
        ├── collaborative-session-worker-docker-build-push.yml
        └── storage-worker-docker-build-push.yml
```

## Projects

### 1. Website
- **Path**: `website/`
- **Type**: Turbo monorepo with Next.js apps
- **Deployment**: Dokploy (self-hosted)
- **Workflows**:
  - `website-deploy-dokploy.yml` - Deploys to Dokploy on non-main branch pushes
  - `website-cleanup-dokploy.yml` - Cleans up Dokploy apps on branch deletion

### 2. AI Coding Worker
- **Path**: `ai-coding-worker/`
- **Type**: Node.js/TypeScript worker service
- **Deployment**: Docker Registry
- **Workflow**: `ai-coding-worker-docker-build-push.yml` - Builds and pushes Docker images on main branch

### 3. Collaborative Session Worker
- **Path**: `collaborative-session-worker/`
- **Type**: Node.js/TypeScript worker service
- **Deployment**: Docker Registry
- **Workflow**: `collaborative-session-worker-docker-build-push.yml` - Builds and pushes Docker images on main branch

### 4. Storage Worker
- **Path**: `storage-worker/`
- **Type**: Node.js/TypeScript worker service
- **Deployment**: Docker Registry
- **Workflow**: `storage-worker-docker-build-push.yml` - Builds and pushes Docker images on main branch

## GitHub Actions Workflows

All GitHub Actions workflows are centralized in `.github/workflows/` at the repository root. Each workflow:

1. **Only runs when its project folder changes** using `paths` filters
2. **Runs independently** - changes to one project don't trigger other projects' workflows
3. **Preserves original functionality** - all features from the original separate repos are maintained

### How Path Filtering Works

Each workflow includes a `paths` filter like this:

```yaml
on:
  push:
    branches:
      - main
    paths:
      - "project-name/**"
      - ".github/workflows/project-name-workflow.yml"
```

This ensures:
- ✅ Only changes in `project-name/` trigger the workflow
- ✅ Changes to the workflow file itself also trigger it
- ✅ Changes to other projects **do not** trigger this workflow
- ✅ No wasted CI/CD minutes

### Example Scenarios

**Scenario 1**: You modify `website/apps/web/page.tsx`
- ✅ `website-deploy-dokploy.yml` runs
- ❌ Worker Docker build workflows do NOT run

**Scenario 2**: You modify `ai-coding-worker/src/index.ts`
- ✅ `ai-coding-worker-docker-build-push.yml` runs
- ❌ Other workflows do NOT run

**Scenario 3**: You modify files in multiple projects
- ✅ Multiple workflows run in parallel (only for affected projects)

**Scenario 4**: You only modify `README.md` (this file)
- ❌ No workflows run (no project files changed)

## Development

Each project maintains its own:
- Dependencies (`package.json`, `pnpm-lock.yaml`, etc.)
- Configuration files
- Build processes
- Deployment requirements

Work on each project independently in its own directory. The monorepo structure is transparent to local development.

## CI/CD Details

### Website Deployment
- Uses Dokploy for deployment
- Creates separate apps per branch for preview environments
- Automatically cleans up apps when branches are deleted
- Configures environment variables and domains automatically

### Worker Services
- Build multi-platform Docker images (linux/amd64, linux/arm64)
- Push to private Docker registry
- Use layer caching for faster builds
- Tag images with branch name, SHA, and 'latest' for main branch

## Benefits of This Structure

1. **Independent CI/CD**: Each project only runs its workflows when it changes
2. **Cost Efficiency**: No wasted GitHub Actions minutes
3. **Simplified Management**: All code in one repository
4. **Atomic Changes**: Cross-project changes can be in a single PR
5. **Shared Resources**: Can share common configuration, scripts, or libraries if needed

## Migration from Separate Repos

This monorepo was created by consolidating:
- https://github.com/webedt/website
- https://github.com/webedt/ai-coding-worker
- https://github.com/webedt/collaborative-session-worker
- https://github.com/webedt/storage-worker

All git history from the original repositories has been preserved in their respective folders.
