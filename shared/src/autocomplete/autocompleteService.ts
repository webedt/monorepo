/**
 * Autocomplete Service Implementation
 * AI-powered code completion using OpenRouter
 */

import { AAutocompleteService } from './AAutocompleteService.js';
import { OPENROUTER_API_KEY } from '../config/env.js';
import { logger } from '../utils/logging/logger.js';

import type { AutocompleteRequest } from './types.js';
import type { AutocompleteResponse } from './types.js';
import type { AutocompleteSuggestion } from './types.js';
import type { SuggestionKind } from './types.js';

export class AutocompleteService extends AAutocompleteService {
  async complete(request: AutocompleteRequest): Promise<AutocompleteResponse> {
    const startTime = Date.now();

    if (!OPENROUTER_API_KEY) {
      logger.warn('Autocomplete unavailable: OPENROUTER_API_KEY not set', {
        component: 'AutocompleteService',
      });
      return {
        suggestions: [],
        latencyMs: Date.now() - startTime,
      };
    }

    try {
      const suggestions = await this.fetchSuggestions(request);
      return {
        suggestions,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Autocomplete failed', {
        component: 'AutocompleteService',
        error: (error as Error).message,
      });
      return {
        suggestions: [],
        latencyMs: Date.now() - startTime,
      };
    }
  }

  private async fetchSuggestions(request: AutocompleteRequest): Promise<AutocompleteSuggestion[]> {
    const { prefix, suffix, language, filePath, maxSuggestions = 3, additionalContext } = request;

    // Build context from additional files
    let contextBlock = '';
    if (additionalContext && additionalContext.length > 0) {
      const contextParts = additionalContext
        .slice(0, 3) // Limit to 3 files for context
        .map(ctx => `// File: ${ctx.filePath}\n${ctx.content.slice(0, 500)}`)
        .join('\n\n');
      contextBlock = `\n\nRelated files for context:\n${contextParts}`;
    }

    const systemPrompt = `You are a code completion assistant. Your task is to complete code at the cursor position.

Rules:
- Return ONLY the code to insert at cursor position
- Do not repeat code that's already present
- Keep completions concise (1-3 lines typically)
- Match the coding style and indentation of the surrounding code
- Return valid ${language} code
- If multiple completions are possible, return the most likely one
- Do not include explanations, just the code`;

    const userPrompt = `Complete this ${language} code at the <CURSOR> position:

${filePath ? `File: ${filePath}\n` : ''}
\`\`\`${language}
${prefix}<CURSOR>${suffix}
\`\`\`${contextBlock}

Return only the code to insert at <CURSOR>. No explanation.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://webedt.io',
          'X-Title': 'WebEDT Autocomplete',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          n: Math.min(maxSuggestions, 3), // Request multiple completions
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string }; index: number }>;
      };

      // Process each choice into a suggestion
      const suggestions: AutocompleteSuggestion[] = [];
      const seenTexts = new Set<string>();

      for (const choice of data.choices || []) {
        const rawText = choice.message?.content || '';
        const text = this.cleanCompletion(rawText, language);

        if (text && !seenTexts.has(text)) {
          seenTexts.add(text);
          suggestions.push({
            text,
            label: this.createLabel(text),
            kind: this.inferKind(text, language),
            confidence: 1 - suggestions.length * 0.1, // Slightly lower confidence for later suggestions
          });
        }
      }

      return suggestions.slice(0, maxSuggestions);
    } finally {
      clearTimeout(timeout);
    }
  }

  private cleanCompletion(text: string, language: string): string {
    // Remove markdown code blocks if present
    let cleaned = text.trim();

    // Remove ```language and ``` wrappers
    const codeBlockMatch = cleaned.match(/^```[\w]*\n?([\s\S]*?)```$/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    // Remove backticks
    if (cleaned.startsWith('`') && cleaned.endsWith('`')) {
      cleaned = cleaned.slice(1, -1);
    }

    // Remove leading/trailing empty lines
    cleaned = cleaned.replace(/^\n+|\n+$/g, '');

    return cleaned;
  }

  private createLabel(text: string): string {
    // Create a short label from the completion
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length <= 40) {
      return firstLine;
    }
    return firstLine.slice(0, 37) + '...';
  }

  private inferKind(text: string, language: string): SuggestionKind {
    // Try to infer the type of suggestion
    const trimmed = text.trim();

    // Check for function/method patterns
    if (/^(function|def|fn|func)\s/.test(trimmed) ||
        /^\w+\s*\([^)]*\)\s*(=>|\{|:)/.test(trimmed)) {
      return 'function';
    }

    // Check for class patterns
    if (/^class\s/.test(trimmed)) {
      return 'class';
    }

    // Check for interface/type patterns
    if (/^(interface|type|struct)\s/.test(trimmed)) {
      return 'interface';
    }

    // Check for variable patterns
    if (/^(const|let|var|val|mut)\s/.test(trimmed)) {
      return 'variable';
    }

    // Check for keywords
    if (/^(if|else|for|while|return|import|export|async|await)\s/.test(trimmed)) {
      return 'keyword';
    }

    // Check for property access
    if (/^\.\w+/.test(trimmed)) {
      return 'property';
    }

    // Check for method call
    if (/^\w+\([^)]*\)/.test(trimmed)) {
      return 'method';
    }

    return 'text';
  }

  dispose(): void {
    // Nothing to clean up
  }
}
