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

**Standalone Repository:**
```
https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

**Monorepo (this project):**
```
https://github.etdofresh.com/{owner}/{repo}/website/{branch}/
```

**Examples:**

*Standalone:*
```
https://github.etdofresh.com/webedt/website/main/
https://github.etdofresh.com/webedt/website/claude-new-feature-01AdzpK5b5h4BkyDcMWtoLGV/
```

*Monorepo:*
```
https://github.etdofresh.com/webedt/monorepo/website/main/
https://github.etdofresh.com/webedt/monorepo/website/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/
```

**Pattern:**
- Standalone format: `https://github.etdofresh.com/{owner}/{repo}/{branch}/`
- Monorepo format: `https://github.etdofresh.com/{owner}/{repo}/website/{branch}/`
- Owner and repo are lowercased
- Branch name preserves original case (slashes replaced with dashes)
- Example: Branch `claude/test-feature` becomes `claude-test-feature`
- The path prefix is stripped by Dokploy before forwarding requests to your app

### Dokploy Build Configuration

**IMPORTANT**: This project requires a pre-build step to generate version information before Docker builds.

**Required Pre-Build Command:**
```bash
cd website && ./pre-build.sh
```

This command must be configured in Dokploy's "Pre Build Command" field. It generates version files from git history that are then included in the Docker build.

**Why This Is Needed:**
- Version information is calculated from git tags and commit count
- The `.git` directory is not available in Docker build context
- Pre-build script generates `package.json` version and `apps/client/src/version.ts` before Docker build
- These generated files are then copied into the Docker image during the build

**Without the pre-build command, the deployment will fail** because the Docker build will not have access to git history for version generation.

### Monorepo Path-Based Routing Requirements

**CRITICAL:** When working in a monorepo, the deployment path is 4 segments instead of 3:
- Standalone: `/owner/repo/branch/`
- Monorepo: `/owner/repo/website/branch/`

**Three files MUST be updated to support monorepo routing:**

1. **`apps/client/index.html`** - Base tag detection
2. **`apps/client/src/App.tsx`** - React Router basename
3. **`apps/client/src/lib/api.ts`** - API base URL detection

Each file must check for the monorepo pattern by detecting 4 path segments with `'website'` as the 3rd segment:

```javascript
if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
  // Monorepo: /owner/repo/website/branch/
  basePath = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
} else {
  // Standalone: /owner/repo/branch/
  basePath = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
}
```

### Critical Path Requirements for Strip Path

**IMPORTANT**: This project supports both root-based and path-based deployments using runtime base path detection. It also supports both standalone repository and monorepo patterns.

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

The `index.html` includes a script that automatically detects path-based deployments and injects a `<base>` tag. **CRITICAL:** This script MUST handle both standalone and monorepo patterns:

```html
<script>
  (function() {
    const pathname = window.location.pathname;
    const pathSegments = pathname.split('/').filter(Boolean);
    const appRoutes = ['login', 'register', 'session', ...];

    let basePath = '/'; // Default for root-based deployments

    if (pathSegments.length >= 3 && !appRoutes.includes(pathSegments[0])) {
      // Check for monorepo pattern: /owner/repo/website/branch/
      if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
        basePath = '/' + pathSegments[0] + '/' + pathSegments[1] + '/' + pathSegments[2] + '/' + pathSegments[3] + '/';
      } else {
        // Standard path-based deployment: /owner/repo/branch/
        basePath = '/' + pathSegments[0] + '/' + pathSegments[1] + '/' + pathSegments[2] + '/';
      }
    }

    document.write('<base href="' + basePath + '">');
  })();
</script>
```

**How It Works:**

For **monorepo deployments** (`github.etdofresh.com/owner/repo/website/branch/`):
- Script detects 4 path segments with 'website' as the 3rd segment
- Injects `<base href="/owner/repo/website/branch/">`
- Relative path `./assets/app.js` resolves to `/owner/repo/website/branch/assets/app.js` ✓
- Deep links work because base path is fixed

For **standalone path-based deployments** (`github.etdofresh.com/owner/repo/branch/`):
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
- With `<base href="/owner/repo/website/branch/">`: any URL + `./assets/app.js` → `/owner/repo/website/branch/assets/app.js` ✓

**API Calls in JavaScript/TypeScript:**

For SPAs with client-side routing, API calls must use absolute paths with basename detection. **CRITICAL:** This MUST handle both standalone and monorepo patterns:

```typescript
// Detect API base URL from current location
function getApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (envBaseUrl) return envBaseUrl;

  const pathname = window.location.pathname;
  const pathSegments = pathname.split('/').filter(Boolean);

  // Check for path-based deployment (owner/repo/branch or owner/repo/website/branch pattern)
  if (pathSegments.length >= 3 && !['login', 'register', 'chat', 'settings'].includes(pathSegments[0])) {
    // Check for monorepo pattern: /owner/repo/website/branch/
    if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
      return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
    }
    // Standard format: /owner/repo/branch/
    return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
  }

  return ''; // Root-based deployment
}

const API_BASE_URL = getApiBaseUrl();

// API calls use absolute paths: fetch(`${API_BASE_URL}/api/auth/login`)
```

