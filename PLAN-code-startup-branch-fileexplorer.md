# Implementation Plan: Code Startup with Branch Creation & File Explorer

## ✅ IMPLEMENTATION COMPLETE

## Overview
When a user starts up Code (navigates to `/code`), the system should:
1. Create a new branch: `webedt/started-from-code-session-{random-id}`
2. Display all files from the repository in the File Explorer

## Current State Analysis

### File Explorer (Code.tsx)
- **Location**: `website/apps/client/src/pages/Code.tsx`
- **Current Behavior**: Shows a hardcoded mock file tree (Button.jsx, Card.jsx, etc.)
- **Limitation**: No actual file fetching from GitHub or storage worker

### Branch Creation
- **Location**: `ai-coding-worker/src/orchestrator.ts` (lines 370-450)
- **Current Pattern**: `webedt/{descriptive-name}-{session-id-suffix}`
- **Triggered By**: When user submits first request in a session

### Missing APIs
- No API endpoint exists to fetch file tree from GitHub repository
- No API endpoint exists to create a branch without starting a full AI session

---

## Implementation Plan

### Phase 1: Backend - Add GitHub File Tree API

**File**: `website/apps/server/src/routes/github.ts`

Add a new endpoint to fetch repository file tree:

```typescript
// GET /api/github/repos/:owner/:repo/tree/:branch
router.get('/repos/:owner/:repo/tree/:branch', requireAuth, async (req, res) => {
  const { owner, repo, branch } = req.params;
  const { recursive } = req.query; // Optional: recursive=true for full tree

  const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

  // Get the tree SHA from the branch
  const { data: branchData } = await octokit.repos.getBranch({ owner, repo, branch });
  const treeSha = branchData.commit.commit.tree.sha;

  // Get the tree (recursive or not)
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: recursive === 'true' ? 'true' : undefined,
  });

  res.json({ success: true, data: tree });
});
```

### Phase 2: Backend - Add Branch Creation API

**File**: `website/apps/server/src/routes/github.ts`

Add an endpoint to create a branch without starting an AI session:

```typescript
// POST /api/github/repos/:owner/:repo/branches
router.post('/repos/:owner/:repo/branches', requireAuth, async (req, res) => {
  const { owner, repo } = req.params;
  const { branchName, baseBranch } = req.body;

  const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

  // Get the SHA of the base branch
  const { data: baseBranchData } = await octokit.repos.getBranch({
    owner,
    repo,
    branch: baseBranch || 'main',
  });

  // Create the new branch
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseBranchData.commit.sha,
  });

  res.json({ success: true, data: { branchName, baseBranch } });
});
```

### Phase 3: Frontend - Add API Client Methods

**File**: `website/apps/client/src/lib/api.ts`

Add new methods to `githubApi`:

