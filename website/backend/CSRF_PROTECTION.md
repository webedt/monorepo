# CSRF Protection Audit and Strategy

## Overview

This document provides a comprehensive audit of CSRF (Cross-Site Request Forgery) protection across all state-changing endpoints in the WebEDT backend API.

## Implementation Details

### Double-Submit Cookie Pattern

WebEDT uses the **double-submit cookie pattern** for CSRF protection:

1. Server generates a secure random token (256 bits) and sets it in a cookie (`csrf_token`)
2. Frontend reads the cookie and sends the token in a header (`X-CSRF-Token`)
3. Server validates that the header matches the cookie

This pattern is secure because:
- Attackers from other origins cannot read cookies from our domain (same-origin policy)
- The token must be sent both as a cookie AND as a header
- Cookie `SameSite=Lax` provides additional protection against CSRF

### Token Configuration

| Setting | Value |
|---------|-------|
| Cookie name | `csrf_token` |
| Header name | `x-csrf-token` |
| Token length | 32 bytes (256 bits) |
| Token encoding | Hexadecimal (64 characters) |
| Expiry | 24 hours |
| Cookie flags | `SameSite=Lax`, `Secure` (production), `Path=/` |

### Protected HTTP Methods

CSRF validation is applied to these HTTP methods:
- **POST** - Create operations
- **PUT** - Full update operations
- **DELETE** - Delete operations
- **PATCH** - Partial update operations

Safe methods (GET, HEAD, OPTIONS) are not protected as they should not modify state.

## Route Audit

### Exempt Routes

The following routes are exempt from CSRF protection with documented justifications:

#### SSE Streaming Endpoints
These endpoints use Server-Sent Events (EventSource) which does not support custom headers:

| Route | Method | Justification |
|-------|--------|---------------|
| `/api/execute-remote` | POST | SSE streaming for AI execution |
| `/api/resume/:sessionId` | GET | SSE event replay |
| `/api/sessions/:id/events/stream` | GET | Real-time session events |
| `/api/orchestrator/:id/stream` | GET | Orchestrator status streaming |
| `/api/live-chat/:owner/:repo/:branch/execute` | POST | Live chat SSE execution |
| `/api/workspace/events/:owner/:repo/stream` | GET | Workspace event streaming |
| `/api/workspace/presence/:owner/:repo/stream` | GET | Presence update streaming |

#### Authentication Endpoints (Pre-Session)
No session exists to protect; these are rate-limited instead:

| Route | Method | Justification |
|-------|--------|---------------|
| `/api/auth/login` | POST | No authenticated session exists yet |
| `/api/auth/register` | POST | No authenticated session exists yet |

#### External Webhook Callbacks
External services cannot include CSRF tokens; validated via signatures instead:

| Route | Method | Justification |
|-------|--------|---------------|
| `/api/github/callback` | GET/POST | OAuth callback from GitHub |
| `/api/payments/webhooks/stripe` | POST | Stripe webhook (signature verified) |
| `/api/payments/webhooks/paypal` | POST | PayPal webhook (signature verified) |

#### Infrastructure Endpoints
Health checks and metrics for monitoring:

| Route | Method | Justification |
|-------|--------|---------------|
| `/health*` | GET | Load balancer health checks |
| `/ready` | GET | Kubernetes readiness probe |
| `/live` | GET | Kubernetes liveness probe |
| `/metrics` | GET | Performance metrics |
| `/api/docs*` | GET | API documentation |
| `/api/openapi.json` | GET | OpenAPI specification |

### Protected Routes (Require CSRF Token)

All other state-changing routes require valid CSRF tokens. Here's the complete list organized by module:

#### Authentication (website/backend/src/api/routes/auth.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/logout` | POST | Logout user |

