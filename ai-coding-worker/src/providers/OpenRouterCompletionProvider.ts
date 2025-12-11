/**
 * OpenRouter Completion Provider
 *
 * Specialized provider for fast code completions using OpenRouter API.
 * Default model: openai/gpt-oss-120b:cerebras (extremely fast - 2700+ tokens/sec)
 *
 * This provider is designed for autocomplete/tab-complete functionality,
 * not for full agentic coding sessions.
 */

export interface CompletionRequest {
  prefix: string;
  suffix?: string;
  language: string;
  filename?: string;
  cursorLine?: number;
  cursorColumn?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResponse {
  suggestion: string;
  confidence: number;
  provider: string;
  model: string;
  cached: boolean;
  latencyMs: number;
  tokensUsed?: {
    prompt: number;
    completion: number;
  };
}

interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterCompletionProvider {
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  // Default to Cerebras-hosted GPT-OSS-120B for maximum speed
  static readonly DEFAULT_MODEL = 'openai/gpt-oss-120b:cerebras';

  // Alternative models for fallback
  static readonly FALLBACK_MODELS = [
    'openai/gpt-oss-120b',        // Any provider
    'deepseek/deepseek-coder',    // Good for code
    'anthropic/claude-3-haiku',   // Fast Claude
  ];

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || OpenRouterCompletionProvider.DEFAULT_MODEL;
  }

  /**
   * Generate a code completion using Fill-in-the-Middle style prompting
   *
   * Since OpenRouter uses chat completions (not native FIM), we simulate
   * FIM behavior with a carefully crafted prompt that includes both
   * prefix and suffix context.
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();

    const {
      prefix,
      suffix = '',
      language,
      filename,
      maxTokens = 150,
      temperature = 0.2,
    } = request;

    // Build the FIM-style prompt for chat completion
    const systemPrompt = this.buildSystemPrompt(language, filename);
    const userPrompt = this.buildFIMPrompt(prefix, suffix, language);

    const messages: OpenRouterChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://webedt.com', // Required by OpenRouter
          'X-Title': 'WebEDT Code Editor', // Optional but recommended
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stop: this.getStopSequences(language),
          // Route to Cerebras for fastest inference
          provider: {
            order: ['Cerebras'],
            allow_fallbacks: true,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as OpenRouterResponse;
      const latencyMs = Date.now() - startTime;

      // Extract the completion from the response
      const rawCompletion = data.choices[0]?.message?.content || '';

      // Clean up the completion
      const suggestion = this.cleanupCompletion(rawCompletion, prefix, suffix);

      return {
        suggestion,
        confidence: suggestion.length > 0 ? 0.85 : 0,
        provider: 'openrouter',
        model: this.model,
        cached: false,
        latencyMs,
        tokensUsed: data.usage ? {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
        } : undefined,
      };
    } catch (error) {
      console.error('[OpenRouterCompletionProvider] Completion error:', error);
      throw error;
    }
  }

  /**
   * Build the system prompt for code completion
   */
  private buildSystemPrompt(language: string, filename?: string): string {
    const fileContext = filename ? ` in file "${filename}"` : '';

    return `You are an expert code completion assistant. Your task is to complete code${fileContext}.

Rules:
1. Output ONLY the code that should be inserted at the cursor position
2. Do NOT include any explanation, markdown, or commentary
3. Do NOT repeat code that already exists before or after the cursor
4. Keep completions concise - typically 1-3 lines unless a longer block is clearly needed
5. Match the existing code style, indentation, and naming conventions
6. If the completion would be empty or unclear, output nothing

Language: ${language}`;
  }

  /**
   * Build a Fill-in-the-Middle style prompt from prefix and suffix
   */
  private buildFIMPrompt(prefix: string, suffix: string, language: string): string {
    // Truncate prefix/suffix to avoid huge context
    const maxPrefixChars = 3000;  // ~750 tokens
    const maxSuffixChars = 1000;  // ~250 tokens

    const truncatedPrefix = prefix.length > maxPrefixChars
      ? '...\n' + prefix.slice(-maxPrefixChars)
      : prefix;

    const truncatedSuffix = suffix.length > maxSuffixChars
      ? suffix.slice(0, maxSuffixChars) + '\n...'
      : suffix;

    // Format as a clear FIM task
    if (truncatedSuffix.trim()) {
      return `Complete the code at <CURSOR>. Output only the code to insert.

\`\`\`${language}
${truncatedPrefix}<CURSOR>${truncatedSuffix}
\`\`\`

Code to insert at <CURSOR>:`;
    } else {
      // No suffix - simpler completion
      return `Continue this code. Output only the code to add.

\`\`\`${language}
${truncatedPrefix}
\`\`\`

Code to add:`;
    }
  }

