# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the Autonomous Dev CLI.

## Quick Diagnostics

Before diving into specific issues, run these commands to check your setup:

```bash
# Validate configuration
autonomous-dev config --validate

# Show current configuration (check credentials are detected)
autonomous-dev config

# Test task discovery with verbose output
autonomous-dev discover -v --count 1
```

## Common Issues

### Configuration Issues

#### "Configuration validation failed"

**Symptoms:**
```
Configuration validation failed:
  repo.owner: Repository owner is required
```

**Causes:**
- Missing required configuration values
- Invalid value types or formats
- Out-of-range numeric values

**Solutions:**

1. Check the specific field mentioned in the error
2. Verify JSON syntax in config file:
   ```bash
   cat autonomous-dev.config.json | python -m json.tool
   ```
3. Use the init wizard to create a valid config:
   ```bash
   autonomous-dev init --force
   ```
4. Set missing values via environment variables:
   ```bash
   export REPO_OWNER=your-username
   export REPO_NAME=your-repo
   ```

#### "Config file parse error"

**Symptoms:**
```
Failed to parse config file: Unexpected token...
```

**Causes:**
- Invalid JSON syntax
- Trailing commas
- Missing quotes

**Solutions:**

1. Validate JSON syntax:
   ```bash
   cat autonomous-dev.config.json | python -m json.tool
   ```
2. Check for common issues:
   - Trailing commas before `}`
   - Single quotes instead of double quotes
   - Unescaped special characters
3. Use a JSON validator website to find the exact error location

### Authentication Issues

#### "GitHub token not configured"

**Symptoms:**
```
GitHub token not configured
```

**Causes:**
- `GITHUB_TOKEN` environment variable not set
- Database doesn't have token for user
- Config file missing `credentials.githubToken`

**Solutions:**

1. Set environment variable:
   ```bash
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   ```
2. Verify token is valid:
   ```bash
   curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
   ```
3. Check database credentials:
   ```sql
   SELECT github_access_token FROM users WHERE email = 'your@email.com';
   ```

#### "Claude auth not configured"

**Symptoms:**
```
Claude authentication not configured
```

**Causes:**
- `CLAUDE_ACCESS_TOKEN` not set
- Database doesn't have Claude auth for user
- Claude credentials expired

**Solutions:**

1. Set environment variables:
   ```bash
   export CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxx
   export CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxx
   ```
2. Check database:
   ```sql
   SELECT claude_auth FROM users WHERE email = 'your@email.com';
   ```
3. Verify tokens are not expired

#### "User not found in database"

**Symptoms:**
```
User not found in database: your@email.com
```

**Causes:**
- Email doesn't exist in database
- Typo in `USER_EMAIL`
- Database connection to wrong database

**Solutions:**

1. Verify the exact email:
   ```sql
   SELECT email FROM users;
   ```
2. Check `USER_EMAIL` environment variable:
   ```bash
   echo $USER_EMAIL
   ```
3. Verify database connection:
   ```bash
   psql "$DATABASE_URL" -c "SELECT email FROM users LIMIT 5"
   ```

### GitHub API Issues

#### "Repository not found"

**Symptoms:**
```
Not Found - Repository not found
```

**Causes:**
- Repository doesn't exist
- Token doesn't have access to the repo
- Private repo but token lacks `repo` scope

**Solutions:**

1. Verify repository exists and URL is correct
2. Check token scopes:
   ```bash
   curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/repos/owner/repo
   ```
3. For private repos, ensure token has `repo` scope

#### "API rate limit exceeded"

**Symptoms:**
```
API rate limit exceeded
```

**Causes:**
- Too many API requests
- Token is unauthenticated (lower limits)

**Solutions:**

1. Check current rate limit:
   ```bash
   curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit
   ```
2. Reduce `tasksPerCycle` and `parallelWorkers`
3. Increase `loopIntervalMs` between cycles
4. Wait for rate limit to reset

#### "Unable to create issue"

**Symptoms:**
```
Failed to create issue
```

**Causes:**
- Issues disabled on repository
- Insufficient permissions
- Repository is a fork with issues disabled

**Solutions:**

1. Check if issues are enabled on the repository
2. Verify token has write access
3. For forks, enable issues in repository settings

### Task Discovery Issues

#### Tasks not being discovered

**Symptoms:**
- `discover` command returns 0 tasks
- "Discovered 0 new tasks"

**Causes:**
- Claude API credentials invalid
- Codebase too small or empty
- All improvements already addressed
- `excludePaths` filtering too much

**Solutions:**

1. Run with verbose logging:
   ```bash
   autonomous-dev discover -v -n 5
   ```
2. Check excludePaths isn't too aggressive:
   ```json
   {
     "discovery": {
       "excludePaths": ["node_modules", "dist"]
     }
   }
   ```