#### User Settings (website/backend/src/api/routes/user/)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/user/claude-auth` | POST | Update Claude auth |
| `/api/user/claude-auth` | DELETE | Remove Claude auth |
| `/api/user/claude-auth/refresh` | POST | Refresh Claude token |
| `/api/user/codex-auth` | POST | Update Codex auth |
| `/api/user/codex-auth` | DELETE | Remove Codex auth |
| `/api/user/gemini-auth` | POST | Update Gemini auth |
| `/api/user/gemini-auth` | DELETE | Remove Gemini auth |
| `/api/user/preferred-provider` | POST | Update provider preference |
| `/api/user/image-resize-setting` | POST | Update image resize |
| `/api/user/display-name` | POST | Update display name |
| `/api/user/voice-command-keywords` | POST | Update voice keywords |
| `/api/user/stop-listening-after-submit` | POST | Update voice setting |
| `/api/user/default-landing-page` | POST | Update landing page |
| `/api/user/preferred-model` | POST | Update model preference |
| `/api/user/chat-verbosity` | POST | Update chat verbosity |
| `/api/user/openrouter-api-key` | POST | Update OpenRouter key |
| `/api/user/openrouter-api-key` | DELETE | Remove OpenRouter key |
| `/api/user/autocomplete-settings` | POST | Update autocomplete |
| `/api/user/image-ai-keys` | POST | Update image AI keys |
| `/api/user/image-ai-provider` | POST | Update image AI provider |
| `/api/user/image-ai-model` | POST | Update image AI model |
| `/api/user/spending-limits` | POST | Update spending limits |
| `/api/user/spending-limits/reset` | POST | Reset spending |

#### Sessions (website/backend/src/api/routes/sessions/)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/sessions/:id` | PATCH | Update session |
| `/api/sessions/:id` | DELETE | Delete session |
| `/api/sessions/:id/messages` | POST | Create message |
| `/api/sessions/:id/events` | POST | Create event |
| `/api/sessions/:id/restore` | POST | Restore session |
| `/api/sessions/:id/abort` | POST | Abort session |
| `/api/sessions/:id/send` | POST | Send message |
| `/api/sessions/:id/init-repository` | POST | Initialize repo |
| `/api/sessions/:id/sync-events` | POST | Sync events |
| `/api/sessions/:id/favorite` | POST | Toggle favorite |
| `/api/sessions/:id/share` | POST | Create share link |
| `/api/sessions/:id/share` | DELETE | Remove share link |
| `/api/sessions/bulk-delete` | POST | Bulk delete |
| `/api/sessions/bulk-restore` | POST | Bulk restore |
| `/api/sessions/bulk-delete-permanent` | POST | Permanent bulk delete |
| `/api/sessions/create-code-session` | POST | Create code session |
| `/api/sessions/sync` | POST | Sync sessions |

#### GitHub (website/backend/src/api/routes/github/)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/github/disconnect` | POST | Disconnect GitHub |
| `/api/github/repos/:owner/:repo/branches` | POST | Create branch |
| `/api/github/repos/:owner/:repo/branches/*` | DELETE | Delete branch |
| `/api/github/repos/:owner/:repo/branches/*/merge-base` | POST | Get merge base |
| `/api/github/repos/:owner/:repo/contents/*` | PUT | Update file |
| `/api/github/repos/:owner/:repo/contents/*` | DELETE | Delete file |
| `/api/github/repos/:owner/:repo/rename/*` | POST | Rename file |
| `/api/github/repos/:owner/:repo/folder/*` | DELETE | Delete folder |
| `/api/github/repos/:owner/:repo/rename-folder/*` | POST | Rename folder |
| `/api/github/repos/:owner/:repo/pulls` | POST | Create PR |
| `/api/github/repos/:owner/:repo/pulls/:pull_number/merge` | POST | Merge PR |
| `/api/github/repos/:owner/:repo/generate-pr-content` | POST | Generate PR content |
| `/api/github/repos/:owner/:repo/branches/*/auto-pr` | POST | Auto PR |
| `/api/github/repos/:owner/:repo/commit` | POST | Create commit |

#### Internal Sessions (website/backend/src/api/routes/internalSessions.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/internal/sessions` | POST | Create session |
| `/api/internal/sessions/:id` | POST | Execute session |
| `/api/internal/sessions/:id` | PATCH | Update session |
| `/api/internal/sessions/:id` | DELETE | Delete session |
| `/api/internal/sessions/:id/archive` | POST | Archive session |
| `/api/internal/sessions/:id/interrupt` | POST | Interrupt session |

#### Admin (website/backend/src/api/routes/admin.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/admin/users` | POST | Create user |
| `/api/admin/users/:id` | PATCH | Update user |
| `/api/admin/users/:id` | DELETE | Delete user |
| `/api/admin/users/:id/impersonate` | POST | Impersonate user |
| `/api/admin/rate-limits/reset` | POST | Reset rate limits |

