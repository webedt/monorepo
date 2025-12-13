# Documentation

This directory serves as the documentation hub for the monorepo projects.

## Project Documentation

| Project | Documentation |
|---------|---------------|
| **Autonomous Dev CLI** | [Complete Documentation](../autonomous-dev-cli/README.md) |
| **AI Coding Worker** | [Documentation](../ai-coding-worker/README.md) |
| **Internal API Server** | [Documentation](../internal-api-server/README.md) |

## Autonomous Dev CLI

The **Autonomous Dev CLI** is the main focus of this documentation. It's a powerful tool for autonomous codebase development.

### Quick Links

| Topic | Link |
|-------|------|
| Quick Start Guide | [quick-start.md](../autonomous-dev-cli/docs/quick-start.md) |
| Configuration Reference | [configuration.md](../autonomous-dev-cli/docs/configuration.md) |
| GitHub Setup | [github-setup.md](../autonomous-dev-cli/docs/github-setup.md) |
| Claude API Setup | [claude-setup.md](../autonomous-dev-cli/docs/claude-setup.md) |
| Database Setup | [database-setup.md](../autonomous-dev-cli/docs/database-setup.md) |
| Security Best Practices | [security.md](../autonomous-dev-cli/docs/security.md) |
| Troubleshooting | [troubleshooting.md](../autonomous-dev-cli/docs/troubleshooting.md) |

### Getting Started

1. **Prerequisites**
   - Node.js >= 20.0.0
   - GitHub personal access token
   - Claude API credentials
   - PostgreSQL (optional, for credential storage)

2. **Installation**
   ```bash
   cd autonomous-dev-cli
   npm install
   npm run build
   npm link  # optional, for global access
   ```

3. **Initialize Configuration**
   ```bash
   autonomous-dev init
   ```

4. **Start Autonomous Development**
   ```bash
   autonomous-dev start
   ```

For complete setup instructions, see the [Quick Start Guide](../autonomous-dev-cli/docs/quick-start.md).

## Architecture

For an overview of how the monorepo projects work together, see [CLAUDE.md](../CLAUDE.md) in the repository root.

## Contributing

We welcome contributions! Please see the [Contributing Guidelines](../autonomous-dev-cli/README.md#contributing) for details on how to submit pull requests, report issues, and contribute to development.
