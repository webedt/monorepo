# Multi-Provider Support: Adding OpenAI Codex SDK

## Overview

This plan outlines the implementation of OpenAI Codex SDK support alongside the existing Claude Agent SDK, creating a unified multi-provider architecture across the website and ai-coding-worker packages.

## Current Architecture

The codebase already has a solid provider abstraction pattern:

```
ProviderFactory → BaseProvider (abstract)
                    ├── ClaudeCodeProvider (implemented)
                    └── CodexProvider (placeholder)
```

**Key files:**
- `ai-coding-worker/src/providers/BaseProvider.ts` - Abstract interface
- `ai-coding-worker/src/providers/ClaudeCodeProvider.ts` - Claude implementation
- `ai-coding-worker/src/providers/CodexProvider.ts` - Placeholder
- `ai-coding-worker/src/providers/ProviderFactory.ts` - Factory pattern
- `ai-coding-worker/src/utils/credentialManager.ts` - Credential storage
- `website/packages/shared/src/types.ts` - Shared types
- `website/apps/server/src/routes/execute.ts` - API endpoint
- `website/apps/server/src/lib/claudeAuth.ts` - OAuth token refresh

## OpenAI Codex SDK Information

From [@openai/codex-sdk](https://www.npmjs.com/package/@openai/codex-sdk) (v0.63.0):

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();
const result = await thread.run("Your task here");

// Streaming support
for await (const event of thread.runStreamed("task")) {
  // Handle events: thread.started, turn.started, item.completed, etc.
}
```

**Authentication:** Uses ChatGPT Plus/Pro/Business subscriptions or API key.

---

## Implementation Plan

### Phase 1: AI Coding Worker - Core Provider Implementation

#### 1.1 Install OpenAI Codex SDK
**File:** `ai-coding-worker/package.json`

Add dependency:
```json
"@openai/codex-sdk": "^0.63.0"
```

#### 1.2 Implement CodexProvider
**File:** `ai-coding-worker/src/providers/CodexProvider.ts`

Replace placeholder with full implementation:

```typescript
import { Codex, Thread } from "@openai/codex-sdk";
import { BaseProvider, ProviderOptions, ProviderStreamEvent } from './BaseProvider';
import { CredentialManager } from '../utils/credentialManager';
import { UserRequestContent, TextBlock, ImageBlock } from '../types';

export class CodexProvider extends BaseProvider {
  private codex: Codex;
  private activeThread?: Thread;
  private threadId?: string;

  constructor(authentication: string, workspace: string, model?: string, isResuming?: boolean) {
    super(authentication, workspace);

    // Write credentials to ~/.codex/auth.json
    CredentialManager.writeCodexCredentials(authentication);

    // Initialize Codex SDK
    this.codex = new Codex({
      // SDK reads from ~/.codex/auth.json or env vars
    });
  }

  async execute(
    userRequest: UserRequestContent,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    // Convert structured content to string for Codex
    const prompt = this.extractPromptText(userRequest);

    // Resume existing thread or start new one
    const thread = options.resumeSessionId
      ? this.codex.resumeThread(options.resumeSessionId)
      : this.codex.startThread();

    this.activeThread = thread;

    // Send init event
    onEvent({
      type: 'assistant_message',
      data: {
        type: 'system',
        subtype: 'init',
        session_id: thread.id,
        message: 'Codex provider initialized'
      }
    });

    // Use streaming API for real-time events
    for await (const event of thread.runStreamed(prompt)) {
      // Map Codex events to our unified event format
      const mappedEvent = this.mapCodexEvent(event);
      if (mappedEvent) {
        onEvent(mappedEvent);
      }
    }
  }

  private extractPromptText(content: UserRequestContent): string {
    if (typeof content === 'string') return content;
    return content
      .filter((block): block is TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }

  private mapCodexEvent(event: any): ProviderStreamEvent | null {
    // Map Codex SDK events to our unified format
    // Events: thread.started, turn.started, turn.completed,
    //         item.started, item.completed, agent_message, etc.
    switch (event.type) {
      case 'agent_message':
        return {
          type: 'assistant_message',
          data: {
            type: 'assistant',
            message: { content: [{ type: 'text', text: event.content }] }
          }
        };
      case 'command_execution':
        return {
          type: 'assistant_message',
          data: {
            type: 'tool_use',
            tool: event.command,
            result: event.output
          }
        };
      // ... map other event types
      default:
        return null;
    }
  }

  async validateToken(): Promise<boolean> {
    const credPath = CredentialManager.getCodexCredentialPath();
    return CredentialManager.credentialFileExists(credPath);
  }

  getProviderName(): string {
    return 'codex';
  }
}
```

#### 1.3 Update ProviderFactory
**File:** `ai-coding-worker/src/providers/ProviderFactory.ts`

Update to pass model and isResuming to CodexProvider:

```typescript
case 'codex':
case 'cursor':
case 'codexsdk':
case 'openai':
  return new CodexProvider(authentication, workspace, options?.model, isResuming);
```

#### 1.4 Update Credential Manager
**File:** `ai-coding-worker/src/utils/credentialManager.ts`

Enhance Codex credential handling for different auth formats:

```typescript
static writeCodexCredentials(authentication: string): void {
  const credentialPath = this.getCodexCredentialPath();

  let credentials: any;
  try {
    const parsed = JSON.parse(authentication);

    // Handle different auth formats
    if (parsed.apiKey) {
      // OpenAI API key format
      credentials = { apiKey: parsed.apiKey };
    } else if (parsed.accessToken) {
      // ChatGPT subscription OAuth
      credentials = {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt
      };
    } else {
      credentials = parsed;
    }
  } catch {
    // Plain API key string
    credentials = { apiKey: authentication };
  }

  this.writeCredentialFile(credentialPath, credentials);
}
```

---

### Phase 2: Shared Types - Multi-Provider Support

#### 2.1 Update Shared Types
**File:** `website/packages/shared/src/types.ts`

Add provider-agnostic auth types:

```typescript
// Existing ClaudeAuth remains unchanged
export interface ClaudeAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string;
  rateLimitTier: string;
}

// New: OpenAI/Codex authentication
export interface CodexAuth {
  apiKey?: string;           // For API key auth
  accessToken?: string;      // For ChatGPT subscription OAuth
  refreshToken?: string;
  expiresAt?: number;
}

// Union type for provider authentication
export type ProviderAuth = ClaudeAuth | CodexAuth;

// Provider types enum
export type AIProvider = 'claude' | 'codex';

// Update User interface
export interface User {
  // ... existing fields ...
  claudeAuth: ClaudeAuth | null;
  codexAuth: CodexAuth | null;         // NEW: Codex credentials
  preferredProvider: AIProvider;        // NEW: User's preferred provider
  preferredModel?: string | null;
}

// Update ExecuteRequest
export interface ExecuteRequest {
  userRequest: string;
  codingAssistantProvider: 'ClaudeAgentSDK' | 'Codex';
  codingAssistantAuthentication: ClaudeAuth | CodexAuth;  // Updated type
  // ... rest unchanged
}
```

---

### Phase 3: Website Server - API Updates

#### 3.1 Create Codex Auth Module
**File:** `website/apps/server/src/lib/codexAuth.ts` (NEW)

```typescript
import type { CodexAuth } from '@webedt/shared';

// Token refresh for ChatGPT subscription OAuth (if applicable)
export async function ensureValidCodexToken(codexAuth: CodexAuth): Promise<CodexAuth> {
  // If using API key, no refresh needed
  if (codexAuth.apiKey) {
    return codexAuth;
  }

  // If using OAuth and token is expiring, refresh
  if (codexAuth.accessToken && codexAuth.expiresAt) {
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (Date.now() >= codexAuth.expiresAt - bufferTime) {
      return await refreshCodexToken(codexAuth);
    }
  }

  return codexAuth;
}

async function refreshCodexToken(codexAuth: CodexAuth): Promise<CodexAuth> {
  // OpenAI OAuth token refresh endpoint (if applicable)
  // This depends on how Codex SDK handles auth - may need investigation
  throw new Error('Codex token refresh not yet implemented');
}
```

#### 3.2 Update Execute Route
**File:** `website/apps/server/src/routes/execute.ts`

Add provider selection and auth handling:

```typescript
import { ensureValidToken as ensureValidClaudeToken } from '../lib/claudeAuth';
import { ensureValidCodexToken } from '../lib/codexAuth';

// In executeHandler:

// Determine provider from request or user preference
const provider = params.provider || authReq.user?.preferredProvider || 'claude';

let authentication: any;
let providerName: string;

if (provider === 'codex') {
  if (!authReq.user?.codexAuth) {
    return res.status(400).json({
      success: false,
      error: 'Codex authentication not configured. Please add your OpenAI credentials.',
    });
  }

  authentication = await ensureValidCodexToken(authReq.user.codexAuth);
  providerName = 'Codex';
} else {
  // Default to Claude
  if (!authReq.user?.claudeAuth) {
    return res.status(400).json({
      success: false,
      error: 'Claude authentication not configured. Please add your Claude credentials.',
    });
  }

  authentication = await ensureValidClaudeToken(authReq.user.claudeAuth);
  providerName = 'ClaudeAgentSDK';
}

const executePayload = {
  userRequest: parsedUserRequest,
  codingAssistantProvider: providerName,
  codingAssistantAuthentication: authentication,
  // ... rest unchanged
};
```

#### 3.3 Update Database Schema
**File:** `website/apps/server/src/db/schema.ts`

Add Codex auth column to users table:

```typescript
export const users = pgTable('users', {
  // ... existing columns ...
  claudeAuth: jsonb('claude_auth').$type<ClaudeAuth>(),
  codexAuth: jsonb('codex_auth').$type<CodexAuth>(),    // NEW
  preferredProvider: text('preferred_provider').default('claude'),  // NEW
});
```

---

### Phase 4: Website Client - UI Updates

#### 4.1 Add Provider Settings Component
**File:** `website/apps/client/src/components/settings/ProviderSettings.tsx` (NEW)

```tsx
export function ProviderSettings() {
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');

  return (
    <div>
      <h3>AI Provider</h3>
      <select value={provider} onChange={e => setProvider(e.target.value)}>
        <option value="claude">Claude (Anthropic)</option>
        <option value="codex">Codex (OpenAI)</option>
      </select>

      {provider === 'claude' && <ClaudeAuthSettings />}
      {provider === 'codex' && <CodexAuthSettings />}
    </div>
  );
}
```

#### 4.2 Add Codex Auth Flow
**File:** `website/apps/client/src/components/settings/CodexAuthSettings.tsx` (NEW)

Options:
1. **API Key**: Simple text input for OpenAI API key
2. **ChatGPT OAuth**: OAuth flow similar to Claude (if Codex SDK supports it)

```tsx
export function CodexAuthSettings() {
  const [authMethod, setAuthMethod] = useState<'apiKey' | 'oauth'>('apiKey');
  const [apiKey, setApiKey] = useState('');

  const handleSaveApiKey = async () => {
    await api.saveCodexAuth({ apiKey });
  };

  return (
    <div>
      <h4>OpenAI Codex Authentication</h4>

      <div>
        <label>
          <input
            type="radio"
            checked={authMethod === 'apiKey'}
            onChange={() => setAuthMethod('apiKey')}
          />
          API Key
        </label>
        <label>
          <input
            type="radio"
            checked={authMethod === 'oauth'}
            onChange={() => setAuthMethod('oauth')}
          />
          ChatGPT Subscription
        </label>
      </div>

      {authMethod === 'apiKey' && (
        <div>
          <input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <button onClick={handleSaveApiKey}>Save</button>
        </div>
      )}

      {authMethod === 'oauth' && (
        <button onClick={() => startCodexOAuth()}>
          Connect ChatGPT Account
        </button>
      )}
    </div>
  );
}
```

#### 4.3 Update API Client
**File:** `website/apps/client/src/lib/api.ts`

Add provider parameter to execute function:

```typescript
export function createExecuteEventSource(data: {
  userRequest: string;
  provider?: 'claude' | 'codex';  // NEW
  github?: { repoUrl: string; branch: string };
  autoCommit?: boolean;
  websiteSessionId?: string;
}) {
  // ... existing implementation
}
```

---

### Phase 5: LLM Helper Updates

#### 5.1 Make LLMHelper Provider-Agnostic
**File:** `ai-coding-worker/src/utils/llmHelper.ts`

Currently uses Claude Haiku for commit messages and session titles. Options:

**Option A: Keep Claude for helpers (Recommended)**
- LLM helper tasks (commit messages, titles) are simple and don't need the full agent
- Continue using Claude Haiku even when main provider is Codex
- Simpler implementation, proven reliability

**Option B: Use selected provider for everything**
- Use Codex for helper tasks when Codex is selected
- More consistent but requires Codex-specific prompting

Recommendation: **Option A** - Keep using Claude Haiku for helper tasks as it's cost-effective and reliable.

---

### Phase 6: Event Normalization Layer

#### 6.1 Create Event Normalizer
**File:** `ai-coding-worker/src/utils/eventNormalizer.ts` (NEW)

Create a unified event format that both providers map to:

```typescript
export interface NormalizedEvent {
  type: 'init' | 'message' | 'tool_call' | 'tool_result' | 'error' | 'complete';
  provider: 'claude' | 'codex';
  timestamp: string;
  content?: any;
  tool?: {
    name: string;
    input?: any;
    output?: any;
  };
  metadata?: Record<string, any>;
}

export class EventNormalizer {
  static normalizeClaudeEvent(event: any): NormalizedEvent {
    // Map Claude SDK events to normalized format
  }

  static normalizeCodexEvent(event: any): NormalizedEvent {
    // Map Codex SDK events to normalized format
  }
}
```

This ensures the frontend receives consistent events regardless of provider.

---

## File Changes Summary

### New Files
1. `website/apps/server/src/lib/codexAuth.ts` - Codex token management
2. `website/apps/client/src/components/settings/ProviderSettings.tsx` - Provider selection UI
3. `website/apps/client/src/components/settings/CodexAuthSettings.tsx` - Codex auth UI
4. `ai-coding-worker/src/utils/eventNormalizer.ts` - Event normalization

### Modified Files
1. `ai-coding-worker/package.json` - Add @openai/codex-sdk dependency
2. `ai-coding-worker/src/providers/CodexProvider.ts` - Full implementation
3. `ai-coding-worker/src/providers/ProviderFactory.ts` - Add 'openai' alias
4. `ai-coding-worker/src/utils/credentialManager.ts` - Enhanced Codex auth
5. `website/packages/shared/src/types.ts` - Add CodexAuth, update User
6. `website/apps/server/src/db/schema.ts` - Add codexAuth column
7. `website/apps/server/src/routes/execute.ts` - Provider selection logic
8. `website/apps/client/src/lib/api.ts` - Add provider parameter

### Database Migration
- Add `codex_auth` JSONB column to users table
- Add `preferred_provider` TEXT column with default 'claude'

---

## Implementation Order

1. **Phase 1** - AI Worker core (can be developed independently)
2. **Phase 2** - Shared types (foundation for phases 3-4)
3. **Phase 3** - Server API updates
4. **Phase 4** - Client UI updates
5. **Phase 5** - LLM Helper decision (minimal changes if Option A)
6. **Phase 6** - Event normalization (polish/refinement)

---

## Open Questions / Considerations

1. **Codex SDK Authentication**: Need to verify exact auth flow - API key vs ChatGPT subscription OAuth
2. **Event Mapping**: Need to test actual Codex SDK events to create accurate mappings
3. **Image Support**: Codex may not support images - need graceful fallback
4. **Tool Compatibility**: Codex tools may differ from Claude tools - events need mapping
5. **Session Resume**: Verify Codex thread resume works similarly to Claude session resume

---

## Testing Plan

1. Unit tests for CodexProvider
2. Integration test with mock Codex SDK
3. E2E test with real Codex API (requires API key)
4. Frontend provider switching tests
5. Session resume tests for both providers