#### Collections (website/backend/src/api/routes/collections.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/collections` | POST | Create collection |
| `/api/collections/:id` | PATCH | Update collection |
| `/api/collections/:id` | DELETE | Delete collection |
| `/api/collections/:id/sessions/:sessionId` | POST | Add session |
| `/api/collections/:id/sessions/:sessionId` | DELETE | Remove session |
| `/api/collections/session/:sessionId/bulk` | POST | Bulk add |
| `/api/collections/reorder` | POST | Reorder collections |

#### Community (website/backend/src/api/routes/community.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/community/posts` | POST | Create post |
| `/api/community/posts/:id` | PATCH | Update post |
| `/api/community/posts/:id` | DELETE | Delete post |
| `/api/community/posts/:id/comments` | POST | Add comment |
| `/api/community/comments/:id` | DELETE | Delete comment |
| `/api/community/posts/:id/vote` | POST | Vote on post |
| `/api/community/comments/:id/vote` | POST | Vote on comment |

#### Channels (website/backend/src/api/routes/channels.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/channels` | POST | Create channel |
| `/api/channels/:id` | PATCH | Update channel |
| `/api/channels/:id/messages` | POST | Post message |
| `/api/channels/messages/:id` | PATCH | Edit message |
| `/api/channels/messages/:id` | DELETE | Delete message |

#### Store & Purchases
| Route | Method | Description |
|-------|--------|-------------|
| `/api/store/wishlist/:gameId` | POST | Add to wishlist |
| `/api/store/wishlist/:gameId` | DELETE | Remove from wishlist |
| `/api/purchases/buy/:gameId` | POST | Buy game |
| `/api/purchases/:purchaseId/refund` | POST | Request refund |

#### Library (website/backend/src/api/routes/library.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/library/:gameId/favorite` | POST | Toggle favorite |
| `/api/library/:gameId/hide` | POST | Hide game |
| `/api/library/:gameId/install-status` | POST | Update install status |
| `/api/library/:gameId/playtime` | POST | Add playtime |

#### Billing (website/backend/src/api/routes/billing.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/billing/change-plan` | POST | Change billing plan |

#### Payments (website/backend/src/api/routes/payments.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/payments/checkout` | POST | Create checkout |
| `/api/payments/paypal/capture` | POST | Capture PayPal |
| `/api/payments/transactions/:transactionId/refund` | POST | Process refund |

#### Organizations (website/backend/src/api/routes/organizations.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/organizations` | POST | Create org |
| `/api/organizations/:id` | PATCH | Update org |
| `/api/organizations/:id` | DELETE | Delete org |
| `/api/organizations/:id/members` | POST | Add member |
| `/api/organizations/:id/members/:userId` | PATCH | Update member |
| `/api/organizations/:id/members/:userId` | DELETE | Remove member |
| `/api/organizations/:id/leave` | POST | Leave org |
| `/api/organizations/:id/repositories` | POST | Add repository |
| `/api/organizations/:id/repositories/:owner/:repo` | DELETE | Remove repository |
| `/api/organizations/:id/repositories/:owner/:repo/default` | POST | Set default |
| `/api/organizations/:id/invitations` | POST | Create invitation |
| `/api/organizations/invitations/:token/accept` | POST | Accept invitation |

#### Taxonomies (website/backend/src/api/routes/taxonomies.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/taxonomies` | POST | Create taxonomy |
| `/api/taxonomies/:id` | PATCH | Update taxonomy |
| `/api/taxonomies/:id` | DELETE | Delete taxonomy |
| `/api/taxonomies/:taxonomyId/terms` | POST | Create term |
| `/api/taxonomies/terms/:termId` | PATCH | Update term |
| `/api/taxonomies/terms/:termId` | DELETE | Delete term |
| `/api/taxonomies/items/:itemType/:itemId/terms/:termId` | POST | Assign term |
| `/api/taxonomies/items/:itemType/:itemId/terms/:termId` | DELETE | Remove term |
| `/api/taxonomies/items/:itemType/:itemId` | PUT | Bulk update terms |

#### Announcements (website/backend/src/api/routes/announcements.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/announcements` | POST | Create announcement |
| `/api/announcements/:id` | PATCH | Update announcement |
| `/api/announcements/:id` | DELETE | Delete announcement |

