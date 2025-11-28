# Website Project Documentation

This document provides information for AI assistants working on this project.

## Repository and Deployment Links

### GitHub Repository

This repository is available at:
```
https://github.com/webedt/website
```

### Deployment URLs

This project uses Dokploy for deployments with path-based routing. Each deployment gets a unique URL path following this pattern:

```
https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

**Examples:**

```
https://github.etdofresh.com/webedt/monorepo/main/
https://github.etdofresh.com/webedt/monorepo/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/
```

**Pattern:**
- Owner and repo are lowercased
- Branch name preserves original case (slashes replaced with dashes)
- Example: Branch `claude/test-feature` becomes `claude-test-feature`
- The path prefix is stripped by Dokploy before forwarding requests to your app

### Dokploy Build Configuration

Version information is automatically passed to Docker builds via build args from GitHub Actions. No pre-build step is required.

**How It Works:**
1. GitHub Actions workflow calculates version from git tags and commits
2. Version info (BUILD_VERSION, BUILD_TIMESTAMP, BUILD_SHA) is passed to Dokploy via the API
3. Dokploy passes these as Docker build args during the build
4. Dockerfile generates `apps/client/src/version.ts` from these build args

**Benefits:**
- No `.git` directory needed in Docker build context
- No pre-build command required in Dokploy
- Version is always accurate for the exact commit being deployed
- Works automatically for all branches

### Path-Based Routing Requirements

**CRITICAL:** This project uses path-based routing with the pattern `/owner/repo/branch/`

**Three files MUST be updated to support path-based routing:**

1. **`apps/client/index.html`** - Base tag detection
2. **`apps/client/src/App.tsx`** - React Router basename
3. **`apps/client/src/lib/api.ts`** - API base URL detection

Each file must detect the path-based pattern by checking for 3 path segments:

```javascript
if (pathSegments.length >= 3 && !appRoutes.includes(pathSegments[0])) {
  // Path-based: /owner/repo/branch/
  basePath = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
} else {
  // Root-based: /
  basePath = '/';
}
```

### Critical Path Requirements for Strip Path

**IMPORTANT**: This project supports both root-based and path-based deployments using runtime base path detection.

**Vite Configuration:**

Use relative paths to work with runtime base path detection:
```typescript
// vite.config.ts
export default defineConfig({
  base: './', // Relative paths work with <base> tag
  // ... other config
});
```

**Runtime Base Path Detection:**

The `index.html` includes a script that automatically detects path-based deployments and injects a `<base>` tag:

```html
<script>
  (function() {
    const pathname = window.location.pathname;
    const pathSegments = pathname.split('/').filter(Boolean);
    const appRoutes = ['login', 'register', 'session', ...];

    let basePath = '/'; // Default for root-based deployments

    if (pathSegments.length >= 3 && !appRoutes.includes(pathSegments[0])) {
      // Path-based deployment: /owner/repo/branch/
      basePath = '/' + pathSegments[0] + '/' + pathSegments[1] + '/' + pathSegments[2] + '/';
    }

    document.write('<base href="' + basePath + '">');
  })();
</script>
```

**How It Works:**

For **path-based deployments** (`github.etdofresh.com/owner/repo/branch/`):
- Script detects 3+ path segments not matching app routes
- Injects `<base href="/owner/repo/branch/">`
- Relative path `./assets/app.js` resolves to `/owner/repo/branch/assets/app.js` ✓
- Deep links work because base path is fixed

For **root-based deployments** (`webedt.etdofresh.com`):
- Script detects root deployment (no owner/repo/branch pattern)
- Injects `<base href="/">`
- Relative path `./assets/app.js` resolves to `/assets/app.js` ✓
- Deep links work because base path is fixed to root

**Why This Approach:**

The `<base>` tag tells the browser where to resolve all relative URLs from, regardless of the current page URL. This solves the deep link problem:
- Without `<base>`: `/quick-setup/code` + `./assets/app.js` → `/quick-setup/code/assets/app.js` ❌
- With `<base href="/">`: `/quick-setup/code` + `./assets/app.js` → `/assets/app.js` ✓
- With `<base href="/owner/repo/branch/">`: any URL + `./assets/app.js` → `/owner/repo/branch/assets/app.js` ✓

**API Calls in JavaScript/TypeScript:**

For SPAs with client-side routing, API calls must use absolute paths with basename detection:

```typescript
// Detect API base URL from current location
function getApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (envBaseUrl) return envBaseUrl;

  const pathname = window.location.pathname;
  const pathSegments = pathname.split('/').filter(Boolean);

  // Check for path-based deployment (owner/repo/branch pattern)
  if (pathSegments.length >= 3 && !['login', 'register', 'chat', 'settings'].includes(pathSegments[0])) {
    // Path-based format: /owner/repo/branch/
    return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
  }

  return ''; // Root-based deployment
}

