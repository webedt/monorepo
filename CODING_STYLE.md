# Coding Style Guide

This document defines the coding conventions used throughout this codebase.

## TypeScript Conventions

### Imports

**Value imports** can be grouped on a single line:
```typescript
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { AClaudeWebClient } from './AClaudeWebClient.js';
import { ClaudeRemoteError } from './types.js';
```

**Type imports** use `import type` with one import per line:
```typescript
import type { ClaudeWebClientConfig } from './types.js';
import type { CreateSessionParams } from './types.js';
import type { CreateSessionResult } from './types.js';
import type { Session } from './types.js';
```

**Import order:**
1. Node.js built-ins (`crypto`, `fs`, `path`)
2. External packages (`ws`, `express`)
3. Internal value imports (classes, functions, constants)
4. Internal type imports (one per line)

**File extensions:** Always use `.js` extension for relative imports (TypeScript ESM).

### Abstract Class Pattern

For modules with abstract base classes, documentation interfaces, and implementations:

| File | JSDoc | Purpose |
|------|-------|---------|
| `AClassName.ts` | None | Abstract method signatures only, no documentation |
| `className.doc.ts` | Full | Interface with complete documentation |
| `className.ts` | None | Implementation, no documentation |

### Method Signatures (Abstract Classes)

Parameters on separate lines with two-space indentation, return type on closing line:

```typescript
abstract methodName(
  param1: Type1,
  param2: Type2
): ReturnType;
```

### Spacing

- Single blank line between methods
- Single blank line between import groups
- File ends with single newline
- No trailing whitespace

### Type Definitions

- Use `interface` for object shapes that may be extended
- Use `type` for unions, intersections, and aliases
- Export types from a dedicated `types.ts` file

### Naming Conventions

- **Classes:** PascalCase (`ClaudeWebClient`)
- **Abstract classes:** Prefix with `A` (`AClaudeWebClient`)
- **Interfaces:** Prefix with `I` for documentation interfaces (`IClaudeWebClient`)
- **Types:** PascalCase (`SessionResult`, `EventCallback`)
- **Functions/methods:** camelCase (`createSession`, `pollSession`)
- **Constants:** SCREAMING_SNAKE_CASE (`DEFAULT_BASE_URL`)
- **Private methods:** camelCase with no prefix (`buildHeaders`, `extractBranchName`)

### Error Handling

- Create custom error classes extending `Error`
- Include relevant context (status codes, response text)

```typescript
export class ClaudeRemoteError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseText?: string
  ) {
    super(message);
    this.name = 'ClaudeRemoteError';
  }
}
```

## Reference Examples

See `shared/src/claudeWeb/` for canonical examples:
- [AClaudeWebClient.ts](shared/src/claudeWeb/AClaudeWebClient.ts) - Abstract class pattern
- [claudeWebClient.doc.ts](shared/src/claudeWeb/claudeWebClient.doc.ts) - Documentation interface
- [claudeWebClient.ts](shared/src/claudeWeb/claudeWebClient.ts) - Implementation
- [types.ts](shared/src/claudeWeb/types.ts) - Type definitions
