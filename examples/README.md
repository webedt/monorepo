# Example Configurations

This directory contains example configuration files for the **Autonomous Dev CLI**.

## Files

| File | Description |
|------|-------------|
| `config.json` | Complete example configuration with all options documented |

## Usage

### Copy to CLI directory

```bash
cp examples/config.json autonomous-dev-cli/autonomous-dev.config.json
```

Then edit the file to configure your repository settings.

### Required Changes

At minimum, you must update:

1. **Repository settings**:
   ```json
   "repo": {
     "owner": "your-github-username",
     "name": "your-repository-name"
   }
   ```

2. **Environment variables** (in `autonomous-dev-cli/.env`):
   ```bash
   GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxx
   ```

## Additional Examples

More specialized configuration examples are available in `autonomous-dev-cli/examples/`:

- `minimal.config.json` - Simplest configuration with defaults
- `conservative.config.json` - Safe, review-focused for production
- `aggressive.config.json` - Fast, high-throughput for side projects
- `monorepo.config.json` - Optimized for monorepo projects
- `ci-cd.config.json` - For scheduled CI/CD runs

## Documentation

For complete documentation, see:

- [Quick Start Guide](../autonomous-dev-cli/docs/quick-start.md)
- [Configuration Reference](../autonomous-dev-cli/docs/configuration.md)
- [Full README](../autonomous-dev-cli/README.md)
