# Preview URL Flow Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Preview URL System                           │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   Your Application   │
│                      │
│  getPreviewUrl(...)  │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Preview URL Helper                         │
├──────────────────────────────────────────────────────────────┤
│  1. Check for .webedt file in repository root                │
│     ├─ File exists?                                          │
│     │  ├─ Yes: Read file                                     │
│     │  │  ├─ Valid JSON?                                     │
│     │  │  │  ├─ Yes: Has preview_url field?                 │
│     │  │  │  │  ├─ Yes: ✅ Return custom URL               │
│     │  │  │  │  └─ No:  ⤵ Use default                      │
│     │  │  │  └─ No:  ⤵ Use default                         │
│     │  │  └─ [Log warning if invalid]                       │
│     │  └─ No: ⤵ Use default                                 │
│     │                                                         │
│  2. Default URL                                              │
│     └─ ✅ Return https://github.etdofresh.com/owner/repo/... │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐
│   Preview URL        │
│   (string)           │
└──────────────────────┘
```

## Decision Flow

```
START
  │
  ▼
Check for .webedt file
  │
  ├─────────────────────────────┐
  │                             │
  ▼                             ▼
File exists?                File missing
  │                             │
  ├─── Yes                      └──→ [Use Default URL]
  │                                        │
  ▼                                        │
Read file content                          │
  │                                        │
  ├─── Success                             │
  │      │                                 │
  │      ▼                                 │
  │   Parse JSON                           │
  │      │                                 │
  │      ├─── Valid ──→ Has preview_url?   │
  │      │                  │              │
  │      │                  ├─ Yes ──→ [Return Custom URL]
  │      │                  │              │
  │      │                  └─ No ────→────┤
  │      │                                 │
  │      └─── Invalid ───→─────────────────┤
  │                                        │
  └─── Error ─────→───────────────────────→│
                                           │
                                           ▼
                                    [Use Default URL]
                                           │
                                           ▼
                          Return: https://github.etdofresh.com/
                                  {owner}/{repo}/{branch}/
                                           │
                                           ▼
                                         END
```

## Data Flow Example

### Scenario 1: No .webedt File (Most Common)

```
Input:
  workspacePath: "/workspace/react"
  owner: "facebook"
  repo: "react"
  branch: "main"

Flow:
  1. Check /workspace/react/.webedt
  2. File not found
  3. Generate default URL

Output:
  "https://github.etdofresh.com/facebook/react/main/"
```

### Scenario 2: With .webedt File

```
Input:
  workspacePath: "/workspace/myapp"
  owner: "mycompany"
  repo: "myapp"
  branch: "develop"

.webedt content:
  {
    "preview_url": "https://staging.myapp.com/"
  }

Flow:
  1. Check /workspace/myapp/.webedt
  2. File found
  3. Read and parse JSON
  4. Extract preview_url field

Output:
  "https://staging.myapp.com/"
```

### Scenario 3: Invalid .webedt File

```
Input:
  workspacePath: "/workspace/broken"
  owner: "test"
  repo: "broken"
  branch: "main"