  /**
   * Get language-appropriate stop sequences
   */
  private getStopSequences(language: string): string[] {
    const commonStops = ['\n\n\n', '```', '<CURSOR>', '</'];

    const languageStops: Record<string, string[]> = {
      python: ['\ndef ', '\nclass ', '\n# ---'],
      javascript: ['\nfunction ', '\nclass ', '\n// ---'],
      typescript: ['\nfunction ', '\nclass ', '\ninterface ', '\ntype ', '\n// ---'],
      java: ['\npublic ', '\nprivate ', '\nprotected ', '\nclass '],
      go: ['\nfunc ', '\ntype ', '\n// ---'],
      rust: ['\nfn ', '\nimpl ', '\nstruct ', '\nenum '],
    };

    return [...commonStops, ...(languageStops[language.toLowerCase()] || [])];
  }

  /**
   * Clean up the completion to remove artifacts
   */
  private cleanupCompletion(completion: string, prefix: string, suffix: string): string {
    let cleaned = completion.trim();

    // Remove markdown code blocks if present
    if (cleaned.startsWith('```')) {
      const lines = cleaned.split('\n');
      lines.shift(); // Remove opening ```
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop(); // Remove closing ```
      }
      cleaned = lines.join('\n');
    }

    // Remove any <CURSOR> markers that leaked through
    cleaned = cleaned.replace(/<CURSOR>/g, '');

    // Don't return if it's just whitespace
    if (!cleaned.trim()) {
      return '';
    }

    // Check if completion duplicates end of prefix
    const prefixEnd = prefix.slice(-100);
    for (let i = Math.min(50, cleaned.length); i > 0; i--) {
      const overlap = cleaned.slice(0, i);
      if (prefixEnd.endsWith(overlap)) {
        cleaned = cleaned.slice(i);
        break;
      }
    }

    // Check if completion duplicates start of suffix
    const suffixStart = suffix.slice(0, 100);
    for (let i = Math.min(50, cleaned.length); i > 0; i--) {
      const overlap = cleaned.slice(-i);
      if (suffixStart.startsWith(overlap)) {
        cleaned = cleaned.slice(0, -i);
        break;
      }
    }

    return cleaned;
  }

  /**
   * Validate the API key by making a minimal request
   */
  async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get provider info
   */
  getProviderInfo(): { name: string; model: string } {
    return {
      name: 'openrouter',
      model: this.model,
    };
  }
}

// Simple in-memory cache for completions
const completionCache = new Map<string, { response: CompletionResponse; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Get a cache key for a completion request
 */
function getCacheKey(request: CompletionRequest): string {
  // Use last 500 chars of prefix + first 200 chars of suffix
  const prefixKey = request.prefix.slice(-500);
  const suffixKey = (request.suffix || '').slice(0, 200);
  return `${prefixKey}|||${suffixKey}|||${request.language}`;
}

/**
 * Wrapper function with caching
 */
export async function getCompletionWithCache(
  provider: OpenRouterCompletionProvider,
  request: CompletionRequest
): Promise<CompletionResponse> {
  const cacheKey = getCacheKey(request);
  const cached = completionCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.response, cached: true };
  }

  const response = await provider.complete(request);

  // Cache successful completions
  if (response.suggestion) {
    completionCache.set(cacheKey, { response, timestamp: Date.now() });

    // Cleanup old entries periodically
    if (completionCache.size > 500) {
      const now = Date.now();
      for (const [key, value] of completionCache.entries()) {
        if (now - value.timestamp > CACHE_TTL_MS) {
          completionCache.delete(key);
        }
      }
    }
  }

  return response;
}