```typescript
export const githubApi = {
  // ... existing methods ...

  // Get repository file tree
  getTree: (owner: string, repo: string, branch: string, recursive = true) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/tree/${branch}?recursive=${recursive}`),

  // Create a new branch
  createBranch: (owner: string, repo: string, data: { branchName: string; baseBranch: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/branches`, {
      method: 'POST',
      body: data,
    }),
};
```

### Phase 4: Frontend - Add Repository Selection to Code Page

**File**: `website/apps/client/src/pages/Code.tsx`

Add state for repository selection and initialization flow:

```typescript
// New states
const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string; branch: string } | null>(null);
const [isInitializing, setIsInitializing] = useState(false);
const [codeSessionBranch, setCodeSessionBranch] = useState<string | null>(null);

// Fetch user's repos
const { data: reposData } = useQuery({
  queryKey: ['github-repos'],
  queryFn: githubApi.getRepos,
});

// Initialize Code session when repo is selected
const initializeCodeSession = async (owner: string, repo: string, baseBranch: string) => {
  setIsInitializing(true);

  // Generate random ID for branch
  const randomId = Math.random().toString(36).substring(2, 10);
  const branchName = `webedt/started-from-code-session-${randomId}`;

  try {
    // Create the branch
    await githubApi.createBranch(owner, repo, { branchName, baseBranch });
    setCodeSessionBranch(branchName);
    setSelectedRepo({ owner, repo, branch: branchName });
  } catch (error) {
    console.error('Failed to create branch:', error);
  } finally {
    setIsInitializing(false);
  }
};
```

### Phase 5: Frontend - Fetch and Display Real File Tree

**File**: `website/apps/client/src/pages/Code.tsx`

Replace hardcoded file tree with real data:

```typescript
// Fetch file tree when branch is ready
const { data: fileTreeData, isLoading: isLoadingTree } = useQuery({
  queryKey: ['github-tree', selectedRepo?.owner, selectedRepo?.repo, selectedRepo?.branch],
  queryFn: () => githubApi.getTree(selectedRepo!.owner, selectedRepo!.repo, selectedRepo!.branch),
  enabled: !!selectedRepo,
});

// Transform GitHub tree to our TreeNode format
const transformGitHubTree = (tree: any[]): FolderNode => {
  const root: FolderNode = { name: 'root', type: 'folder', children: [] };

  for (const item of tree) {
    const pathParts = item.path.split('/');
    let currentLevel = root;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isFile = i === pathParts.length - 1 && item.type === 'blob';

      if (isFile) {
        const icon = getFileIcon(part); // Helper to get icon based on extension
        currentLevel.children.push({ name: part, type: 'file', icon });
      } else {
        let folder = currentLevel.children.find(
          c => c.type === 'folder' && c.name === part
        ) as FolderNode | undefined;

        if (!folder) {
          folder = { name: part, type: 'folder', children: [] };
          currentLevel.children.push(folder);
        }
        currentLevel = folder;
      }
    }
  }

  return root;
};

// Helper for file icons
const getFileIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    js: '🟨', jsx: '🔵', ts: '🔷', tsx: '🔷',
    css: '🎨', scss: '🎨', html: '🌐',
    json: '📦', md: '📄', py: '🐍',
    // ... more icons
  };
  return iconMap[ext || ''] || '📄';
};
```

### Phase 6: Frontend - Add Repository Selection UI

**File**: `website/apps/client/src/pages/Code.tsx`

Add a repository picker when no session is selected:

```typescript
const RepoSelector = () => (
  <div className="max-w-2xl mx-auto px-4 py-8">
    <h1 className="text-2xl font-bold mb-4">Start Code Session</h1>
    <p className="text-base-content/70 mb-6">
      Select a repository to start a new code editing session. A new branch will be created for your changes.
    </p>

    {reposData?.data?.map((repo: any) => (
      <div
        key={repo.id}
        onClick={() => initializeCodeSession(repo.fullName.split('/')[0], repo.name, repo.defaultBranch)}
        className="p-4 border rounded-lg hover:bg-base-200 cursor-pointer mb-2"
      >
        <div className="font-medium">{repo.fullName}</div>
        <div className="text-sm text-base-content/70">{repo.description}</div>
      </div>
    ))}
  </div>
);
```

### Phase 7: File Content Fetching

**Backend** (`website/apps/server/src/routes/github.ts`):

```typescript
// GET /api/github/repos/:owner/:repo/contents/*
router.get('/repos/:owner/:repo/contents/*', requireAuth, async (req, res) => {
  const { owner, repo } = req.params;
  const path = req.params[0]; // The file path
  const { ref } = req.query; // branch/commit ref

  const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: ref as string,
  });

  res.json({ success: true, data });
});
```

**Frontend** (`website/apps/client/src/lib/api.ts`):

```typescript
getFileContent: (owner: string, repo: string, path: string, ref: string) =>
  fetchApi(`/api/github/repos/${owner}/${repo}/contents/${path}?ref=${ref}`),
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `website/apps/server/src/routes/github.ts` | Add 3 new endpoints: tree, create branch, file contents |
| `website/apps/client/src/lib/api.ts` | Add 3 new API methods: getTree, createBranch, getFileContent |
| `website/apps/client/src/pages/Code.tsx` | Complete rewrite with: repo selector, real file tree, file content viewer |

---

## User Flow

1. User navigates to `/code`
2. If no repository is selected, show repository picker
3. User clicks on a repository
4. System creates branch: `webedt/started-from-code-session-{random-id}`
5. System fetches file tree from the new branch
6. File Explorer populates with real files
7. User can click files to view their contents
8. (Future: User can edit files and commit changes)

---

## Testing Checklist

- [ ] Branch creation works with proper naming convention
- [ ] File tree loads correctly for various repository sizes
- [ ] File tree handles nested directories properly
- [ ] File icons display correctly based on file extension
- [ ] File content loads when clicking on a file
- [ ] Error handling for API failures
- [ ] Loading states display properly
- [ ] Works with both public and private repositories

---

## Optional Enhancements (Future)

1. **File Editing**: Add Monaco Editor for actual code editing
2. **Save/Commit**: Allow users to save changes back to the branch
3. **Branch Management**: Switch between branches
4. **Diff View**: Show changes compared to base branch
5. **Persist Selection**: Remember last selected repository
6. **Search Files**: Add file search functionality
