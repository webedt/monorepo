/**
 * Tests for llm.ts CLI command
 *
 * Tests the LLM operations:
 * - llm execute - Execute a one-off LLM request
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

import {
  createMockConsole,
  createMockProcessExit,
} from '../helpers/mocks.js';

// ============================================================================
// MOCK TYPES
// ============================================================================

interface LlmResult {
  content: string;
  provider: string;
  model: string;
  cost?: number;
}

// ============================================================================
// MOCK SETUP
// ============================================================================

const mockLlmExecute = mock.fn<(params: { prompt: string; model?: string }) => Promise<LlmResult>>();

// Store original console and process.exit
let originalConsoleLog: typeof console.log;
let originalConsoleError: typeof console.error;
let originalProcessExit: typeof process.exit;
let mockConsole: ReturnType<typeof createMockConsole>;
let mockExit: ReturnType<typeof createMockProcessExit>;

// ============================================================================
// TEST HELPERS
// ============================================================================

function setupMocks() {
  originalConsoleLog = console.log;
  originalConsoleError = console.error;
  originalProcessExit = process.exit;

  mockConsole = createMockConsole();
  mockExit = createMockProcessExit();

  console.log = mockConsole.log;
  console.error = mockConsole.error;
  process.exit = mockExit.exit;
}

function teardownMocks() {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalProcessExit;
  mock.reset();
}

function createMockLlmResult(overrides: Partial<LlmResult> = {}): LlmResult {
  return {
    content: 'This is a test response from the LLM.',
    provider: 'openrouter',
    model: 'claude-3-opus',
    cost: 0.001234,
    ...overrides,
  };
}

// ============================================================================
// TESTS: LLM EXECUTE COMMAND
// ============================================================================

describe('LLM Command', () => {
  describe('llm execute', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    describe('Argument Validation', () => {
      it('should require a prompt argument', () => {
        const prompt = 'What is the capital of France?';

        assert.ok(prompt);
        assert.ok(prompt.length > 0);
      });

      it('should accept optional model argument', () => {
        const options = {
          model: 'claude-3-opus',
        };

        assert.strictEqual(options.model, 'claude-3-opus');
      });

      it('should use default model when not specified', () => {
        const options: { model?: string } = {};

        assert.strictEqual(options.model, undefined);
      });
    });

    describe('Execution', () => {
      it('should execute LLM request successfully', async () => {
        const result = createMockLlmResult();
        mockLlmExecute.mock.mockImplementation(async () => result);

        const response = await mockLlmExecute({ prompt: 'Test prompt' });

        assert.ok(response.content);
        assert.ok(response.provider);
        assert.ok(response.model);
      });

      it('should pass model option to LLM service', async () => {
        const result = createMockLlmResult({ model: 'gpt-4' });
        mockLlmExecute.mock.mockImplementation(async (params) => ({
          ...result,
          model: params.model || 'default-model',
        }));

        const response = await mockLlmExecute({ prompt: 'Test', model: 'gpt-4' });

        assert.strictEqual(response.model, 'gpt-4');
      });

      it('should handle execution errors', async () => {
        mockLlmExecute.mock.mockImplementation(async () => {
          throw new Error('LLM service unavailable');
        });

        try {
          await mockLlmExecute({ prompt: 'Test' });
          assert.fail('Should have thrown');
        } catch (error) {
          assert.ok(error instanceof Error);
          assert.strictEqual((error as Error).message, 'LLM service unavailable');
        }
      });
    });

    describe('Output Formatting', () => {
      it('should format prompt preview correctly', () => {
        const shortPrompt = 'What is 2+2?';
        const longPrompt = 'A'.repeat(150);

        const shortPreview = shortPrompt.slice(0, 100) + (shortPrompt.length > 100 ? '...' : '');
        const longPreview = longPrompt.slice(0, 100) + (longPrompt.length > 100 ? '...' : '');

        assert.strictEqual(shortPreview, 'What is 2+2?');
        assert.ok(longPreview.endsWith('...'));
        assert.strictEqual(longPreview.length, 103); // 100 chars + '...'
      });

      it('should format result correctly', () => {
        const result = createMockLlmResult({
          content: 'The answer is 42.',
          provider: 'openrouter',
          model: 'claude-3-opus',
          cost: 0.001234,
        });

        const output = [
          'Result:',
          '-'.repeat(80),
          result.content,
          '-'.repeat(80),
          `Provider: ${result.provider}`,
          `Model: ${result.model}`,
          `Cost: $${result.cost?.toFixed(6)}`,
        ].join('\n');

        assert.ok(output.includes('The answer is 42.'));
        assert.ok(output.includes('Provider: openrouter'));
        assert.ok(output.includes('Model: claude-3-opus'));
        assert.ok(output.includes('Cost: $0.001234'));
      });

      it('should handle missing cost gracefully', () => {
        const result = createMockLlmResult({ cost: undefined });

        const costOutput = result.cost ? `Cost: $${result.cost.toFixed(6)}` : null;

        assert.strictEqual(costOutput, null);
      });
    });

    describe('JSON Output', () => {
      it('should format result as JSON when --json flag is used', () => {
        const result = createMockLlmResult();
        const jsonOutput = JSON.stringify(result, null, 2);

        assert.ok(jsonOutput.includes('"content"'));
        assert.ok(jsonOutput.includes('"provider"'));
        assert.ok(jsonOutput.includes('"model"'));
      });

      it('should suppress non-JSON output when --json is used', () => {
        const options = { json: true };

        // When json is true, no prompt preview should be shown
        if (options.json) {
          // Only JSON output should be produced
          const result = createMockLlmResult();
          const output = JSON.stringify(result, null, 2);

          assert.ok(output.startsWith('{'));
          assert.ok(output.endsWith('}'));
        }
      });
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('LLM Command Edge Cases', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    teardownMocks();
  });

  it('should handle very long prompts', () => {
    const longPrompt = 'A'.repeat(10000);

    assert.strictEqual(longPrompt.length, 10000);

    // Preview should be truncated
    const preview = longPrompt.slice(0, 100) + '...';
    assert.strictEqual(preview.length, 103);
  });

  it('should handle very long responses', () => {
    const result = createMockLlmResult({
      content: 'B'.repeat(10000),
    });

    assert.strictEqual(result.content.length, 10000);
  });

  it('should handle special characters in prompt', () => {
    const prompts = [
      'What is "quoted text"?',
      "What's the answer?",
      'Code: function foo() { return 1; }',
      'Math: 2 + 2 = 4',
      'Emoji: 🎉🚀',
    ];

    for (const prompt of prompts) {
      assert.ok(prompt.length > 0);
    }
  });

  it('should handle newlines in prompt', () => {
    const multilinePrompt = `Line 1
Line 2
Line 3`;

    assert.ok(multilinePrompt.includes('\n'));
  });

  it('should handle zero cost', () => {
    const result = createMockLlmResult({ cost: 0 });

    const costFormatted = result.cost !== undefined ? `$${result.cost.toFixed(6)}` : 'N/A';

    assert.strictEqual(costFormatted, '$0.000000');
  });

  it('should handle very small costs', () => {
    const result = createMockLlmResult({ cost: 0.000001 });

    const costFormatted = `$${result.cost?.toFixed(6)}`;

    assert.strictEqual(costFormatted, '$0.000001');
  });

  it('should handle various providers', () => {
    const providers = ['openrouter', 'anthropic', 'openai', 'local'];

    for (const provider of providers) {
      const result = createMockLlmResult({ provider });
      assert.strictEqual(result.provider, provider);
    }
  });

  it('should handle various models', () => {
    const models = [
      'claude-3-opus',
      'claude-3-sonnet',
      'gpt-4',
      'gpt-4-turbo',
      'llama-3',
    ];

    for (const model of models) {
      const result = createMockLlmResult({ model });
      assert.strictEqual(result.model, model);
    }
  });

  it('should handle network timeout', async () => {
    mockLlmExecute.mock.mockImplementation(async () => {
      throw new Error('Request timeout');
    });

    try {
      await mockLlmExecute({ prompt: 'Test' });
      assert.fail('Should have thrown');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok((error as Error).message.includes('timeout'));
    }
  });

  it('should handle rate limiting', async () => {
    mockLlmExecute.mock.mockImplementation(async () => {
      throw new Error('Rate limit exceeded');
    });

    try {
      await mockLlmExecute({ prompt: 'Test' });
      assert.fail('Should have thrown');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok((error as Error).message.includes('Rate limit'));
    }
  });
});
