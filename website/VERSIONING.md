# Version Management

This project uses **commit-based versioning** with git tags.

## How It Works

Version format: `MAJOR.MINOR.PATCH`

- **MAJOR.MINOR** - Set by creating git tags (e.g., `v1.2.0`, `v2.0.0`)
- **PATCH** - Auto-calculated from commits since the last tag

### Example

```bash
# Start with no tags
# 273 commits exist
# Version: 0.0.273

# Tag first minor version
git tag v1.0.0
git push origin v1.0.0
# Version: 1.0.0 (0 commits since tag)

# Make 5 commits
# Version: 1.0.5 (5 commits since v1.0.0)

# Tag next minor version
git tag v1.1.0
git push origin v1.1.0
# Version: 1.1.0 (0 commits since tag)

# Make 3 commits
# Version: 1.1.3 (3 commits since v1.1.0)
```

## Tagging Versions

### When to Tag

Only tag **major** and **minor** version bumps:
- ✅ Tag: `v1.0.0`, `v1.1.0`, `v1.2.0`, `v2.0.0`
- ❌ Don't tag patches: `v1.0.1`, `v1.0.2`, etc.

Patches are automatically calculated from commit count.

### How to Tag

```bash
# Tag a minor version bump
git tag v1.1.0
git push origin v1.1.0

# Tag a major version bump
git tag v2.0.0
git push origin v2.0.0
```

### Tag Format

Tags **must** follow the format: `vMAJOR.MINOR.0`

Examples:
- ✅ `v1.0.0`, `v1.1.0`, `v2.0.0`
- ❌ `v1.0`, `1.0.0`, `release-1.0.0`

## Version Commands

```bash
# Show current version
pnpm version:show

# Show detailed version info (JSON)
pnpm version:info

# Update package.json and version.ts
pnpm version:generate
```

## Maintenance Branches

This system works great for maintaining multiple versions:

```bash
# Create maintenance branch from v1.2.0
git checkout -b support/1.2.x v1.2.0

# Make 3 bug fixes
git commit -m "fix: bug 1"
git commit -m "fix: bug 2"
git commit -m "fix: bug 3"

# Version is now 1.2.3 (on this branch)

# Meanwhile on main...
git checkout main
# Main might be at v1.3.7 or v2.0.5
```

Each branch independently counts commits from its most recent ancestor tag.

## Automated Version Management

**Version numbers are automatically calculated during Docker builds.**

### How It Works

When a Docker image is built:

1. The Dockerfile includes the `.git` directory and version generation script
2. During the build stage, `node scripts/generate-version.js --update` runs
3. Version is calculated from git tags and commit count
4. `package.json` and `apps/client/src/version.ts` are generated with the correct version
5. The built application includes the accurate version

### Benefits

- ✅ No manual version management required
- ✅ No extra commits on main for version updates
- ✅ Version is always accurate for the exact commit being built
- ✅ Works automatically for all branches and deployments
- ✅ Same version calculation works in development and production

### During Development

You don't need to run `pnpm version:generate` during development unless you want to preview the current version. Just commit your changes normally:

```bash
# Work on your feature
git add src/my-feature.ts
git commit -m "Add new feature"

# Create PR to main
gh pr create --base main

# After merge, the next Docker build will calculate the version automatically
```

### Local Development

To see what version will be generated, run:

```bash
pnpm version:show  # Shows the version
pnpm version:info  # Shows detailed version info
```

You can optionally run `pnpm version:generate` to update local files, but these changes don't need to be committed since the Docker build will regenerate them.

## Build Integration

The version is calculated automatically during Docker builds:

1. **Dockerfile**: The `build` stage runs `node scripts/generate-version.js --update`
2. **Git history**: Version is calculated from tags and commit count
3. **Build artifacts**: Generated files include the correct version
4. **No commits needed**: Version files are generated, not committed

### Docker Build Process

The Dockerfile handles version generation automatically:

```dockerfile
# Copy .git directory for version generation
COPY .git ./.git

# Fetch full git history for accurate version calculation
RUN git remote add origin https://github.com/webedt/website.git 2>/dev/null || true && \
    git fetch --unshallow --tags 2>/dev/null || git fetch --tags 2>/dev/null || true

# Build stage
FROM base AS build

WORKDIR /app

# Generate version info from git before building
RUN node scripts/generate-version.js --update

# Build client and server
RUN pnpm --filter @webedt/client build
RUN pnpm --filter @webedt/server build
```

**Key Points:**
- Copies the `.git` directory into the Docker image
- Fetches full git history and tags (handles shallow clones from CI/CD)
- Calculates version based on complete commit history
- Ensures every build has the correct version for that exact commit

## Version Display

The version is available in:
- `package.json` - NPM package version
- `apps/client/src/version.ts` - Exported constant for UI display
- UI footer - Shows as "v1.2.5"

## FAQ

### Why not tag patch versions?

Patches are just incremental commits. Auto-calculating from commit count:
- Removes manual work
- Always increments (no conflicts)
- Shows actual development activity
- Works automatically across branches

### What if I want to skip a version?

Just tag the version you want:
```bash
# Currently at 1.2.5
git tag v1.3.0  # Next version will be 1.3.1, 1.3.2, etc.
git tag v2.0.0  # Jump to 2.0 series
```

### How do I see what version I'm on?

```bash
pnpm version:show
# or
pnpm version:info  # more details
```

### What if there are no tags?

Defaults to `0.0.X` where X is total commit count.

### Can I use this with semantic versioning?

Yes! This follows semantic versioning:
- Tag `v2.0.0` for breaking changes (MAJOR)
- Tag `v1.1.0` for new features (MINOR)
- Commits auto-increment patches (PATCH)

## Examples

### Scenario 1: Normal Development

```bash
git tag v1.0.0
# v1.0.0

git commit -m "fix: bug"
# v1.0.1

git commit -m "fix: another bug"
# v1.0.2

git commit -m "feat: new feature"
git tag v1.1.0
# v1.1.0

git commit -m "docs: update readme"
# v1.1.1
```

### Scenario 2: Maintenance Branch

```bash
# Main branch
git tag v2.0.0
# v2.0.0

# Create support branch for v1.x
git checkout -b support/1.x v1.5.0
# v1.5.0

git commit -m "fix: security patch"
# v1.5.1 (on support/1.x)

# Back to main
git checkout main
git commit -m "feat: new feature"
# v2.0.1 (on main)
```

## Implementation

Version calculation is handled by `scripts/generate-version.js`:
- Uses `git describe --tags` to find the latest tag
- Counts commits since that tag
- Updates `package.json` and `apps/client/src/version.ts`

The script is safe to run anytime and can be committed to keep versions in sync.