3. Try requesting more tasks:
   ```bash
   autonomous-dev discover -n 10
   ```
4. Verify Claude credentials are working

#### Duplicate tasks being created

**Symptoms:**
- Similar issues being created repeatedly
- Tasks that already have open issues

**Causes:**
- `issueLabel` doesn't match existing issues
- Issues created without the label
- Discovery not checking existing issues

**Solutions:**

1. Verify issue label in config matches existing issues:
   ```json
   {
     "discovery": {
       "issueLabel": "autonomous-dev"
     }
   }
   ```
2. Add the label to existing issues manually
3. Increase `maxOpenIssues` to reduce discovery frequency

### Execution Issues

#### Worker timeouts

**Symptoms:**
```
Task timed out after 30 minutes
```

**Causes:**
- Complex task taking too long
- Claude API slow or unresponsive
- Build/test taking too long

**Solutions:**

1. Increase timeout:
   ```json
   {
     "execution": {
       "timeoutMinutes": 60
     }
   }
   ```
2. Reduce task complexity via issue descriptions
3. Check network connectivity

#### Build failures

**Symptoms:**
```
Build verification failed
```

**Causes:**
- Claude implementation has syntax errors
- Missing dependencies
- TypeScript errors

**Solutions:**

1. Review the PR diff on GitHub
2. Check build output in logs:
   ```bash
   autonomous-dev run -v
   ```
3. Disable build requirement temporarily:
   ```json
   {
     "evaluation": {
       "requireBuild": false
     }
   }
   ```
4. Fix the issue manually and let daemon retry

#### Test failures

**Symptoms:**
```
Tests failed
```

**Causes:**
- Implementation broke existing tests
- New code isn't covered by tests
- Flaky tests

**Solutions:**

1. Review failing tests in GitHub Actions
2. Disable test requirement temporarily:
   ```json
   {
     "evaluation": {
       "requireTests": false
     }
   }
   ```
3. Add patterns to `excludePaths` for problematic areas

### Merge Issues

#### PRs failing to merge

**Symptoms:**
```
Failed to merge PR
```

**Causes:**
- CI checks failing
- Branch protection rules
- Merge conflicts

**Solutions:**

1. Check GitHub Actions status on the PR
2. Review branch protection rules
3. Try manual conflict resolution:
   ```json
   {
     "merge": {
       "conflictStrategy": "manual"
     }
   }
   ```

#### Merge conflicts

**Symptoms:**
```
Merge conflict detected
```

**Causes:**
- Multiple PRs modifying same files
- Base branch changed during work
- High parallelization

**Solutions:**

1. Reduce parallel workers:
   ```json
   {
     "execution": {
       "parallelWorkers": 2
     }
   }
   ```
2. Use rebase strategy:
   ```json
   {
     "merge": {
       "conflictStrategy": "rebase",
       "maxRetries": 5
     }
   }
   ```
3. Merge PRs manually and let daemon continue

### Daemon Issues

#### Daemon stops unexpectedly

**Symptoms:**
- Process exits without error message
- Daemon dies after some time

**Causes:**
- Unhandled exception
- Out of memory
- Network timeout

**Solutions:**

1. Run with verbose logging:
   ```bash
   autonomous-dev start -v
   ```
2. Check system resources:
   ```bash
   free -m
   df -h
   ```
3. Use a process manager:
   ```bash
   pm2 start "autonomous-dev start" --name auto-dev
   ```

#### High memory usage

**Symptoms:**
- Process using excessive memory
- System slowing down

**Causes:**
- Too many parallel workers
- Large repository clones
- Memory leaks

**Solutions:**

1. Reduce parallel workers:
   ```json
   {
     "execution": {
       "parallelWorkers": 2
     }
   }
   ```
2. Use a dedicated work directory with cleanup:
   ```json
   {
     "execution": {
       "workDir": "/tmp/autonomous-dev"
     }
   }
   ```

## Getting Help

If you can't resolve an issue:

1. **Check logs**: Run with `-v` flag for verbose output
2. **Validate config**: Run `autonomous-dev config` to see current settings
3. **Check GitHub**: Look at issue comments and PR statuses
4. **Review documentation**: Check the README and other docs
5. **Open an issue**: Create a GitHub issue with:
   - Error message
   - Configuration (without credentials)
   - Steps to reproduce
   - Output from `autonomous-dev config`

## Debug Mode

For deep debugging, set environment variables:

```bash
# Enable Node.js debugging
DEBUG=* autonomous-dev start

# Enable verbose logging
autonomous-dev start --verbose

# Dry run (no changes)
autonomous-dev start --dry-run --verbose
```

---

*Documentation last updated: December 14, 2025*
