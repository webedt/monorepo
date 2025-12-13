# Security Best Practices

This guide covers security considerations and best practices for using the Autonomous Dev CLI safely.

## Overview

The CLI requires access to sensitive credentials:
- **GitHub tokens** with repository access
- **Claude API tokens** for AI-powered analysis
- **Database credentials** (optional) for centralized credential storage

Proper handling of these credentials is essential to prevent unauthorized access to your repositories and APIs.

## Credential Security

### Never Commit Credentials

**Rule #1**: Never commit credentials to version control.

Add these to your `.gitignore`:

```gitignore
# Environment files with credentials
.env
.env.local
.env.*.local

# Config files that might contain credentials
autonomous-dev.config.json
!autonomous-dev.config.example.json
```

### Use Environment Variables

**Recommended approach**: Store credentials in environment variables, not config files.

```bash
# Good: Environment variables
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
export CLAUDE_ACCESS_TOKEN="sk-ant-oat01-xxxxxxxxxxxx"

# Bad: Config file with credentials
{
  "credentials": {
    "githubToken": "ghp_xxxxxxxxxxxx"  // DON'T DO THIS
  }
}
```

### Secure .env Files

If using a `.env` file:

1. **Set restrictive permissions:**
   ```bash
   chmod 600 .env
   ```

2. **Keep it local:** Never copy `.env` to shared drives or servers without encryption.

3. **Use separate files per environment:**
   ```bash
   .env.development  # Local development
   .env.staging      # Staging environment
   .env.production   # Production (most restrictive)
   ```

### Credential Rotation

Regularly rotate your credentials:

1. **GitHub tokens**: Rotate every 90 days or immediately if compromised
2. **Claude tokens**: Follow Anthropic's recommended rotation schedule
3. **Database passwords**: Rotate according to your security policy

To rotate:
1. Generate new credentials
2. Update environment variables/database
3. Verify the CLI still works: `autonomous-dev config --validate`
4. Revoke old credentials

## GitHub Token Security

### Minimum Required Scopes

Only grant the scopes the CLI actually needs:

| Scope | Required | Purpose |
|-------|----------|---------|
| `repo` | Yes | Create branches, PRs, read code |
| `workflow` | Optional | Trigger GitHub Actions |
| `read:org` | Optional | For organization repos |

**Do not grant:**
- `delete_repo` - Not needed
- `admin:*` - Not needed
- `write:*` (except repo) - Not needed

### Use Fine-Grained Tokens

GitHub offers fine-grained personal access tokens with more precise permissions:

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click "Generate new token"
3. Select only the specific repository
4. Grant minimal permissions:
   - Contents: Read and write
   - Issues: Read and write
   - Pull requests: Read and write
   - Metadata: Read-only

### Token Expiration

Set token expiration for automatic rotation:

- Development: 90 days
- CI/CD: 30-90 days
- Production: 7-30 days (with automated rotation)

## Claude API Security

### Access Token Protection

Claude access tokens provide full API access:

- **Never share tokens** across users or projects
- **Monitor usage** via the Claude Console
- **Set up alerts** for unusual API usage

### Refresh Token Handling

The refresh token is used to obtain new access tokens:

- Store as securely as the access token
- Used automatically when the access token expires
- If compromised, revoke immediately in Claude Console

### Rate Limiting

Be mindful of API rate limits to avoid:
- Unexpected charges
- Service disruption
- Detection as abuse

Configure conservatively:
```json
{
  "execution": {
    "parallelWorkers": 4  // Don't exceed your rate limit tier
  },
  "daemon": {
    "loopIntervalMs": 60000  // Allow time between cycles
  }
}
```

## Database Security

If using database credential storage:

### Connection Security

Always use SSL for production databases:

```bash
# Good: SSL enabled
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require

# Better: Full SSL verification
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=verify-full&sslrootcert=/path/to/ca.crt
```

### Minimal Permissions

Create a dedicated database user with minimal permissions:

```sql
-- Create restricted user
CREATE USER autonomous_dev_user WITH PASSWORD 'secure_password';

-- Grant only SELECT on users table
GRANT SELECT ON users TO autonomous_dev_user;

-- Revoke all other permissions
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM autonomous_dev_user;
GRANT SELECT ON users TO autonomous_dev_user;
```

### Credential Storage

If storing credentials in the database:

1. **Consider encryption at rest** for the credentials columns
2. **Limit network access** to the database
3. **Audit access logs** regularly
4. **Use secrets management** (HashiCorp Vault, AWS Secrets Manager) for production

## CI/CD Security

When running in CI/CD pipelines:

### GitHub Actions

Use GitHub Secrets:

```yaml
jobs:
  autonomous-dev:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run autonomous dev
        env:
          GITHUB_TOKEN: ${{ secrets.AUTONOMOUS_DEV_GITHUB_TOKEN }}
          CLAUDE_ACCESS_TOKEN: ${{ secrets.CLAUDE_ACCESS_TOKEN }}
        run: |
          npm ci
          npm run build
          autonomous-dev run
```

**Best practices:**
- Use dedicated tokens for CI (not personal tokens)
- Set token expiration
- Limit token scope to specific repositories
- Use environment-level secrets for sensitive data

### Other CI Systems

- **Jenkins**: Use Jenkins Credentials Manager
- **CircleCI**: Use Context secrets
- **GitLab CI**: Use CI/CD Variables (masked)

## Network Security

### Outbound Connections

The CLI connects to:

| Service | Endpoint | Port |
|---------|----------|------|
| GitHub API | api.github.com | 443 |
| Claude API | api.anthropic.com | 443 |
| Database | (configured) | 5432 |

Ensure firewalls allow these connections.

### Proxy Configuration

If behind a corporate proxy:

```bash
export HTTPS_PROXY=https://proxy.example.com:8080
export HTTP_PROXY=http://proxy.example.com:8080
```

## Audit and Monitoring

### Activity Logging

Enable verbose logging for audit trails:

```bash
autonomous-dev start --verbose 2>&1 | tee -a /var/log/autonomous-dev.log
```

### GitHub Audit Log

Monitor the GitHub audit log for:
- Repository access patterns
- Branch creation/deletion
- PR creation and merges

### Alerts

Set up alerts for:
- Failed authentication attempts
- Unusual API usage patterns
- After-hours activity (if unexpected)

## Incident Response

If credentials are compromised:

### Immediate Actions

1. **Revoke the compromised token immediately**
   - GitHub: Settings > Developer settings > Personal access tokens
   - Claude: Claude Console > API Keys

2. **Generate new credentials**

3. **Update all systems** using the compromised credentials

4. **Check for unauthorized activity**
   - Review GitHub audit log
   - Check Claude API usage
   - Review PR history

### Post-Incident

1. **Determine how the compromise occurred**
2. **Update security practices** to prevent recurrence
3. **Document the incident** for future reference
4. **Consider notifying affected parties** if necessary

## Security Checklist

Before going to production:

- [ ] Credentials stored in environment variables, not config files
- [ ] `.env` files are gitignored
- [ ] GitHub token has minimal required scopes
- [ ] Token expiration is set
- [ ] Database connection uses SSL
- [ ] Database user has minimal permissions
- [ ] CI/CD uses secrets management
- [ ] Verbose logging is enabled for audit
- [ ] Credential rotation schedule is documented
- [ ] Incident response plan is in place

## Additional Resources

- [GitHub Token Best Practices](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Anthropic Security](https://www.anthropic.com/security)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
