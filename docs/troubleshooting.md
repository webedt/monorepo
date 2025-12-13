# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the Autonomous Development System.

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Authentication Issues](#authentication-issues)
- [Configuration Issues](#configuration-issues)
- [Discovery Issues](#discovery-issues)
- [Execution Issues](#execution-issues)
- [Evaluation Issues](#evaluation-issues)
- [Merge Issues](#merge-issues)
- [Performance Issues](#performance-issues)
- [Service Issues](#service-issues)
- [Getting Help](#getting-help)

## Quick Diagnostics

### Diagnostic Commands

```bash
# Validate configuration
autonomous-dev config --validate

# Check current status
autonomous-dev status

# Test discovery with verbose output
autonomous-dev discover -v --count 1

# Run single cycle in dry-run mode
autonomous-dev run --dry-run --verbose
```

### Check Environment

```bash
# Verify Node.js version (requires >= 20.0.0)
node --version

# Check environment variables
env | grep -E "(GITHUB|CLAUDE|DATABASE|REPO)"

# Verify Git configuration
git config --list | grep -E "(user\.|credential)"
```

### Health Checks

```bash
# Test GitHub API connection
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user

# Test repository access
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$REPO_OWNER/$REPO_NAME
```

## Authentication Issues

### "GitHub token not configured"

**Symptoms:**
- Error message: "GitHub token not configured"
- Unable to create issues or PRs

**Causes:**
1. `GITHUB_TOKEN` environment variable not set
2. Token has expired
3. Token doesn't have required permissions

**Solutions:**

1. **Set the environment variable:**
   ```bash
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   ```

2. **Verify token permissions:**
   - Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
   - Ensure token has `repo` scope
   - If using fine-grained tokens, grant:
     - Repository access: Selected repositories or All repositories
     - Permissions: Contents (Read and Write), Issues (Read and Write), Pull requests (Read and Write)

3. **Check token validity:**
   ```bash
   curl -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/user
   # Should return your user info, not "Bad credentials"
   ```

4. **Regenerate if expired:**
   - Generate a new token at [GitHub Settings](https://github.com/settings/tokens/new)
   - Update your environment variable

---

### "Claude auth not configured"

**Symptoms:**
- Error message: "Claude auth not configured"
- Task discovery fails
- AI implementation doesn't run

**Causes:**
1. Missing Claude API credentials
2. Tokens have expired
3. Database lookup failed

**Solutions:**

1. **Set environment variables directly:**
   ```bash
   export CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxx
   export CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxx
   ```

2. **If using database storage, verify:**
   ```bash
   # Check database connection
   psql $DATABASE_URL -c "SELECT email, claude_auth IS NOT NULL as has_auth FROM users WHERE email = '$USER_EMAIL'"
   ```

3. **Refresh tokens if expired:**
   - Re-authenticate through your OAuth flow
   - Update tokens in database or environment

---

### "User not found in database"

**Symptoms:**
- Error message: "User not found in database"
- Credentials not loading

**Causes:**
1. `USER_EMAIL` doesn't match any database record
2. Database connection failed
3. User record doesn't exist

**Solutions:**

1. **Verify email matches:**
   ```bash
   echo $USER_EMAIL
   psql $DATABASE_URL -c "SELECT email FROM users"
   ```

2. **Check database connection:**
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```

3. **Create user if missing:**
   ```sql
   INSERT INTO users (id, email, github_access_token, claude_auth)
   VALUES (
     gen_random_uuid(),
     'your.email@example.com',
     'ghp_xxxx',
     '{"accessToken": "sk-ant-oat01-xxxx", "refreshToken": "sk-ant-ort01-xxxx"}'::jsonb
   );
   ```

## Configuration Issues

### "Configuration validation failed"

**Symptoms:**
- Error message listing validation errors
- CLI refuses to start

**Causes:**
1. Invalid JSON syntax
2. Values outside allowed ranges
3. Missing required fields

**Solutions:**

1. **Check JSON syntax:**
   ```bash
   # Validate JSON syntax
   cat autonomous-dev.config.json | python -m json.tool
   ```

2. **Run validation:**
   ```bash
   autonomous-dev config --validate
   ```

3. **Common fixes:**
   ```json
   // ❌ Wrong: parallelWorkers > 10
   "parallelWorkers": 20

   // ✅ Right: within range 1-10
   "parallelWorkers": 8
   ```

4. **Check required fields:**
   ```json
   {
     "repo": {
       "owner": "your-username",  // Required
       "name": "your-repo"         // Required
     }
   }
   ```

5. **View valid options:**
   ```bash
   autonomous-dev help-config
   ```

---

### "Config file not found"

**Symptoms:**
- Warning about missing config file
- Using all defaults

**Solutions:**

1. **Create config file:**
   ```bash
   autonomous-dev init
   ```

2. **Check file location:**
   - `./autonomous-dev.config.json`
   - `./autonomous-dev.json`
   - `./.autonomous-dev.json`

3. **Specify path explicitly:**
   ```bash
   autonomous-dev start -c /path/to/config.json
   ```

## Discovery Issues

### Tasks not being discovered

**Symptoms:**
- "No tasks discovered" message
- Empty task list despite code issues

**Causes:**
1. Claude API credentials invalid
2. Repository too small or clean
3. `excludePaths` too restrictive
4. Rate limiting

**Solutions:**

1. **Run verbose discovery:**
   ```bash
   autonomous-dev discover -v --count 10
   ```

2. **Check Claude credentials:**
   - Verify tokens are valid
   - Check for expiration

3. **Review exclude paths:**
   ```json
   // Too restrictive
   "excludePaths": ["*"]

   // Better
   "excludePaths": ["node_modules", "dist", ".git"]
   ```

4. **Check rate limits:**
   - Wait and retry after a few minutes
   - Reduce `tasksPerCycle`

---

### "Deduplication removing all tasks"

**Symptoms:**
- Tasks discovered but all marked as duplicates

**Causes:**
1. Existing open issues already cover tasks
2. Similar tasks in backlog

**Solutions:**

1. **Check existing issues:**
   ```bash
   autonomous-dev status
   ```

2. **Review open issues on GitHub:**
   - Close completed issues
   - Check for stale issues

3. **Increase `maxOpenIssues`:**
   ```json
   "discovery": {
     "maxOpenIssues": 20
   }
   ```

## Execution Issues

### "Task execution timeout"

**Symptoms:**
- Tasks killed after timeout
- Incomplete implementations

**Causes:**
1. `timeoutMinutes` too short
2. Complex tasks taking too long
3. Network issues slowing operations

**Solutions:**

1. **Increase timeout:**
   ```json
   "execution": {
     "timeoutMinutes": 60  // Up from default 30
   }
   ```

2. **Reduce task complexity:**
   - Break large tasks into smaller ones
   - Focus on simpler improvements

3. **Check network:**
   ```bash
   ping github.com
   ```

---

### "Worker stuck in busy state"

**Symptoms:**
- Workers not picking up new tasks
- Pool appears frozen

**Solutions:**

1. **Restart the daemon:**
   ```bash
   # Send SIGINT to gracefully stop
   kill -INT <pid>

   # Restart
   autonomous-dev start
   ```

2. **Check for zombie processes:**
   ```bash
   ps aux | grep autonomous-dev
   kill -9 <zombie-pid>
   ```

3. **Clear work directory:**
   ```bash
   rm -rf /tmp/autonomous-dev/*
   ```

---

### "Clone failed" or "Push failed"

**Symptoms:**
- Git operations failing
- "Permission denied" errors

**Causes:**
1. Invalid GitHub token
2. Repository doesn't exist
3. Network issues
4. SSH key problems

**Solutions:**

1. **Verify repository access:**
   ```bash
   git ls-remote https://github.com/$REPO_OWNER/$REPO_NAME.git
   ```

2. **Check token has push access:**
   ```bash
   # Should show repo scope
   curl -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/user | jq '.scopes'
   ```

3. **Test clone manually:**
   ```bash
   git clone https://$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git /tmp/test
   ```

## Evaluation Issues

### "Build failed"

**Symptoms:**
- Evaluation fails at build step
- TypeScript compilation errors

**Causes:**
1. Implementation introduced bugs
2. Missing dependencies
3. Incompatible changes

**Solutions:**

1. **Review the PR diff on GitHub**

2. **Check build locally:**
   ```bash
   cd /tmp/autonomous-dev/task-*/repo
   npm install
   npm run build
   ```

3. **Skip problematic patterns:**
   ```json
   "discovery": {
     "excludePaths": [
       "problematic-area/**"
     ]
   }
   ```

4. **Disable build requirement (not recommended):**
   ```json
   "evaluation": {
     "requireBuild": false
   }
   ```

---

### "Tests failed"

**Symptoms:**
- Evaluation fails at test step
- Test suite errors

**Causes:**
1. Implementation broke tests
2. Missing test dependencies
3. Flaky tests

**Solutions:**

1. **Check test output:**
   ```bash
   autonomous-dev run --verbose
   ```

2. **Run tests locally:**
   ```bash
   cd /tmp/autonomous-dev/task-*/repo
   npm test
   ```

3. **Disable test requirement (not recommended for production):**
   ```json
   "evaluation": {
     "requireTests": false
   }
   ```

---

### "Health check failed"

**Symptoms:**
- Evaluation fails at health check
- Preview URLs not responding

**Causes:**
1. Preview deployment not ready
2. URL pattern incorrect
3. Service unavailable

**Solutions:**

1. **Check preview URL pattern:**
   ```json
   "evaluation": {
     "previewUrlPattern": "https://preview.example.com/{owner}/{repo}/{branch}/"
   }
   ```

2. **Test URL manually:**
   ```bash
   curl -I "https://preview.example.com/owner/repo/branch/"
   ```

3. **Wait for deployment:**
   - Preview deployments may take time
   - Check CI/CD pipeline status

4. **Disable health checks:**
   ```json
   "evaluation": {
     "requireHealthCheck": false
   }
   ```

## Merge Issues

### "PRs failing to merge"

**Symptoms:**
- PRs created but not merged
- "Cannot merge" errors

**Causes:**
1. CI checks failing
2. Branch protection rules
3. Merge conflicts
4. Reviews required

**Solutions:**

1. **Check CI status:**
   - View PR on GitHub
   - Check Actions tab for failures

2. **Review branch protection:**
   - Go to Settings > Branches > Branch protection rules
   - Check required reviews, status checks

3. **Try manual merge:**
   ```bash
   gh pr merge <number> --squash
   ```

4. **Use manual conflict strategy:**
   ```json
   "merge": {
     "conflictStrategy": "manual"
   }
   ```

---

### "Merge conflicts"

**Symptoms:**
- "Merge conflict" errors
- Rebase failing

**Causes:**
1. Concurrent changes to same files
2. Base branch updated

**Solutions:**

1. **Reduce parallel workers:**
   ```json
   "execution": {
     "parallelWorkers": 2
   }
   ```

2. **Use merge strategy:**
   ```json
   "merge": {
     "conflictStrategy": "merge"
   }
   ```

3. **Resolve manually:**
   ```bash
   git fetch origin
   git checkout auto/42-fix-bug
   git rebase origin/main
   # Resolve conflicts
   git push --force-with-lease
   ```

---

### "Required status checks not passing"

**Symptoms:**
- PR blocked by failing checks
- "Waiting for status checks" forever

**Causes:**
1. CI workflows failing
2. Required checks not running
3. Stuck checks

**Solutions:**

1. **Re-run checks:**
   ```bash
   gh pr checks <number> --watch
   gh run rerun <run-id>
   ```

2. **Check required status:**
   - Settings > Branches > Protection rules
   - Verify check names match

3. **Skip checks (if admin):**
   ```bash
   gh pr merge <number> --admin
   ```

## Performance Issues

### "Daemon running slowly"

**Symptoms:**
- Cycles taking too long
- Memory usage high

**Causes:**
1. Too many parallel workers
2. Cache disabled
3. Large repository

**Solutions:**

1. **Reduce workers:**
   ```json
   "execution": {
     "parallelWorkers": 2
   }
   ```

2. **Enable caching:**
   ```json
   "cache": {
     "enabled": true,
     "persistToDisk": true
   }
   ```

3. **Exclude unnecessary paths:**
   ```json
   "discovery": {
     "excludePaths": [
       "node_modules",
       "dist",
       "coverage",
       "**/*.test.ts",
       "**/fixtures/**"
     ]
   }
   ```

---

### "High memory usage"

**Symptoms:**
- Out of memory errors
- System slowdown

**Causes:**
1. Too many workers
2. Large files in cache
3. Memory leaks

**Solutions:**

1. **Reduce workers:**
   ```json
   "execution": {
     "parallelWorkers": 2
   }
   ```

2. **Limit cache size:**
   ```json
   "cache": {
     "maxSizeMB": 50,
     "maxEntries": 50
   }
   ```

3. **Use process manager:**
   ```bash
   # PM2 with memory limit
   pm2 start autonomous-dev --max-memory-restart 1G -- start
   ```

4. **Monitor memory:**
   ```bash
   # Watch memory usage
   watch -n 5 'ps aux | grep autonomous-dev'
   ```

## Service Issues

### "Circuit breaker open"

**Symptoms:**
- "Circuit breaker open" errors
- API calls failing fast

**Causes:**
1. API rate limiting
2. Service outage
3. Network issues

**Solutions:**

1. **Wait for reset:**
   - Circuit auto-resets after `resetTimeoutMs` (default 60s)
   - Watch logs for "Circuit closed" message

2. **Adjust thresholds:**
   ```json
   "circuitBreaker": {
     "failureThreshold": 10,
     "resetTimeoutMs": 120000
   }
   ```

3. **Check service status:**
   - [GitHub Status](https://www.githubstatus.com/)
   - [Anthropic Status](https://status.anthropic.com/)

---

### "Database connection failed"

**Symptoms:**
- "Connection refused" errors
- Credential lookup failing

**Causes:**
1. Database server down
2. Invalid connection string
3. Network issues
4. SSL configuration

**Solutions:**

1. **Test connection:**
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```

2. **Check connection string format:**
   ```bash
   # Standard format
   postgresql://user:password@host:5432/database

   # With SSL
   postgresql://user:password@host:5432/database?sslmode=require
   ```

3. **Verify network access:**
   ```bash
   nc -zv hostname 5432
   ```

4. **Use direct credentials instead:**
   ```bash
   # Skip database, use env vars
   export GITHUB_TOKEN=ghp_xxxx
   export CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxx
   unset DATABASE_URL
   ```

## Getting Help

### Collect Diagnostic Information

Before seeking help, collect:

```bash
# System info
uname -a
node --version
npm --version

# Configuration (sanitized)
autonomous-dev config 2>&1 | sed 's/ghp_[a-zA-Z0-9]*/ghp_****/g'

# Recent logs
tail -100 ./logs/autonomous-dev.log

# Status
autonomous-dev status
```

### Where to Get Help

1. **Documentation:**
   - [Architecture Guide](./architecture.md)
   - [Configuration Guide](./configuration.md)
   - [API Reference](./api-reference.md)

2. **GitHub Issues:**
   - [Open an issue](https://github.com/webedt/monorepo/issues/new)
   - Search existing issues first

3. **Community:**
   - Check discussions on GitHub

### Reporting Bugs

When reporting bugs, include:

1. **Description:** What happened vs. what you expected
2. **Steps to reproduce:** Minimal steps to reproduce
3. **Environment:** Node version, OS, config
4. **Logs:** Relevant error messages (sanitize credentials!)
5. **Config:** Relevant configuration (sanitize credentials!)

**Example bug report:**

```markdown
## Bug: Discovery fails with timeout

### Description
Running `autonomous-dev discover` times out after 5 minutes without results.

### Steps to Reproduce
1. Clone repo: `git clone https://github.com/example/repo`
2. Configure: `autonomous-dev init`
3. Run: `autonomous-dev discover -v`

### Expected
Should discover 5 tasks within 2 minutes.

### Actual
Times out with: "Discovery timeout after 300000ms"

### Environment
- Node: v20.10.0
- OS: Ubuntu 22.04
- Config: [attached]

### Logs
```
[timestamp] INFO Starting discovery...
[timestamp] DEBUG Analyzing codebase...
[timestamp] ERROR Discovery timeout after 300000ms
```
```

## See Also

- [Architecture Documentation](./architecture.md) - System architecture overview
- [Configuration Guide](./configuration.md) - Complete configuration reference
- [API Reference](./api-reference.md) - Detailed API documentation
