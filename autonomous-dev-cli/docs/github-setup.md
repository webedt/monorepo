# GitHub Token Setup Guide

This guide provides detailed instructions for setting up GitHub authentication for the Autonomous Dev CLI.

## Overview

The CLI requires a GitHub Personal Access Token (PAT) to:
- Read repository contents for analysis
- Create branches for implementation
- Create and manage issues
- Create and merge pull requests

## Token Types

GitHub offers two types of personal access tokens:

### Classic Tokens (Recommended for simplicity)

- Easier to set up
- Broad permission scopes
- Work across all repositories

### Fine-Grained Tokens (Recommended for security)

- Repository-specific permissions
- More granular access control
- Better for production use

## Option 1: Classic Token Setup

### Step 1: Navigate to Token Settings

1. Sign in to [GitHub](https://github.com)
2. Click your profile picture (top right)
3. Click **Settings**
4. Scroll down and click **Developer settings** (left sidebar)
5. Click **Personal access tokens**
6. Click **Tokens (classic)**

Or go directly to: https://github.com/settings/tokens

### Step 2: Generate New Token

1. Click **Generate new token**
2. Select **Generate new token (classic)**

### Step 3: Configure Token

**Note:** Give it a descriptive name like "autonomous-dev-cli"

**Expiration:** Choose an appropriate expiration:
- For testing: 7 days
- For development: 90 days
- For production: No expiration (but rotate regularly)

**Select scopes:**

| Scope | Required | Description |
|-------|----------|-------------|
| `repo` | **Yes** | Full control of private repositories |
| `workflow` | Optional | Update GitHub Action workflows |
| `write:packages` | No | Not needed |
| `delete:packages` | No | Not needed |
| `admin:org` | No | Not needed |
| `admin:public_key` | No | Not needed |
| `admin:repo_hook` | No | Not needed |
| `admin:org_hook` | No | Not needed |
| `gist` | No | Not needed |
| `notifications` | No | Not needed |
| `user` | No | Not needed |
| `delete_repo` | No | **Never grant this** |
| `write:discussion` | No | Not needed |
| `admin:enterprise` | No | Not needed |

**Minimum required:** Just select `repo`

### Step 4: Generate and Copy

1. Click **Generate token**
2. **Copy the token immediately** - you won't see it again!
3. Store it securely (password manager, encrypted notes)

The token looks like: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Option 2: Fine-Grained Token Setup

### Step 1: Navigate to Token Settings

1. Sign in to [GitHub](https://github.com)
2. Click your profile picture (top right)
3. Click **Settings**
4. Scroll down and click **Developer settings**
5. Click **Personal access tokens**
6. Click **Fine-grained tokens**

Or go directly to: https://github.com/settings/tokens?type=beta

### Step 2: Generate New Token

1. Click **Generate new token**

### Step 3: Configure Token

**Token name:** `autonomous-dev-cli`

**Expiration:** 90 days (recommended)

**Description:** Optional, e.g., "Token for autonomous development"

**Resource owner:** Select your username or organization

**Repository access:**
- Select **Only select repositories**
- Choose the specific repository/repositories

### Step 4: Set Permissions

Under **Repository permissions**, set:

| Permission | Access Level | Purpose |
|------------|--------------|---------|
| Contents | Read and write | Read code, create branches, commit |
| Issues | Read and write | Create and manage issues |
| Metadata | Read-only | Basic repository metadata |
| Pull requests | Read and write | Create and merge PRs |
| Workflows | Read and write | (Optional) Trigger Actions |

Leave all other permissions at "No access".

Under **Account permissions**, leave all at "No access".

### Step 5: Generate and Copy

1. Click **Generate token**
2. **Copy the token immediately** - you won't see it again!
3. Store it securely

Fine-grained tokens look like: `github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Configuring the CLI

### Option A: Environment Variable (Recommended)

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Or for the current session only
GITHUB_TOKEN="ghp_xxx" autonomous-dev start
```

### Option B: .env File

Create or edit `.env` in the autonomous-dev-cli directory:

```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Important:** Never commit this file to git. Ensure `.env` is in your `.gitignore`.

### Option C: Database Storage

If using database credential storage:

```sql
UPDATE users
SET github_access_token = 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
WHERE email = 'your.email@example.com';
```

Then configure:
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/db"
export USER_EMAIL="your.email@example.com"
```

## Verifying Your Token

### Check Token Works

```bash
# Test with curl
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# Should return your GitHub user info
```

### Check Token Scopes

```bash
# Check rate limit and scopes
curl -I -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# Look for X-OAuth-Scopes header
```

### Verify with CLI

```bash
# Check configuration
autonomous-dev config

# Should show: GitHub: ✓ configured
```

## Token Permissions Explained

### `repo` Scope (Required)

This scope grants:
- Read access to code and files
- Write access to create branches
- Create commits and push code
- Create and manage pull requests
- Access to private repositories

### `workflow` Scope (Optional)

Only needed if:
- Your repository uses GitHub Actions
- You want auto-created PRs to trigger workflows
- The CLI needs to modify workflow files

Without this scope, workflows may not trigger for CLI-created branches.

## Troubleshooting

### "Bad credentials"

**Cause:** Invalid or expired token

**Solution:**
1. Verify the token exists: `echo $GITHUB_TOKEN`
2. Check it hasn't expired on GitHub
3. Regenerate if necessary

### "Resource not accessible by integration"

**Cause:** Token lacks required scopes

**Solution:**
1. Check token scopes on GitHub Settings
2. Ensure `repo` scope is selected
3. Regenerate with correct scopes

### "Not Found" for repository

**Causes:**
- Repository doesn't exist
- Token doesn't have access to private repo
- Wrong owner/repo name

**Solution:**
1. Verify repository URL is correct
2. Ensure token has `repo` scope (not just `public_repo`)
3. Check REPO_OWNER and REPO_NAME configuration

### Rate Limiting

**Symptoms:**
```
API rate limit exceeded
```

**Solution:**
1. Check current limit:
   ```bash
   curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit
   ```
2. Wait for reset (shown in response)
3. Reduce `tasksPerCycle` and `parallelWorkers`

### Token Expiration

When a token expires:
1. You'll see "Bad credentials" errors
2. Go to GitHub Settings > Developer settings > Personal access tokens
3. Generate a new token
4. Update your environment variable or database

## Security Best Practices

1. **Use minimal scopes** - Only grant what's needed
2. **Set expiration** - Rotate tokens regularly
3. **Use fine-grained tokens** - For better security
4. **Don't commit tokens** - Use environment variables
5. **Audit token usage** - Check GitHub security logs
6. **Revoke unused tokens** - Clean up old tokens

## Multiple Repositories

To use the CLI with multiple repositories:

### Same Organization

A single token with `repo` scope works for all repos you have access to. Just change the configuration:

```bash
REPO_OWNER=my-org REPO_NAME=repo-1 autonomous-dev start
REPO_OWNER=my-org REPO_NAME=repo-2 autonomous-dev start
```

### Different Organizations

For repos across organizations:
- Classic token: Works if you have access to all orgs
- Fine-grained token: Create separate tokens per org/repo

## Organization Policies

Some organizations require:
- Token approval before use
- SSO authentication
- Specific token types

If you see "SSO authorization required":
1. Go to GitHub Settings > Personal access tokens
2. Click on your token
3. Click **Configure SSO**
4. Authorize the token for your organization

## Next Steps

After setting up your GitHub token:
1. [Set up Claude API credentials](./claude-setup.md)
2. [Run the Quick Start guide](./quick-start.md)
3. [Review Security Best Practices](./security.md)
