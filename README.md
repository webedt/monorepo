# Monorepo

This repository consolidates multiple projects into a single monorepo with independent CI/CD pipelines for each project.

## Repository Structure

```
.
├── autonomous-dev-cli/                # Autonomous Development CLI
├── website/                           # Website project (pnpm workspace)
├── ai-coding-worker/                  # AI Coding Worker service
├── internal-api-server/               # Internal API Server service
├── shared/                            # Shared utilities and types
├── examples/                          # Example configurations
└── .github/
    └── workflows/                     # Centralized GitHub Actions workflows
        ├── website-deploy-dokploy.yml
        ├── website-cleanup-dokploy.yml
        └── ai-coding-worker-docker-build-push.yml
```

## Projects

### 1. Autonomous Dev CLI

The **Autonomous Development CLI** is a powerful command-line tool that runs as a continuous daemon to autonomously develop your codebase. It uses Claude AI to discover tasks, create GitHub issues, implement changes in parallel, evaluate results, and auto-merge successful changes.

- **Path**: `autonomous-dev-cli/`
- **Type**: Node.js/TypeScript CLI application
- **Documentation**: See [autonomous-dev-cli/README.md](./autonomous-dev-cli/README.md) for complete setup and usage guide

**Key Features:**
- Task Discovery: Claude AI analyzes your codebase and suggests improvements
- GitHub Integration: Auto-creates issues and pull requests
- Parallel Execution: Runs multiple workers simultaneously
- Evaluation Pipeline: Verifies builds, tests, and health checks
- Auto-Merge: Automatically merges PRs when all checks pass

**Quick Start:**
```bash
cd autonomous-dev-cli
npm install
npm run build
npm link  # optional

# Initialize configuration
autonomous-dev init

# Start autonomous development
autonomous-dev start
```

See the [Quick Start Guide](./autonomous-dev-cli/docs/quick-start.md) for detailed setup instructions.

### 2. Website
- **Path**: `website/`
- **Type**: React frontend with Express API facade
- **Deployment**: Dokploy (self-hosted)
- **Workflows**:
  - `website-deploy-dokploy.yml` - Deploys to Dokploy on non-main branch pushes
  - `website-cleanup-dokploy.yml` - Cleans up Dokploy apps on branch deletion

### 3. AI Coding Worker
- **Path**: `ai-coding-worker/`
- **Type**: Node.js/TypeScript worker service
- **Deployment**: Docker Registry
- **Workflow**: `ai-coding-worker-docker-build-push.yml` - Builds and pushes Docker images on main branch
- **Purpose**: Provider-agnostic ephemeral worker for LLM execution with Docker Swarm orchestration

### 4. Internal API Server
- **Path**: `internal-api-server/`
- **Type**: Node.js/TypeScript backend service
- **Purpose**: Central backend handling API routes, database, storage, and GitHub operations

### 5. Shared
- **Path**: `shared/`
- **Type**: Shared utilities and TypeScript types
- **Purpose**: Common code shared across projects

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

## Documentation

For detailed documentation on each project:

| Project | Documentation |
|---------|---------------|
| **Autonomous Dev CLI** | [README](./autonomous-dev-cli/README.md) \| [Quick Start](./autonomous-dev-cli/docs/quick-start.md) \| [Configuration](./autonomous-dev-cli/docs/configuration.md) |
| **AI Coding Worker** | [README](./ai-coding-worker/README.md) |
| **Internal API Server** | [README](./internal-api-server/README.md) |

## Example Configurations

Example configuration files for the Autonomous Dev CLI are available in:
- `autonomous-dev-cli/examples/` - Various configuration presets
- `examples/` - Root-level example configs

## Migration from Separate Repos

This monorepo was created by consolidating multiple repositories. All git history from the original repositories has been preserved in their respective folders.