#### Snippets (website/backend/src/api/routes/snippets.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/snippets` | POST | Create snippet |
| `/api/snippets/:id` | PUT | Update snippet |
| `/api/snippets/:id` | DELETE | Delete snippet |
| `/api/snippets/:id/use` | POST | Record usage |
| `/api/snippets/:id/favorite` | POST | Toggle favorite |
| `/api/snippets/:id/duplicate` | POST | Duplicate snippet |
| `/api/snippets/collections` | POST | Create collection |
| `/api/snippets/collections/:id` | PUT | Update collection |
| `/api/snippets/collections/:id` | DELETE | Delete collection |
| `/api/snippets/collections/:collectionId/snippets/:snippetId` | POST | Add to collection |
| `/api/snippets/collections/:collectionId/snippets/:snippetId` | DELETE | Remove from collection |

#### Storage (website/backend/src/api/routes/storage.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/storage/recalculate` | POST | Recalculate storage |
| `/api/storage/check` | POST | Check storage |
| `/api/storage/admin/:userId/quota` | POST | Admin set quota |
| `/api/storage/admin/:userId/tier` | POST | Admin set tier |
| `/api/storage/admin/:userId/recalculate` | POST | Admin recalculate |

#### Cloud Saves (website/backend/src/api/routes/cloudSaves.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/cloud-saves/check-conflicts` | POST | Check conflicts |
| `/api/cloud-saves/games/:gameId/slots/:slotNumber` | POST | Upload save |
| `/api/cloud-saves/games/:gameId/slots/:slotNumber` | DELETE | Delete save |
| `/api/cloud-saves/saves/:saveId/versions/:versionId/restore` | POST | Restore version |

#### Workspace (website/backend/src/api/routes/workspace.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/workspace/presence` | PUT | Update presence |
| `/api/workspace/presence/:owner/:repo/:branch` | DELETE | Remove presence |
| `/api/workspace/events` | POST | Create event |

#### Live Chat (website/backend/src/api/routes/liveChat.ts)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/live-chat` | POST | Create chat |
| `/api/live-chat/:owner/:repo/:branch/messages` | DELETE | Clear messages |

#### Other Routes
| Route | Method | Description |
|-------|--------|-------------|
| `/api/autocomplete` | POST | Code completion |
| `/api/transcribe` | POST | Audio transcription |
| `/api/image-gen/generate` | POST | Image generation |
| `/api/import/validate` | POST | Validate URL |
| `/api/import/url` | POST | Import from URL |
| `/api/logs` | DELETE | Clear logs |

## Frontend Implementation

The frontend automatically includes CSRF tokens in all state-changing requests:

```typescript
// From website/frontend/src/lib/api.ts
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function getCsrfTokenFromCookie(): string | null {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(value);
    }
  }
  return null;
}

// In fetchApi():
if (CSRF_PROTECTED_METHODS.has(method)) {
  const csrfToken = getCsrfTokenFromCookie();
  if (csrfToken) {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }
}
```

## Testing

CSRF protection is tested in `website/backend/tests/middleware/csrf.test.ts`:

- Token generation and cookie setting
- Token validation for all protected methods (POST, PUT, DELETE, PATCH)
- Exempt path handling
- Token mismatch rejection
- Token security (length, uniqueness)
- Cookie parsing edge cases

Run tests with:
```bash
cd website/backend
npm test -- --grep "CSRF"
```

## Security Considerations

1. **Token Entropy**: 256 bits of cryptographic randomness
2. **Timing-Safe Comparison**: Uses `crypto.timingSafeEqual` to prevent timing attacks
3. **SameSite Cookie**: `SameSite=Lax` provides defense-in-depth
4. **Secure Flag**: Enabled in production for HTTPS-only transmission
5. **Token Expiry**: 24-hour expiry limits attack window

## Adding New Routes

When adding new state-changing routes:

1. **By default, CSRF protection is applied** - no action needed
2. If the route should be exempt, add pattern to `EXEMPT_PATH_PATTERNS` in `csrf.ts`
3. Document the exemption reason in this file
4. Add tests to verify the expected behavior

## Audit Log

| Date | Action | By |
|------|--------|-----|
| 2026-01-02 | Initial CSRF audit and documentation | Claude Code |
| 2026-01-02 | Fixed webhook exempt pattern (webhook→webhooks) | Claude Code |
| 2026-01-02 | Added comprehensive CSRF tests | Claude Code |
