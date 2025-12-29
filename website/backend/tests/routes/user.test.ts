/**
 * Tests for User Routes
 * Covers user settings, preferences, and authentication management.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('User Routes - Claude Authentication', () => {
  describe('POST /claude-auth', () => {
    it('should require accessToken', () => {
      const body = { refreshToken: 'refresh-token' };
      const result = validateClaudeAuth(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('accessToken'));
    });

    it('should require refreshToken', () => {
      const body = { accessToken: 'access-token' };
      const result = validateClaudeAuth(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('refreshToken'));
    });

    it('should accept valid claudeAuth object', () => {
      const body = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      const result = validateClaudeAuth(body);

      assert.strictEqual(result.valid, true);
    });

    it('should unwrap claudeAiOauth wrapper', () => {
      const body = {
        claudeAiOauth: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      };
      const result = validateClaudeAuth(body);

      assert.strictEqual(result.valid, true);
    });

    it('should unwrap claudeAuth wrapper', () => {
      const body = {
        claudeAuth: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      };
      const result = validateClaudeAuth(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('DELETE /claude-auth', () => {
    it('should return success response format', () => {
      const response = createSuccessResponse('Claude authentication removed');

      assert.strictEqual(response.success, true);
      assert.ok(response.data.message.includes('Claude'));
    });
  });
});

describe('User Routes - Codex Authentication', () => {
  describe('POST /codex-auth', () => {
    it('should require apiKey or accessToken', () => {
      const body = {};
      const result = validateCodexAuth(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('apiKey'));
    });

    it('should accept apiKey', () => {
      const body = { apiKey: 'sk-xxx' };
      const result = validateCodexAuth(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept accessToken', () => {
      const body = { accessToken: 'access-token' };
      const result = validateCodexAuth(body);

      assert.strictEqual(result.valid, true);
    });

    it('should unwrap codexAuth wrapper', () => {
      const body = { codexAuth: { apiKey: 'sk-xxx' } };
      const result = validateCodexAuth(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('User Routes - Gemini Authentication', () => {
  describe('POST /gemini-auth', () => {
    it('should require accessToken', () => {
      const body = { refreshToken: 'refresh-token' };
      const result = validateGeminiAuth(body);

      assert.strictEqual(result.valid, false);
    });

    it('should require refreshToken', () => {
      const body = { accessToken: 'access-token' };
      const result = validateGeminiAuth(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept camelCase format', () => {
      const body = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      const result = validateGeminiAuth(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept snake_case format (Gemini CLI format)', () => {
      const body = {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      };
      const result = validateGeminiAuth(body);

      assert.strictEqual(result.valid, true);
    });

    it('should normalize auth to camelCase format', () => {
      const body = {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expiry_date: 1234567890,
        token_type: 'Bearer',
      };

      const normalized = normalizeGeminiAuth(body);

      assert.strictEqual(normalized.accessToken, 'access-token');
      assert.strictEqual(normalized.refreshToken, 'refresh-token');
      assert.strictEqual(normalized.expiresAt, 1234567890);
      assert.strictEqual(normalized.tokenType, 'Bearer');
    });
  });
});

describe('User Routes - Provider Preference', () => {
  describe('POST /preferred-provider', () => {
    it('should reject invalid provider', () => {
      const body = { provider: 'invalid' };
      const result = validatePreferredProvider(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('claude, codex, copilot, gemini'));
    });

    it('should accept claude provider', () => {
      const body = { provider: 'claude' };
      const result = validatePreferredProvider(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept codex provider', () => {
      const body = { provider: 'codex' };
      const result = validatePreferredProvider(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept gemini provider', () => {
      const body = { provider: 'gemini' };
      const result = validatePreferredProvider(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('User Routes - Image Resize Setting', () => {
  describe('POST /image-resize-setting', () => {
    it('should reject invalid dimension', () => {
      const body = { maxDimension: 999 };
      const result = validateImageResizeSetting(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('512, 1024, 2048, 4096, 8000'));
    });

    it('should accept valid dimensions', () => {
      const validDimensions = [512, 1024, 2048, 4096, 8000];

      for (const maxDimension of validDimensions) {
        const body = { maxDimension };
        const result = validateImageResizeSetting(body);
        assert.strictEqual(result.valid, true, `Dimension ${maxDimension} should be valid`);
      }
    });
  });
});

describe('User Routes - Display Name', () => {
  describe('POST /display-name', () => {
    it('should reject non-string display name', () => {
      const body = { displayName: 12345 };
      const result = validateDisplayName(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject display name over 100 characters', () => {
      const body = { displayName: 'A'.repeat(101) };
      const result = validateDisplayName(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('100 characters'));
    });

    it('should accept valid display name', () => {
      const body = { displayName: 'John Doe' };
      const result = validateDisplayName(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept empty string (clears display name)', () => {
      const body = { displayName: '' };
      const result = validateDisplayName(body);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.value, null);
    });

    it('should accept null', () => {
      const body = { displayName: null };
      const result = validateDisplayName(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('User Routes - Voice Command Keywords', () => {
  describe('POST /voice-command-keywords', () => {
    it('should require keywords to be an array', () => {
      const body = { keywords: 'not-an-array' };
      const result = validateVoiceKeywords(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Keywords must be an array');
    });

    it('should filter out non-string values', () => {
      const body = { keywords: ['valid', 123, 'another'] };
      const result = validateVoiceKeywords(body);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.keywords?.length, 2);
    });

    it('should normalize keywords to lowercase', () => {
      const body = { keywords: ['HELLO', 'World'] };
      const result = validateVoiceKeywords(body);

      assert.deepStrictEqual(result.keywords, ['hello', 'world']);
    });

    it('should remove duplicates', () => {
      const body = { keywords: ['hello', 'HELLO', 'world'] };
      const result = validateVoiceKeywords(body);

      assert.strictEqual(result.keywords?.length, 2);
    });

    it('should trim whitespace', () => {
      const body = { keywords: ['  hello  ', ' world '] };
      const result = validateVoiceKeywords(body);

      assert.deepStrictEqual(result.keywords, ['hello', 'world']);
    });

    it('should reject more than 20 keywords', () => {
      const body = { keywords: Array(21).fill('keyword') };
      const result = validateVoiceKeywords(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Maximum of 20 keywords allowed');
    });
  });
});

describe('User Routes - Stop Listening After Submit', () => {
  describe('POST /stop-listening-after-submit', () => {
    it('should require boolean value', () => {
      const body = { stopAfterSubmit: 'true' };
      const result = validateStopListening(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'stopAfterSubmit must be a boolean');
    });

    it('should accept true', () => {
      const body = { stopAfterSubmit: true };
      const result = validateStopListening(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept false', () => {
      const body = { stopAfterSubmit: false };
      const result = validateStopListening(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('User Routes - Default Landing Page', () => {
  describe('POST /default-landing-page', () => {
    it('should reject invalid landing page', () => {
      const body = { landingPage: 'invalid' };
      const result = validateLandingPage(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('store, library, community, sessions'));
    });

    it('should accept valid landing pages', () => {
      const validPages = ['store', 'library', 'community', 'sessions'];

      for (const landingPage of validPages) {
        const body = { landingPage };
        const result = validateLandingPage(body);
        assert.strictEqual(result.valid, true, `Page '${landingPage}' should be valid`);
      }
    });
  });
});

describe('User Routes - Preferred Model', () => {
  describe('POST /preferred-model', () => {
    it('should reject invalid model', () => {
      const body = { preferredModel: 'invalid' };
      const result = validatePreferredModel(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept opus model', () => {
      const body = { preferredModel: 'opus' };
      const result = validatePreferredModel(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept sonnet model', () => {
      const body = { preferredModel: 'sonnet' };
      const result = validatePreferredModel(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept empty string (clears preference)', () => {
      const body = { preferredModel: '' };
      const result = validatePreferredModel(body);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.value, null);
    });
  });
});

describe('User Routes - Chat Verbosity', () => {
  describe('POST /chat-verbosity', () => {
    it('should reject invalid verbosity level', () => {
      const body = { verbosityLevel: 'invalid' };
      const result = validateVerbosityLevel(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('minimal, normal, verbose'));
    });

    it('should accept valid verbosity levels', () => {
      const validLevels = ['minimal', 'normal', 'verbose'];

      for (const verbosityLevel of validLevels) {
        const body = { verbosityLevel };
        const result = validateVerbosityLevel(body);
        assert.strictEqual(result.valid, true, `Level '${verbosityLevel}' should be valid`);
      }
    });
  });
});

describe('User Routes - OpenRouter API Key', () => {
  describe('POST /openrouter-api-key', () => {
    it('should reject empty API key', () => {
      const body = { apiKey: '' };
      const result = validateOpenRouterApiKey(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject non-string API key', () => {
      const body = { apiKey: 12345 };
      const result = validateOpenRouterApiKey(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject API key without sk-or- prefix', () => {
      const body = { apiKey: 'invalid-key' };
      const result = validateOpenRouterApiKey(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('sk-or-'));
    });

    it('should accept valid OpenRouter API key', () => {
      const body = { apiKey: 'sk-or-v1-xxx' };
      const result = validateOpenRouterApiKey(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('User Routes - Autocomplete Settings', () => {
  describe('POST /autocomplete-settings', () => {
    it('should require at least one setting', () => {
      const body = {};
      const result = validateAutocompleteSettings(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'No valid settings to update');
    });

    it('should accept enabled flag', () => {
      const body = { enabled: true };
      const result = validateAutocompleteSettings(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid model', () => {
      const body = { model: 'invalid-model' };
      const result = validateAutocompleteSettings(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid models', () => {
      const validModels = [
        'openai/gpt-oss-120b:cerebras',
        'openai/gpt-oss-120b',
        'deepseek/deepseek-coder',
        'anthropic/claude-3-haiku',
      ];

      for (const model of validModels) {
        const body = { model };
        const result = validateAutocompleteSettings(body);
        assert.strictEqual(result.valid, true, `Model '${model}' should be valid`);
      }
    });
  });
});

describe('User Routes - Spending Limits', () => {
  describe('POST /spending-limits', () => {
    it('should require at least one setting', () => {
      const body = {};
      const result = validateSpendingLimits(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'No valid settings to update');
    });

    it('should accept enabled flag', () => {
      const body = { enabled: true };
      const result = validateSpendingLimits(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject negative monthly budget', () => {
      const body = { monthlyBudgetCents: -100 };
      const result = validateSpendingLimits(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('non-negative'));
    });

    it('should accept valid monthly budget', () => {
      const body = { monthlyBudgetCents: 1000 };
      const result = validateSpendingLimits(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid reset day', () => {
      const body = { resetDay: 32 };
      const result = validateSpendingLimits(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('1 and 31'));
    });

    it('should accept valid reset day', () => {
      const body = { resetDay: 15 };
      const result = validateSpendingLimits(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid limit action', () => {
      const body = { limitAction: 'invalid' };
      const result = validateSpendingLimits(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid limit actions', () => {
      const validActions = ['warn', 'block'];

      for (const limitAction of validActions) {
        const body = { limitAction };
        const result = validateSpendingLimits(body);
        assert.strictEqual(result.valid, true, `Action '${limitAction}' should be valid`);
      }
    });
  });

  describe('GET /spending-limits', () => {
    it('should calculate remaining budget', () => {
      const monthlyBudget = 10000;
      const currentSpent = 3500;

      const remaining = calculateRemainingBudget(monthlyBudget, currentSpent);

      assert.strictEqual(remaining, 6500);
    });

    it('should not return negative remaining budget', () => {
      const monthlyBudget = 1000;
      const currentSpent = 1500;

      const remaining = calculateRemainingBudget(monthlyBudget, currentSpent);

      assert.strictEqual(remaining, 0);
    });

    it('should calculate usage percent', () => {
      const monthlyBudget = 10000;
      const currentSpent = 5000;

      const usagePercent = calculateUsagePercent(monthlyBudget, currentSpent);

      assert.strictEqual(usagePercent, 50);
    });

    it('should handle zero budget', () => {
      const monthlyBudget = 0;
      const currentSpent = 0;

      const usagePercent = calculateUsagePercent(monthlyBudget, currentSpent);

      assert.strictEqual(usagePercent, 0);
    });
  });
});

// Helper functions that mirror the validation logic in user.ts
function validateClaudeAuth(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  let claudeAuth = body.claudeAuth || body.claudeAiOauth || body;

  if (claudeAuth.claudeAiOauth) {
    claudeAuth = claudeAuth.claudeAiOauth;
  }

  if (!claudeAuth || !claudeAuth.accessToken || !claudeAuth.refreshToken) {
    return {
      valid: false,
      error: 'Invalid Claude auth. Must include accessToken and refreshToken.',
    };
  }

  return { valid: true };
}

function validateCodexAuth(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  let codexAuth = body.codexAuth || body;

  if (!codexAuth || (!codexAuth.apiKey && !codexAuth.accessToken)) {
    return {
      valid: false,
      error: 'Invalid Codex auth. Must include either apiKey or accessToken.',
    };
  }

  return { valid: true };
}

function validateGeminiAuth(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  let geminiAuth = body.geminiAuth || body;

  const accessToken = geminiAuth.accessToken || geminiAuth.access_token;
  const refreshToken = geminiAuth.refreshToken || geminiAuth.refresh_token;

  if (!accessToken || !refreshToken) {
    return {
      valid: false,
      error: 'Invalid Gemini auth. Must include OAuth tokens.',
    };
  }

  return { valid: true };
}

function normalizeGeminiAuth(body: Record<string, unknown>): {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
} {
  return {
    accessToken: (body.accessToken || body.access_token) as string,
    refreshToken: (body.refreshToken || body.refresh_token) as string,
    expiresAt: (body.expiresAt || body.expiry_date || Date.now() + 3600000) as number,
    tokenType: (body.tokenType || body.token_type || 'Bearer') as string,
  };
}

function validatePreferredProvider(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { provider } = body;
  const validProviders = ['claude', 'codex', 'copilot', 'gemini'];

  if (!validProviders.includes(provider as string)) {
    return {
      valid: false,
      error: 'Invalid provider. Must be one of: claude, codex, copilot, gemini',
    };
  }

  return { valid: true };
}

function validateImageResizeSetting(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { maxDimension } = body;
  const validDimensions = [512, 1024, 2048, 4096, 8000];

  if (!validDimensions.includes(maxDimension as number)) {
    return {
      valid: false,
      error: 'Invalid max dimension. Must be one of: 512, 1024, 2048, 4096, 8000',
    };
  }

  return { valid: true };
}

function validateDisplayName(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  value?: string | null;
} {
  const { displayName } = body;

  if (displayName === null || displayName === undefined) {
    return { valid: true, value: null };
  }

  if (displayName === '') {
    return { valid: true, value: null };
  }

  if (typeof displayName !== 'string') {
    return { valid: false, error: 'Display name must be a string' };
  }

  if (displayName.length > 100) {
    return { valid: false, error: 'Display name must be 100 characters or less' };
  }

  return { valid: true, value: displayName };
}

function validateVoiceKeywords(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  keywords?: string[];
} {
  const { keywords } = body;

  if (!Array.isArray(keywords)) {
    return { valid: false, error: 'Keywords must be an array' };
  }

  const normalized = keywords
    .filter((k: unknown): k is string => typeof k === 'string' && (k as string).trim().length > 0)
    .map((k: string) => k.trim().toLowerCase());

  const unique = [...new Set(normalized)];

  if (unique.length > 20) {
    return { valid: false, error: 'Maximum of 20 keywords allowed' };
  }

  return { valid: true, keywords: unique };
}

function validateStopListening(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { stopAfterSubmit } = body;

  if (typeof stopAfterSubmit !== 'boolean') {
    return { valid: false, error: 'stopAfterSubmit must be a boolean' };
  }

  return { valid: true };
}

function validateLandingPage(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { landingPage } = body;
  const validPages = ['store', 'library', 'community', 'sessions'];

  if (!validPages.includes(landingPage as string)) {
    return {
      valid: false,
      error: 'Invalid landing page. Must be one of: store, library, community, sessions',
    };
  }

  return { valid: true };
}

function validatePreferredModel(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  value?: string | null;
} {
  const { preferredModel } = body;
  const validModels = ['', 'opus', 'sonnet'];

  if (preferredModel === null || preferredModel === undefined) {
    return { valid: true, value: null };
  }

  if (!validModels.includes(preferredModel as string)) {
    return { valid: false, error: 'Invalid preferred model' };
  }

  return { valid: true, value: preferredModel === '' ? null : (preferredModel as string) };
}

function validateVerbosityLevel(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { verbosityLevel } = body;
  const validLevels = ['minimal', 'normal', 'verbose'];

  if (!validLevels.includes(verbosityLevel as string)) {
    return {
      valid: false,
      error: 'Invalid verbosity level. Must be one of: minimal, normal, verbose',
    };
  }

  return { valid: true };
}

function validateOpenRouterApiKey(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { apiKey } = body;

  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: false, error: 'Invalid API key. Must be a non-empty string.' };
  }

  if (!apiKey.startsWith('sk-or-')) {
    return {
      valid: false,
      error: 'Invalid OpenRouter API key format. Keys should start with "sk-or-".',
    };
  }

  return { valid: true };
}

function validateAutocompleteSettings(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { enabled, model } = body;
  const updates: Record<string, unknown> = {};

  if (typeof enabled === 'boolean') {
    updates.autocompleteEnabled = enabled;
  }

  if (model && typeof model === 'string') {
    const validModels = [
      'openai/gpt-oss-120b:cerebras',
      'openai/gpt-oss-120b',
      'deepseek/deepseek-coder',
      'anthropic/claude-3-haiku',
    ];
    if (!validModels.includes(model)) {
      return { valid: false, error: `Invalid model. Must be one of: ${validModels.join(', ')}` };
    }
    updates.autocompleteModel = model;
  }

  if (Object.keys(updates).length === 0) {
    return { valid: false, error: 'No valid settings to update' };
  }

  return { valid: true };
}

function validateSpendingLimits(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { enabled, monthlyBudgetCents, perTransactionLimitCents, resetDay, limitAction } = body;
  const updates: Record<string, unknown> = {};

  if (typeof enabled === 'boolean') {
    updates.enabled = enabled;
  }

  if (monthlyBudgetCents !== undefined) {
    const budget = Number(monthlyBudgetCents);
    if (isNaN(budget) || budget < 0) {
      return { valid: false, error: 'Monthly budget must be a non-negative number' };
    }
    updates.monthlyBudgetCents = budget;
  }

  if (perTransactionLimitCents !== undefined) {
    const limit = Number(perTransactionLimitCents);
    if (isNaN(limit) || limit < 0) {
      return { valid: false, error: 'Per-transaction limit must be a non-negative number' };
    }
    updates.perTransactionLimitCents = limit;
  }

  if (resetDay !== undefined) {
    const day = Number(resetDay);
    if (isNaN(day) || day < 1 || day > 31) {
      return { valid: false, error: 'Reset day must be between 1 and 31' };
    }
    updates.resetDay = day;
  }

  if (limitAction !== undefined) {
    const validActions = ['warn', 'block'];
    if (!validActions.includes(limitAction as string)) {
      return { valid: false, error: 'Limit action must be one of: warn, block' };
    }
    updates.limitAction = limitAction;
  }

  if (Object.keys(updates).length === 0) {
    return { valid: false, error: 'No valid settings to update' };
  }

  return { valid: true };
}

function createSuccessResponse(message: string): {
  success: boolean;
  data: { message: string };
} {
  return { success: true, data: { message } };
}

function calculateRemainingBudget(monthlyBudget: number, currentSpent: number): number {
  return Math.max(0, monthlyBudget - currentSpent);
}

function calculateUsagePercent(monthlyBudget: number, currentSpent: number): number {
  if (monthlyBudget === 0) return 0;
  return (currentSpent / monthlyBudget) * 100;
}