const API_BASE_URL = getApiBaseUrl();

// API calls use absolute paths: fetch(`${API_BASE_URL}/api/auth/login`)
```

**Why This Approach:**

With path-based routing at `https://github.etdofresh.com/webedt/monorepo/main/`:
- Detected API_BASE_URL: `/webedt/monorepo/main`
- API call: `${API_BASE_URL}/api/auth/login` → `/webedt/monorepo/main/api/auth/login`
- Traefik matches path prefix `/webedt/monorepo/main/`
- Strip Path removes `/webedt/monorepo/main/`
- Express receives `/api/auth/login` ✓

Simple relative paths (`./api/...`) don't work because they resolve relative to the current page URL, not the basename. If you're on `/webedt/monorepo/main/login`, then `./api/auth/login` becomes `/webedt/monorepo/main/login/api/auth/login` (wrong!).

**Important:** The `<base>` tag affects ALL relative URLs including those in JavaScript, so API calls must use the absolute path approach shown above (not relative paths).

**React Router Configuration:**

For Single Page Applications using React Router, you MUST configure the basename:

```typescript
// In App.tsx or routing setup
const getBasename = () => {
  const viteBase = import.meta.env.BASE_URL;
  if (viteBase && viteBase !== './' && viteBase !== '/') {
    return viteBase;
  }

  // Detect from URL for path-based routing
  const pathname = window.location.pathname;
  const pathSegments = pathname.split('/').filter(Boolean);

  // Check for path-based deployment (owner/repo/branch pattern)
  if (pathSegments.length >= 3 && !['login', 'register', 'chat', 'settings'].includes(pathSegments[0])) {
    // Path-based format: /owner/repo/branch/
    return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
  }

  return '/';
};

<BrowserRouter basename={getBasename()}>
  {/* routes */}
</BrowserRouter>
```

**This ensures React Router navigation produces correct URLs:**

Path-based deployment:
- `navigate('/login')` → `https://github.etdofresh.com/webedt/monorepo/branch/login` ✓

Without basename, navigation would produce incorrect URLs like `https://github.etdofresh.com/login` ❌

### Viewing Deployment Logs

If deployed via Dokploy, build and deployment logs can be accessed at:

```
https://logs.etdofresh.com/
```

To view logs for a specific deployment:
```
https://logs.etdofresh.com/{sessionId}-{suffix}/
```

To view a specific deployment log file:
```
https://logs.etdofresh.com/{sessionId}-{suffix}/{logfile}.log
```

#### Programmatic Access to Logs

You can combine the Dokploy API with the log viewer to get exact log URLs:

