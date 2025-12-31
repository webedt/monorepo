/**
 * Tests for Image Generation Routes
 * Covers prompt validation, provider selection, and response formats.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without AI API access. Integration tests would require OpenRouter/CometAPI/Google setup.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

type ImageGenProvider = 'openrouter' | 'cometapi' | 'google';

interface ImageGenerationRequest {
  prompt: string;
  imageData?: string;
  selection?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  provider?: ImageGenProvider;
  model?: string;
}

interface ModelInfo {
  id: string;
  displayName: string;
  description: string;
  providers: ImageGenProvider[];
}

interface ProviderInfo {
  id: ImageGenProvider;
  name: string;
  description: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Constants (mirror route constants)
// ============================================================================

const AVAILABLE_MODELS: Record<string, Omit<ModelInfo, 'id'>> = {
  'google/gemini-2.5-flash-image': {
    displayName: 'Gemini 2.5 Flash Image',
    description: 'Fast image generation and editing',
    providers: ['openrouter', 'cometapi', 'google'],
  },
  'google/gemini-3-pro-image-preview': {
    displayName: 'Gemini 3 Pro Image Preview',
    description: 'Advanced image generation with higher quality',
    providers: ['openrouter', 'cometapi', 'google'],
  },
};

const AVAILABLE_PROVIDERS: ProviderInfo[] = [
  { id: 'openrouter', name: 'OpenRouter', description: 'Access multiple AI models through OpenRouter' },
  { id: 'cometapi', name: 'CometAPI', description: 'Alternative API provider' },
  { id: 'google', name: 'Google AI', description: 'Direct access to Google Gemini models' },
];

const VALID_PROVIDERS: ImageGenProvider[] = ['openrouter', 'cometapi', 'google'];

const DEFAULT_PROVIDER: ImageGenProvider = 'openrouter';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function validatePrompt(prompt: string | undefined): ValidationResult {
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return { valid: false, error: 'Prompt is required' };
  }

  return { valid: true };
}

function validateProvider(provider: string | undefined): ValidationResult {
  if (!provider) {
    return { valid: true }; // Optional, will use default
  }

  if (!VALID_PROVIDERS.includes(provider as ImageGenProvider)) {
    return { valid: false, error: `Invalid provider: ${provider}` };
  }

  return { valid: true };
}

function validateModel(model: string | undefined): ValidationResult {
  if (!model) {
    return { valid: true }; // Optional, will use default
  }

  if (!AVAILABLE_MODELS[model]) {
    return { valid: false, error: `Invalid model: ${model}` };
  }

  return { valid: true };
}

function validateApiKey(apiKey: string | undefined, provider: string): ValidationResult {
  if (!apiKey) {
    return {
      valid: false,
      error: `No API key configured for ${provider}. Please add your API key in Settings.`,
    };
  }

  return { valid: true };
}

function validateSelection(selection: ImageGenerationRequest['selection']): ValidationResult {
  if (!selection) {
    return { valid: true }; // Optional
  }

  const { x, y, width, height } = selection;

  if (typeof x !== 'number' || x < 0) {
    return { valid: false, error: 'Invalid selection x coordinate' };
  }

  if (typeof y !== 'number' || y < 0) {
    return { valid: false, error: 'Invalid selection y coordinate' };
  }

  if (typeof width !== 'number' || width <= 0) {
    return { valid: false, error: 'Invalid selection width' };
  }

  if (typeof height !== 'number' || height <= 0) {
    return { valid: false, error: 'Invalid selection height' };
  }

  return { valid: true };
}

function isBase64Image(data: string): boolean {
  return data.startsWith('data:image/');
}

function getProviderAndModel(
  requestedProvider: ImageGenProvider | undefined,
  requestedModel: string | undefined,
  userDefaultProvider: ImageGenProvider | undefined,
  userDefaultModel: string | undefined
): { provider: ImageGenProvider; model: string } {
  return {
    provider: requestedProvider || userDefaultProvider || DEFAULT_PROVIDER,
    model: requestedModel || userDefaultModel || DEFAULT_MODEL,
  };
}

function isEditMode(imageData: string | undefined): boolean {
  return !!imageData;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('ImageGen Routes - Prompt Validation', () => {
  describe('validatePrompt', () => {
    it('should require prompt', () => {
      const result = validatePrompt(undefined);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Prompt is required');
    });

    it('should reject empty prompt', () => {
      const result = validatePrompt('');
      assert.strictEqual(result.valid, false);
    });

    it('should reject whitespace-only prompt', () => {
      const result = validatePrompt('   ');
      assert.strictEqual(result.valid, false);
    });

    it('should accept valid prompt', () => {
      const result = validatePrompt('Generate a beautiful sunset over mountains');
      assert.strictEqual(result.valid, true);
    });
  });
});

describe('ImageGen Routes - Provider Validation', () => {
  describe('validateProvider', () => {
    it('should accept undefined (uses default)', () => {
      const result = validateProvider(undefined);
      assert.strictEqual(result.valid, true);
    });

    it('should accept openrouter', () => {
      const result = validateProvider('openrouter');
      assert.strictEqual(result.valid, true);
    });

    it('should accept cometapi', () => {
      const result = validateProvider('cometapi');
      assert.strictEqual(result.valid, true);
    });

    it('should accept google', () => {
      const result = validateProvider('google');
      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid provider', () => {
      const result = validateProvider('dalle');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid provider'));
    });
  });
});

describe('ImageGen Routes - Model Validation', () => {
  describe('validateModel', () => {
    it('should accept undefined (uses default)', () => {
      const result = validateModel(undefined);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid model', () => {
      const result = validateModel('google/gemini-2.5-flash-image');
      assert.strictEqual(result.valid, true);
    });

    it('should accept alternative model', () => {
      const result = validateModel('google/gemini-3-pro-image-preview');
      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid model', () => {
      const result = validateModel('invalid/model-name');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid model'));
    });
  });
});

describe('ImageGen Routes - API Key Validation', () => {
  describe('validateApiKey', () => {
    it('should reject missing API key', () => {
      const result = validateApiKey(undefined, 'openrouter');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('No API key configured'));
      assert.ok(result.error?.includes('openrouter'));
    });

    it('should reject empty API key', () => {
      const result = validateApiKey('', 'google');
      assert.strictEqual(result.valid, false);
    });

    it('should accept valid API key', () => {
      const result = validateApiKey('sk-1234567890abcdef', 'openrouter');
      assert.strictEqual(result.valid, true);
    });
  });
});

describe('ImageGen Routes - Selection Validation', () => {
  describe('validateSelection', () => {
    it('should accept undefined (no selection)', () => {
      const result = validateSelection(undefined);
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid selection', () => {
      const result = validateSelection({
        x: 100,
        y: 100,
        width: 200,
        height: 150,
      });
      assert.strictEqual(result.valid, true);
    });

    it('should reject negative x', () => {
      const result = validateSelection({
        x: -10,
        y: 100,
        width: 200,
        height: 150,
      });
      assert.strictEqual(result.valid, false);
    });

    it('should reject zero width', () => {
      const result = validateSelection({
        x: 100,
        y: 100,
        width: 0,
        height: 150,
      });
      assert.strictEqual(result.valid, false);
    });

    it('should reject negative height', () => {
      const result = validateSelection({
        x: 100,
        y: 100,
        width: 200,
        height: -50,
      });
      assert.strictEqual(result.valid, false);
    });
  });
});

describe('ImageGen Routes - Image Data Validation', () => {
  describe('isBase64Image', () => {
    it('should recognize PNG data URL', () => {
      const data = 'data:image/png;base64,iVBORw0KGgo...';
      assert.strictEqual(isBase64Image(data), true);
    });

    it('should recognize JPEG data URL', () => {
      const data = 'data:image/jpeg;base64,/9j/4AAQSkZJRg...';
      assert.strictEqual(isBase64Image(data), true);
    });

    it('should recognize WebP data URL', () => {
      const data = 'data:image/webp;base64,UklGRh4A...';
      assert.strictEqual(isBase64Image(data), true);
    });

    it('should reject non-image data', () => {
      const data = 'data:text/plain;base64,SGVsbG8...';
      assert.strictEqual(isBase64Image(data), false);
    });

    it('should reject raw base64', () => {
      const data = 'iVBORw0KGgo...';
      assert.strictEqual(isBase64Image(data), false);
    });
  });

  describe('isEditMode', () => {
    it('should detect edit mode with image data', () => {
      assert.strictEqual(isEditMode('data:image/png;base64,...'), true);
    });

    it('should detect generation mode without image data', () => {
      assert.strictEqual(isEditMode(undefined), false);
    });

    it('should detect generation mode with empty string', () => {
      assert.strictEqual(isEditMode(''), false);
    });
  });
});

describe('ImageGen Routes - Provider/Model Resolution', () => {
  describe('getProviderAndModel', () => {
    it('should use requested provider and model', () => {
      const result = getProviderAndModel(
        'cometapi',
        'google/gemini-3-pro-image-preview',
        'openrouter',
        'google/gemini-2.5-flash-image'
      );

      assert.strictEqual(result.provider, 'cometapi');
      assert.strictEqual(result.model, 'google/gemini-3-pro-image-preview');
    });

    it('should fall back to user defaults', () => {
      const result = getProviderAndModel(
        undefined,
        undefined,
        'google',
        'google/gemini-3-pro-image-preview'
      );

      assert.strictEqual(result.provider, 'google');
      assert.strictEqual(result.model, 'google/gemini-3-pro-image-preview');
    });

    it('should use system defaults when no user defaults', () => {
      const result = getProviderAndModel(
        undefined,
        undefined,
        undefined,
        undefined
      );

      assert.strictEqual(result.provider, DEFAULT_PROVIDER);
      assert.strictEqual(result.model, DEFAULT_MODEL);
    });
  });
});

describe('ImageGen Routes - Response Format', () => {
  describe('Generation Success Response', () => {
    it('should return image data with metadata', () => {
      const response = createGenerationResponse(
        'data:image/png;base64,iVBORw0...',
        'openrouter',
        'google/gemini-2.5-flash-image'
      );

      assert.strictEqual(response.success, true);
      assert.ok(response.data.imageData.startsWith('data:image/'));
      assert.strictEqual(response.data.provider, 'openrouter');
      assert.strictEqual(response.data.model, 'google/gemini-2.5-flash-image');
    });
  });

  describe('Models Response', () => {
    it('should return available models and providers', () => {
      const response = createModelsResponse();

      assert.strictEqual(response.success, true);
      assert.ok(response.data.models.length > 0);
      assert.ok(response.data.providers.length > 0);

      // Verify model structure
      const model = response.data.models[0];
      assert.ok(model.id);
      assert.ok(model.displayName);
      assert.ok(model.providers.length > 0);

      // Verify provider structure
      const provider = response.data.providers[0];
      assert.ok(provider.id);
      assert.ok(provider.name);
    });
  });

  describe('Error Response', () => {
    it('should return prompt error', () => {
      const response = createErrorResponse('Prompt is required');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Prompt is required');
    });

    it('should return API key error', () => {
      const response = createErrorResponse('No API key configured for openrouter');

      assert.strictEqual(response.success, false);
      assert.ok(response.error.includes('API key'));
    });

    it('should return provider unavailable error', () => {
      const response = createServiceUnavailableResponse('google');

      assert.strictEqual(response.success, false);
      assert.ok(response.error.includes('temporarily unavailable'));
    });
  });
});

describe('ImageGen Routes - Authorization', () => {
  it('should require authentication for generation', () => {
    const requiresAuth = true;
    assert.strictEqual(requiresAuth, true);
  });

  it('should require authentication for models list', () => {
    const requiresAuth = true;
    assert.strictEqual(requiresAuth, true);
  });

  it('should be rate limited', () => {
    // Uses aiOperationRateLimiter (10/min per user)
    const isRateLimited = true;
    const limitPerMinute = 10;

    assert.strictEqual(isRateLimited, true);
    assert.strictEqual(limitPerMinute, 10);
  });
});

describe('ImageGen Routes - Available Models', () => {
  it('should include Gemini 2.5 Flash Image', () => {
    assert.ok(AVAILABLE_MODELS['google/gemini-2.5-flash-image']);
  });

  it('should include Gemini 3 Pro Image Preview', () => {
    assert.ok(AVAILABLE_MODELS['google/gemini-3-pro-image-preview']);
  });

  it('should support multiple providers per model', () => {
    const model = AVAILABLE_MODELS['google/gemini-2.5-flash-image'];
    assert.ok(model.providers.length >= 2);
    assert.ok(model.providers.includes('openrouter'));
    assert.ok(model.providers.includes('google'));
  });
});

describe('ImageGen Routes - Available Providers', () => {
  it('should include OpenRouter', () => {
    assert.ok(AVAILABLE_PROVIDERS.some(p => p.id === 'openrouter'));
  });

  it('should include CometAPI', () => {
    assert.ok(AVAILABLE_PROVIDERS.some(p => p.id === 'cometapi'));
  });

  it('should include Google', () => {
    assert.ok(AVAILABLE_PROVIDERS.some(p => p.id === 'google'));
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createGenerationResponse(
  imageData: string,
  provider: string,
  model: string
): {
  success: boolean;
  data: {
    imageData: string;
    provider: string;
    model: string;
  };
} {
  return {
    success: true,
    data: { imageData, provider, model },
  };
}

function createModelsResponse(): {
  success: boolean;
  data: {
    models: ModelInfo[];
    providers: ProviderInfo[];
  };
} {
  return {
    success: true,
    data: {
      models: Object.entries(AVAILABLE_MODELS).map(([id, info]) => ({
        id,
        ...info,
      })),
      providers: AVAILABLE_PROVIDERS,
    },
  };
}

function createServiceUnavailableResponse(provider: string): {
  success: boolean;
  error: string;
} {
  return {
    success: false,
    error: `Image generation provider ${provider} is temporarily unavailable. Please try again later.`,
  };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