**Why This Approach:**

With monorepo path-based routing at `https://github.etdofresh.com/webedt/monorepo/website/main/`:
- Detected API_BASE_URL: `/webedt/monorepo/website/main`
- API call: `${API_BASE_URL}/api/auth/login` → `/webedt/monorepo/website/main/api/auth/login`
- Traefik matches path prefix `/webedt/monorepo/website/main/`
- Strip Path removes `/webedt/monorepo/website/main/`
- Express receives `/api/auth/login` ✓

With standalone path-based routing at `https://github.etdofresh.com/webedt/website/main/`:
- Detected API_BASE_URL: `/webedt/website/main`
- API call: `${API_BASE_URL}/api/auth/login` → `/webedt/website/main/api/auth/login`
- Traefik matches path prefix `/webedt/website/main/`
- Strip Path removes `/webedt/website/main/`
- Express receives `/api/auth/login` ✓

Simple relative paths (`./api/...`) don't work because they resolve relative to the current page URL, not the basename. If you're on `/webedt/website/main/login`, then `./api/auth/login` becomes `/webedt/website/main/login/api/auth/login` (wrong!).

**Important:** The `<base>` tag affects ALL relative URLs including those in JavaScript, so API calls must use the absolute path approach shown above (not relative paths).

**React Router Configuration:**

For Single Page Applications using React Router, you MUST configure the basename. **CRITICAL:** This MUST handle both standalone and monorepo patterns:

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

  // Check for path-based deployment (owner/repo/branch or owner/repo/website/branch pattern)
  if (pathSegments.length >= 3 && !['login', 'register', 'chat', 'settings'].includes(pathSegments[0])) {
    // Check for monorepo pattern: /owner/repo/website/branch/
    if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
      return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
    }
    // Standard format: /owner/repo/branch/
    return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
  }

  return '/';
};

<BrowserRouter basename={getBasename()}>
  {/* routes */}
</BrowserRouter>
```

**This ensures React Router navigation produces correct URLs:**

Monorepo:
- `navigate('/login')` → `https://github.etdofresh.com/webedt/monorepo/website/branch/login` ✓

Standalone:
- `navigate('/login')` → `https://github.etdofresh.com/webedt/website/branch/login` ✓

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

**For Standalone Repository (webedt/website):**
```
**Links:**

GitHub Branch: [https://github.com/webedt/website/tree/{branch-name}](https://github.com/webedt/website/tree/{branch-name})
Live Site: [https://github.etdofresh.com/webedt/website/{branch}/](https://github.etdofresh.com/webedt/website/{branch}/)
```

**For Monorepo (webedt/monorepo):**
```
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/{branch-name}](https://github.com/webedt/monorepo/tree/{branch-name})
Live Site: [https://github.etdofresh.com/webedt/monorepo/website/{branch}/](https://github.etdofresh.com/webedt/monorepo/website/{branch}/)
```

**How to construct the deployment URL:**

**Standalone:**
```
https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

**Monorepo (note the extra /website/ segment):**
```
https://github.etdofresh.com/{owner}/{repo}/website/{branch}/
```

**Branch Name Processing:**
1. Owner and repo are converted to lowercase
2. Branch name preserves original case
3. Slashes in branch names are replaced with dashes
4. Example: `claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD` → `claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD`

**Construction Steps for Monorepo:**
1. Lowercase the owner: `webedt` → `webedt`
2. Lowercase the repo: `monorepo` → `monorepo`
3. Add the `/website/` segment
4. Replace slashes in branch with dashes (preserve case): `claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD` → `claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD`
5. Construct URL: `https://github.etdofresh.com/webedt/monorepo/website/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/`

**Examples:**

**Monorepo:**
```
Branch: main
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/main](https://github.com/webedt/monorepo/tree/main)
Live Site: [https://github.etdofresh.com/webedt/monorepo/website/main/](https://github.etdofresh.com/webedt/monorepo/website/main/)
```

```
Branch: claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD](https://github.com/webedt/monorepo/tree/claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD)
Live Site: [https://github.etdofresh.com/webedt/monorepo/website/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/](https://github.etdofresh.com/webedt/monorepo/website/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/)
```

**Standalone:**
```
Branch: main
**Links:**

GitHub Branch: [https://github.com/webedt/website/tree/main](https://github.com/webedt/website/tree/main)
Live Site: [https://github.etdofresh.com/webedt/website/main/](https://github.etdofresh.com/webedt/website/main/)
```

**Important Notes:**
- ALWAYS show these links at the end of your response when completing a task
- For monorepo deployments, include the `/website/` segment in the URL
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

Version numbers are **automatically calculated** during Docker builds based on git tags and commit count.

### Build-Time Version Calculation

When a Docker image is built:
1. The Dockerfile runs `node scripts/generate-version.js --update`
2. Version is calculated from git tags and commit count
3. `package.json` and `apps/client/src/version.ts` are generated with the correct version
4. No commits needed - versions are generated, not committed

### Benefits

- ✅ No extra commits on main for version updates
- ✅ Version is always accurate for the exact commit being built
- ✅ Works automatically for all branches and deployments

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
