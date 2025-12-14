# Claude API Setup Guide

This guide provides detailed instructions for setting up Claude API authentication for the Autonomous Dev CLI.

## Overview

The CLI uses Claude AI (via the Claude Agent SDK) to:
- Analyze your codebase for potential improvements
- Discover bugs, features, and enhancements
- Implement changes autonomously
- Review and validate implementations

## Prerequisites

- An Anthropic account with API access
- Claude API plan with sufficient usage quota

## Getting Claude API Credentials

### Step 1: Create an Anthropic Account

1. Go to [Claude Console](https://console.anthropic.com/)
2. Sign up or sign in
3. Complete any required verification

### Step 2: Access API Keys

1. From the Claude Console dashboard
2. Navigate to **API Keys** section
3. Or go directly to: https://console.anthropic.com/settings/keys

### Step 3: Create an API Key

1. Click **Create Key** or **Generate new key**
2. Give it a name like "autonomous-dev-cli"
3. Copy the generated key immediately

**Important:** The key is only shown once. Store it securely.

### API Key Format

Claude API keys follow this format:

- **Access Token:** `sk-ant-oat01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- **Refresh Token:** `sk-ant-ort01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (if provided)

## Configuring the CLI

### Option A: Environment Variables (Recommended)

Add to your shell profile or export directly:

```bash
# Access token (required)
export CLAUDE_ACCESS_TOKEN="sk-ant-oat01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Refresh token (optional, for automatic token refresh)
export CLAUDE_REFRESH_TOKEN="sk-ant-ort01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

For persistent configuration, add to `~/.bashrc`, `~/.zshrc`, or equivalent:

```bash
# Claude API Configuration
export CLAUDE_ACCESS_TOKEN="sk-ant-oat01-..."
export CLAUDE_REFRESH_TOKEN="sk-ant-ort01-..."
```

Then reload:
```bash
source ~/.bashrc  # or ~/.zshrc
```

### Option B: .env File

Create or edit `.env` in the autonomous-dev-cli directory:

```bash
# Claude API Configuration
CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Important:**
- Never commit this file to git
- Ensure `.env` is in your `.gitignore`

### Option C: Configuration File

Add to `autonomous-dev.config.json`:

```json
{
  "credentials": {
    "claudeAuth": {
      "accessToken": "sk-ant-oat01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "refreshToken": "sk-ant-ort01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "expiresAt": 1735689600
    }
  }
}
```

**Note:** Environment variables take precedence over config file settings.

### Option D: Database Storage

For centralized credential management:

```sql
UPDATE users
SET claude_auth = '{
  "accessToken": "sk-ant-oat01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "refreshToken": "sk-ant-ort01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "expiresAt": 1735689600
}'::jsonb
WHERE email = 'your.email@example.com';
```

Then configure database connection:
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/db"
export USER_EMAIL="your.email@example.com"
```

## Verifying Your Configuration

### Check with CLI

```bash
# Validate all configuration
autonomous-dev config --validate

# View current configuration
autonomous-dev config

# Should show: Claude: ✓ configured
```

### Test Discovery

```bash
# Test that Claude API is working
autonomous-dev discover --count 1 --verbose
```

If successful, you'll see discovered tasks. If there's an issue, you'll see an error message.

## Understanding Claude Tokens

### Access Token

- Primary token for API authentication
- Required for all API calls
- Has an expiration date
- Prefix: `sk-ant-oat01-`

### Refresh Token

- Used to obtain new access tokens
- Longer-lived than access tokens
- Optional but recommended
- Prefix: `sk-ant-ort01-`

### Token Expiration

The `expiresAt` field is a Unix timestamp indicating when the access token expires:

```javascript
// Example: January 1, 2025
expiresAt: 1735689600

// To check expiration
const expiresAt = 1735689600;
const expirationDate = new Date(expiresAt * 1000);
console.log(expirationDate.toISOString());
// Output: 2025-01-01T00:00:00.000Z
```

## Rate Limits and Usage

### Understanding Limits

Claude API has rate limits based on your subscription tier:

| Tier | Requests/Min | Tokens/Min |
|------|--------------|------------|
| Free | Limited | Limited |
| Pro | Higher | Higher |
| Team | Highest | Highest |

### Configuring for Your Limits

Adjust CLI settings based on your tier:

**For lower limits:**
```json
{
  "execution": {
    "parallelWorkers": 2
  },
  "discovery": {
    "tasksPerCycle": 3
  },
  "daemon": {
    "loopIntervalMs": 120000
  }
}
```

**For higher limits:**
```json
{
  "execution": {
    "parallelWorkers": 6
  },
  "discovery": {
    "tasksPerCycle": 8
  },
  "daemon": {
    "loopIntervalMs": 30000
  }
}
```

### Monitoring Usage

Monitor your usage in the Claude Console:
1. Go to https://console.anthropic.com/
2. Navigate to Usage or Billing section
3. Review API call counts and token usage

## Troubleshooting

### "Claude auth not configured"

**Cause:** No Claude credentials found

**Solutions:**
1. Check environment variable is set:
   ```bash
   echo $CLAUDE_ACCESS_TOKEN
   ```
2. Verify `.env` file exists and contains the token
3. Check config file has `credentials.claudeAuth`

### "Invalid API key"

**Cause:** Token is malformed or incorrect

**Solutions:**
1. Verify the token starts with `sk-ant-oat01-`
2. Check for copy/paste errors (extra spaces, truncation)
3. Regenerate the key in Claude Console

### "Rate limit exceeded"

**Cause:** Too many API requests

**Solutions:**
1. Reduce `parallelWorkers` in config
2. Increase `loopIntervalMs` between cycles
3. Reduce `tasksPerCycle`
4. Wait and retry later

### "Token expired"

**Cause:** Access token has expired

**Solutions:**
1. Check `expiresAt` timestamp
2. If you have a refresh token, it may auto-refresh
3. Generate a new API key if needed
4. Update your configuration with the new key

### Tasks Not Discovered

**Cause:** Claude API issue or configuration problem

**Debug steps:**
```bash
# Run with verbose logging
autonomous-dev discover --verbose --count 3

# Check the output for error messages
```

**Common issues:**
- API key doesn't have required permissions
- Codebase too small to analyze
- excludePaths filtering too much code

## Security Best Practices

### Protect Your API Key

1. **Never commit to git:**
   ```gitignore
   .env
   autonomous-dev.config.json
   ```

2. **Use environment variables** over config files

3. **Set restrictive file permissions:**
   ```bash
   chmod 600 .env
   ```

### Monitor for Abuse

1. Check Claude Console usage regularly
2. Set up billing alerts
3. Review API call patterns

### Rotate Keys

If you suspect compromise:
1. Go to Claude Console > API Keys
2. Delete the compromised key
3. Generate a new key
4. Update all systems using the old key

## Advanced: OAuth Flow

The CLI uses OAuth-style authentication. The typical flow:

```
1. Initial Authentication
   └── User provides access token and refresh token

2. API Call
   └── Access token is sent with each request

3. Token Expiration
   └── If access token expires:
       a. Use refresh token to get new access token
       b. Continue with new token

4. Refresh Token Expiration
   └── User must re-authenticate (get new tokens)
```

### Handling Token Refresh

The CLI automatically handles token refresh when:
- A refresh token is provided
- The access token is expired or near expiration

If automatic refresh fails, you'll need to generate new credentials.

## Multiple Projects

You can use the same Claude credentials across multiple projects. The credentials aren't project-specific.

For different environments:

```bash
# Development
export CLAUDE_ACCESS_TOKEN="sk-ant-oat01-dev-token"

# Production
export CLAUDE_ACCESS_TOKEN="sk-ant-oat01-prod-token"
```

## API Usage Costs

Be aware of potential costs:
- Claude API calls consume tokens
- Each task discovery uses API calls
- Each implementation uses API calls

Monitor usage to avoid unexpected charges:
1. Set billing alerts in Claude Console
2. Use conservative settings initially
3. Scale up as you understand usage patterns

## Next Steps

After setting up Claude credentials:
1. [Set up GitHub token](./github-setup.md)
2. [Run the Quick Start guide](./quick-start.md)
3. [Review Security Best Practices](./security.md)

## Getting Help

- [Anthropic Documentation](https://docs.anthropic.com/)
- [Claude Console](https://console.anthropic.com/)
- [Troubleshooting Guide](./troubleshooting.md)

---

*Documentation last updated: December 14, 2025*
