# Quick Start Guide

Get from zero to running autonomous development in under 10 minutes.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 20.0.0+** - [Download here](https://nodejs.org/)
- **Git** - [Download here](https://git-scm.com/)
- **A GitHub account** with a repository you want to improve
- **Claude API access** - [Get it here](https://console.anthropic.com/)

## Step 1: Install (2 minutes)

```bash
# Clone the repository
git clone https://github.com/webedt/monorepo.git
cd monorepo/autonomous-dev-cli

# Install dependencies
npm install

# Build the CLI
npm run build

# Link globally (optional, for 'autonomous-dev' command)
npm link
```

**Verify installation:**
```bash
autonomous-dev --version
# Should output: 0.1.0
```

## Step 2: Create Configuration (2 minutes)

Run the interactive setup wizard:

```bash
autonomous-dev init
```

The wizard will ask you:
1. **Repository owner** - Your GitHub username or organization
2. **Repository name** - The repository to run autonomous dev on
3. **Base branch** - Usually `main` or `master`
4. **Discovery settings** - How many tasks to find per cycle
5. **Execution settings** - Number of parallel workers
6. **Evaluation settings** - Whether to require build/tests to pass
7. **Merge settings** - Auto-merge behavior

**Tip:** Accept the defaults (press Enter) for a quick start. You can always adjust later.

## Step 3: Set Up Credentials (3 minutes)

### GitHub Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Give it a name like "autonomous-dev"
4. Select these scopes:
   - `repo` (Full control of private repositories)
   - `workflow` (optional, for triggering GitHub Actions)
5. Click **Generate token**
6. Copy the token (starts with `ghp_`)

### Claude API Credentials

1. Go to [Claude Console](https://console.anthropic.com/)
2. Navigate to **API Keys**
3. Create a new API key
4. Copy the access token (starts with `sk-ant-oat01-`)
5. If available, also copy the refresh token

### Set Environment Variables

Create a `.env` file or export variables:

```bash
# Copy the example file
cp .env.example .env

# Edit with your credentials
nano .env
```

**Required variables:**
```bash
# GitHub authentication
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# Claude authentication
CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxxxxxxxxxx
CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxxxxxxxxxx  # if available

# Target repository
REPO_OWNER=your-username
REPO_NAME=your-repo
```

**Alternative: Export directly:**
```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
export CLAUDE_ACCESS_TOKEN="sk-ant-oat01-xxxxxxxxxxxxxxxxxxxx"
```

## Step 4: Validate Setup (1 minute)

Verify everything is configured correctly:

```bash
# Validate configuration
autonomous-dev config --validate

# Check current settings (credentials should show ✓)
autonomous-dev config
```

Expected output:
```
Credentials:
  GitHub:      ✓ configured
  Claude:      ✓ configured
```

## Step 5: Run! (2 minutes)

### Test with Discovery First

Before starting the daemon, test task discovery:

```bash
# Discover tasks without executing (safe preview)
autonomous-dev discover --count 3
```

This shows what improvements Claude AI found in your codebase.

### Start Autonomous Development

```bash
# Start the daemon
autonomous-dev start
```

Or for a single cycle:

```bash
# Run one cycle and exit
autonomous-dev run
```

**Congratulations!** Autonomous development is now running on your project.

## What Happens Now?

The autonomous development cycle:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. DISCOVER                                                │
│     Claude AI analyzes your codebase and finds              │
│     improvements, bug fixes, and new features               │
│                                                             │
│                          ▼                                  │
│                                                             │
│  2. CREATE ISSUES                                           │
│     GitHub issues are created for each task                 │
│     with detailed descriptions and labels                   │
│                                                             │
│                          ▼                                  │
│                                                             │
│  3. IMPLEMENT (Parallel)                                    │
│     Workers clone the repo, create branches,                │
│     and use Claude to implement each task                   │
│                                                             │
│                          ▼                                  │
│                                                             │
│  4. EVALUATE                                                │
│     Build verification, test execution,                     │
│     and health checks validate each change                  │
│                                                             │
│                          ▼                                  │
│                                                             │
│  5. MERGE                                                   │
│     PRs are created and auto-merged                         │
│     (if all checks pass and auto-merge is enabled)          │
│                                                             │
│                          ▼                                  │
│                                                             │
│  ↩ REPEAT                                                  │
│     Wait for configured interval, then start again          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Next Steps

- **Monitor progress**: `autonomous-dev status`
- **Adjust settings**: Edit `autonomous-dev.config.json`
- **Add manual tasks**: Create GitHub issues with the `autonomous-dev` label
- **Review PRs**: Check GitHub for auto-created pull requests

## Common Issues

### "GitHub token not configured"
Make sure `GITHUB_TOKEN` is set and the token has `repo` scope.

### "Claude auth not configured"
Ensure `CLAUDE_ACCESS_TOKEN` is set with a valid Claude API token.

### No tasks discovered
- Try increasing `--count` to 10
- Check that `excludePaths` isn't filtering too many files
- Ensure the repository has code to analyze

See [Troubleshooting Guide](./troubleshooting.md) for more help.

## Need More Help?

- [Full Configuration Guide](./configuration.md)
- [Database Setup](./database-setup.md)
- [Troubleshooting](./troubleshooting.md)
- [Security Best Practices](./security.md)

---

*Documentation last updated: December 14, 2025*