.webedt content:
  invalid json {

Flow:
  1. Check /workspace/broken/.webedt
  2. File found
  3. Try to parse JSON
  4. Parse fails
  5. Log warning
  6. Generate default URL

Output:
  "https://github.etdofresh.com/test/broken/main/"
```

## Integration Flow

```
┌──────────────┐
│   User       │
│  (Frontend)  │
└──────┬───────┘
       │
       │ 1. Request session details
       │
       ▼
┌─────────────────────┐
│  Website Server     │
│  (API Handler)      │
└──────┬──────────────┘
       │
       │ 2. Fetch session from DB
       │
       ▼
┌─────────────────────┐
│  Database           │
└──────┬──────────────┘
       │
       │ 3. Session data
       │    { owner, repo, branch }
       │
       ▼
┌─────────────────────────┐
│  getPreviewUrl()        │
│  or                     │
│  getPreviewUrlFromSession() │
└──────┬──────────────────┘
       │
       │ 4. Check workspace/.webedt
       │
       ├─────────┬─────────┐
       │         │         │
       ▼         ▼         ▼
   Found    Not Found   Error
   Custom   Default     Default
     URL      URL        URL
       │         │         │
       └─────────┴─────────┘
       │
       │ 5. Preview URL
       │
       ▼
┌─────────────────────┐
│  API Response       │
│  {                  │
│    ...session,      │
│    previewUrl       │
│  }                  │
└──────┬──────────────┘
       │
       │ 6. Return to frontend
       │
       ▼
┌──────────────┐
│   User       │
│  (Frontend)  │
│              │
│  [Preview →] │ ← Click to open preview URL
└──────────────┘
```

## SSE Event Flow

```
┌──────────────┐
│  AI Worker   │
│              │
│  Branch      │
│  Created     │
└──────┬───────┘
       │
       │ 1. Call getPreviewUrl()
       │
       ▼
┌────────────────────┐
│  Preview Helper    │
│                    │
│  Check .webedt     │
│  Return URL        │
└──────┬─────────────┘
       │
       │ 2. Preview URL
       │
       ▼
┌────────────────────┐
│  Send SSE Event    │
│                    │
│  {                 │
│    type: "branch", │
│    previewUrl: ... │
│  }                 │
└──────┬─────────────┘
       │
       │ 3. Stream to client
       │
       ▼
┌────────────────────┐
│  Website Server    │
│  (Proxy/Forward)   │
└──────┬─────────────┘
       │
       │ 4. Forward SSE
       │
       ▼
┌────────────────────┐
│  Frontend          │
│                    │
│  EventSource       │
│  onMessage()       │
└──────┬─────────────┘
       │
       │ 5. Display preview button
       │
       ▼
┌────────────────────┐
│  User Interface    │
│                    │
│  [Preview →]       │
└────────────────────┘
```

## File System Layout

```
Repository Root
│
├── .git/                     ← Git directory
├── .webedt                   ← Optional config file
│   └── Content:
│       {
│         "preview_url": "https://custom.com/"
│       }
│
├── src/
├── package.json
└── README.md

Monorepo Structure
│
├── ai-coding-worker/
│   └── src/
│       └── utils/
│           └── previewUrlHelper.ts  ← AI worker helper
│
└── website/
    └── apps/
        └── server/
            └── src/
                └── utils/
                    └── previewUrlHelper.ts  ← Server helper
```

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│              Presentation Layer                  │
│  (Frontend - React/Vue/etc)                     │
│  - Display preview button                       │
│  - Handle click to open URL                     │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│              API Layer                           │
│  (Website Server)                               │
│  - Session endpoints                            │
│  - Add previewUrl to responses                  │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│              Business Logic Layer                │
│  (Preview URL Helper)                           │
│  - Check .webedt file                           │
│  - Generate default URL                         │
│  - Return preview URL                           │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│              Data Layer                          │
│  (File System / Database)                       │
│  - .webedt file on disk                         │
│  - Session metadata in DB                       │
└─────────────────────────────────────────────────┘
```

## State Machine

```
┌─────────┐
│  INIT   │
└────┬────┘
     │
     ▼
┌──────────────┐
│ CHECK_FILE   │ ──── File missing ────┐
└────┬─────────┘                       │
     │                                 │
     │ File exists                     │
     │                                 │
     ▼                                 │
┌──────────────┐                       │
│  READ_FILE   │ ──── Read error ──────┤
└────┬─────────┘                       │
     │                                 │
     │ Read success                    │
     │                                 │
     ▼                                 │
┌──────────────┐                       │
│ PARSE_JSON   │ ──── Parse error ─────┤
└────┬─────────┘                       │
     │                                 │
     │ Parse success                   │
     │                                 │
     ▼                                 │
┌──────────────┐                       │
│ CHECK_FIELD  │ ──── No field ────────┤
└────┬─────────┘                       │
     │                                 │
     │ Has preview_url                 │
     │                                 │
     ▼                                 ▼
┌──────────────┐             ┌──────────────┐
│ RETURN_      │             │ RETURN_      │
│ CUSTOM_URL   │             │ DEFAULT_URL  │
└──────────────┘             └──────────────┘
```

## Summary

The preview URL system is designed to be:

- ✅ **Simple**: One function call
- ✅ **Resilient**: Always returns a valid URL
- ✅ **Flexible**: Supports custom configurations
- ✅ **Efficient**: Minimal file I/O
- ✅ **Safe**: Graceful error handling

No matter what happens, you always get a preview URL!
