# Example Configurations

This directory contains example configuration files for different use cases.

## Available Examples

### minimal.config.json

The simplest possible configuration. Uses all default values with just the required repository settings.

**Best for:**
- Getting started quickly
- Testing the CLI
- Simple projects

### conservative.config.json

A careful, human-review-focused configuration. Creates fewer tasks, disables auto-merge, and uses manual conflict resolution.

**Best for:**
- Production applications
- Teams requiring code review
- Projects with strict quality requirements
- Organizations with compliance needs

**Key settings:**
- `autoMerge: false` - Requires manual PR approval
- `parallelWorkers: 2` - Slower but more controlled
- `conflictStrategy: "manual"` - Human handles conflicts
- `loopIntervalMs: 300000` - 5 minutes between cycles

### aggressive.config.json

A fast-moving, high-throughput configuration. Maximizes parallelization and minimizes checks.

**Best for:**
- Side projects
- Rapid prototyping
- Experimental codebases
- Projects where speed matters more than stability

**Key settings:**
- `parallelWorkers: 8` - Maximum concurrency
- `tasksPerCycle: 10` - Discover many tasks
- `requireTests: false` - Skip test verification
- `loopIntervalMs: 30000` - 30 seconds between cycles

### monorepo.config.json

Optimized for monorepo projects with multiple packages/apps.

**Best for:**
- Turborepo/Lerna monorepos
- Multi-package npm workspaces
- Organizations with many related projects

**Key settings:**
- Extended `excludePaths` for multiple node_modules, dist folders
- Excludes legacy/deprecated packages
- Balanced parallelization

### ci-cd.config.json

Designed for single-run CI/CD integration (cron jobs, scheduled workflows).

**Best for:**
- GitHub Actions scheduled workflows
- Nightly improvement runs
- Jenkins/CircleCI pipelines

**Key settings:**
- `loopIntervalMs: 0` - No wait between cycles
- `pauseBetweenCycles: false` - Continuous execution
- Lower parallelization for shared CI resources

## Using These Examples

Copy an example to your project:

```bash
cp examples/monorepo.config.json ./autonomous-dev.config.json
```

Or reference directly:

```bash
autonomous-dev start -c examples/conservative.config.json
```

## Customizing

Feel free to mix and match settings from different examples. The CLI validates all configurations, so you'll get helpful error messages if something is misconfigured.

Common customizations:
- Change `repo.owner` and `repo.name` to your repository
- Adjust `excludePaths` for your project structure
- Set `previewUrlPattern` to your preview deployment URL pattern
- Tune `parallelWorkers` based on your API rate limits and resources