```javascript
async function getDeploymentLogs(sessionId) {
  // 1. Get application details from Dokploy API
  const appResponse = await fetch(
    `https://dokploy.etdofresh.com/api/application.one?applicationId=${sessionId}`,
    {
      headers: {
        'accept': 'application/json',
        'x-api-key': process.env.DOKPLOY_API_KEY
      }
    }
  );

  const appData = await appResponse.json();

  // 2. Get the latest deployment log path
  const deployment = appData.deployments[0];
  const logPath = deployment.logPath;
  // Example: "/etc/dokploy/logs/abc-123/abc-123-2025-11-03:21:39:32.log"

  // 3. Convert to logs.etdofresh.com URL
  const logUrl = logPath.replace('/etc/dokploy/logs/', 'https://logs.etdofresh.com/');

  // 4. Fetch or display
  console.log('View logs at:', logUrl);

  // Optional: Fetch the log content
  const logResponse = await fetch(logUrl);
  const logContent = await logResponse.text();

  return { logUrl, logContent };
}
```

### Displaying Links to Users

**CRITICAL REQUIREMENT:** After completing ANY task that involves code changes, commits, or pushes, you MUST ALWAYS display clickable links to:

1. The GitHub repository (linked to the specific branch)
2. The deployment site (using path-based routing)

**Required Format:**

```
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/{branch-name}](https://github.com/webedt/monorepo/tree/{branch-name})
Live Site: [https://github.etdofresh.com/webedt/monorepo/{branch}/](https://github.etdofresh.com/webedt/monorepo/{branch}/)
```

**How to construct the deployment URL:**

```
https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

**Branch Name Processing:**
1. Owner and repo are converted to lowercase
2. Branch name preserves original case
3. Slashes in branch names are replaced with dashes
4. Example: `claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD` → `claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD`

**Construction Steps:**
1. Lowercase the owner: `webedt` → `webedt`
2. Lowercase the repo: `monorepo` → `monorepo`
3. Replace slashes in branch with dashes (preserve case): `claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD` → `claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD`
4. Construct URL: `https://github.etdofresh.com/webedt/monorepo/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/`

**Examples:**

```
Branch: main
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/main](https://github.com/webedt/monorepo/tree/main)
Live Site: [https://github.etdofresh.com/webedt/monorepo/main/](https://github.etdofresh.com/webedt/monorepo/main/)
```

```
Branch: claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD](https://github.com/webedt/monorepo/tree/claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD)
Live Site: [https://github.etdofresh.com/webedt/monorepo/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/](https://github.etdofresh.com/webedt/monorepo/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/)
```

**Important Notes:**
- ALWAYS show these links at the end of your response when completing a task
- The path prefix is stripped by Dokploy before forwarding to your app
- Branch names preserve original case in URLs
- Do NOT skip this step - users rely on these links for quick access
- If logs are relevant, also include: `Deployment Logs: [https://logs.etdofresh.com/{app-name}/](https://logs.etdofresh.com/{app-name}/)`

## Git Commit Messages

**MANDATORY REQUIREMENT:** All git commit messages MUST follow the format specified in `GIT_COMMIT_MESSAGE_INSTRUCTIONS.md`.

### Key Rules

- Use imperative mood, present active tense
- Start with a capital letter and a verb (Add, Update, Remove, Fix, etc)
- **NO prefixes** like `feat:`, `fix:`, `chore:`, etc
- **NO emojis**
- Optional detail lines with `-` bullets for larger changes

### Format

```
Subject Line [Required]

- Detail Line 1 [Optional]
- Detail Line 2 [Optional]
```

**Note:** A blank line MUST separate the subject from detail lines.

### Examples

✅ **Good:**
```
Add commit-based versioning system
Update API endpoint to support dynamic paths
Fix navigation overlay height issue
```

❌ **Bad:**
```
feat: add versioning system
✨ Update API endpoint
fixed navigation bug
```

See `GIT_COMMIT_MESSAGE_INSTRUCTIONS.md` for complete rules and examples.

## Version Management

Version numbers are **automatically calculated** by GitHub Actions and passed to Docker builds via build args.

### Build-Time Version Calculation

When deploying via GitHub Actions:
1. GitHub Actions calculates version from git tags and commit count
2. Version info is passed to Dokploy API as build args (BUILD_VERSION, BUILD_TIMESTAMP, BUILD_SHA)
3. Dockerfile generates `apps/client/src/version.ts` from these build args
4. No `.git` directory needed in Docker build context

### Version Format

- `MAJOR.MINOR.PATCH` where PATCH = commits since tag
- Example: Tag `v1.2.0` + 5 commits = `1.2.5`
- No tags: `0.0.{total_commits}`

### Benefits

- ✅ No extra commits on main for version updates
- ✅ Version is always accurate for the exact commit being built
- ✅ Works automatically for all branches and deployments
- ✅ No `.git` directory dependency in Docker builds

### Development Commands (Optional)

During development, you can preview the version:
```bash
pnpm version:show  # View current version
pnpm version:info  # View detailed version info
pnpm version:generate  # Update local version files (optional, not committed)
```

Version files don't need to be committed since Docker builds regenerate them automatically.

See `VERSIONING.md` for complete documentation on the versioning system.

## Project Overview

(Add project-specific information here as needed)

---

*Documentation last updated: 2025-11-21*
