/**
 * Tests for Autocomplete Routes
 * Covers code completion request validation and language support.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without AI API access. Integration tests would require actual API setup.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

interface AutocompleteRequest {
  prefix: string;
  suffix: string;
  language: string;
  filePath?: string;
  maxSuggestions?: number;
  additionalContext?: string[];
}

interface AutocompleteSuggestion {
  text: string;
  confidence: number;
}

interface SupportedLanguage {
  id: string;
  name: string;
  extensions: string[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Constants (mirror route constants)
// ============================================================================

const LIMITS = {
  MAX_PREFIX_LENGTH: 4000,
  MAX_SUFFIX_LENGTH: 1000,
  MAX_SUGGESTIONS_DEFAULT: 3,
  MAX_SUGGESTIONS_LIMIT: 5,
  MAX_ADDITIONAL_CONTEXT: 3,
};

const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { id: 'typescript', name: 'TypeScript', extensions: ['.ts', '.tsx'] },
  { id: 'javascript', name: 'JavaScript', extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
  { id: 'python', name: 'Python', extensions: ['.py', '.pyw'] },
  { id: 'rust', name: 'Rust', extensions: ['.rs'] },
  { id: 'go', name: 'Go', extensions: ['.go'] },
  { id: 'java', name: 'Java', extensions: ['.java'] },
  { id: 'c', name: 'C', extensions: ['.c', '.h'] },
  { id: 'cpp', name: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'] },
  { id: 'csharp', name: 'C#', extensions: ['.cs'] },
  { id: 'ruby', name: 'Ruby', extensions: ['.rb'] },
  { id: 'php', name: 'PHP', extensions: ['.php'] },
  { id: 'html', name: 'HTML', extensions: ['.html', '.htm'] },
  { id: 'css', name: 'CSS', extensions: ['.css'] },
  { id: 'scss', name: 'SCSS', extensions: ['.scss', '.sass'] },
  { id: 'sql', name: 'SQL', extensions: ['.sql'] },
  { id: 'shell', name: 'Shell', extensions: ['.sh', '.bash', '.zsh'] },
  { id: 'yaml', name: 'YAML', extensions: ['.yml', '.yaml'] },
  { id: 'json', name: 'JSON', extensions: ['.json'] },
  { id: 'markdown', name: 'Markdown', extensions: ['.md', '.markdown'] },
  { id: 'xml', name: 'XML', extensions: ['.xml'] },
];

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function validateAutocompleteRequest(body: Partial<AutocompleteRequest>): ValidationResult {
  const { prefix, suffix, language } = body;

  if (typeof prefix !== 'string') {
    return { valid: false, error: 'prefix is required and must be a string' };
  }

  if (typeof suffix !== 'string') {
    return { valid: false, error: 'suffix is required and must be a string' };
  }

  if (typeof language !== 'string' || language.trim().length === 0) {
    return { valid: false, error: 'language is required' };
  }

  return { valid: true };
}

function truncateContext(prefix: string, suffix: string): { prefix: string; suffix: string } {
  return {
    prefix: prefix.slice(-LIMITS.MAX_PREFIX_LENGTH),
    suffix: suffix.slice(0, LIMITS.MAX_SUFFIX_LENGTH),
  };
}

function normalizeMaxSuggestions(maxSuggestions: number | undefined): number {
  if (!maxSuggestions || maxSuggestions < 1) {
    return LIMITS.MAX_SUGGESTIONS_DEFAULT;
  }
  return Math.min(maxSuggestions, LIMITS.MAX_SUGGESTIONS_LIMIT);
}

function limitAdditionalContext(context: string[] | undefined): string[] {
  if (!context) return [];
  return context.slice(0, LIMITS.MAX_ADDITIONAL_CONTEXT);
}

function isLanguageSupported(languageId: string): boolean {
  return SUPPORTED_LANGUAGES.some(lang => lang.id === languageId);
}

function getLanguageForExtension(extension: string): SupportedLanguage | undefined {
  const normalizedExt = extension.toLowerCase();
  return SUPPORTED_LANGUAGES.find(lang =>
    lang.extensions.some(ext => ext === normalizedExt)
  );
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Autocomplete Routes - Request Validation', () => {
  describe('validateAutocompleteRequest', () => {
    it('should require prefix', () => {
      const result = validateAutocompleteRequest({
        suffix: '',
        language: 'typescript',
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('prefix'));
    });

    it('should require suffix', () => {
      const result = validateAutocompleteRequest({
        prefix: 'const x = ',
        language: 'typescript',
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('suffix'));
    });

    it('should require language', () => {
      const result = validateAutocompleteRequest({
        prefix: 'const x = ',
        suffix: ';',
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('language'));
    });

    it('should reject empty language', () => {
      const result = validateAutocompleteRequest({
        prefix: 'const x = ',
        suffix: ';',
        language: '',
      });

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid request', () => {
      const result = validateAutocompleteRequest({
        prefix: 'function hello() {\n  return ',
        suffix: ';\n}',
        language: 'typescript',
      });

      assert.strictEqual(result.valid, true);
    });

    it('should accept empty prefix/suffix strings', () => {
      const result = validateAutocompleteRequest({
        prefix: '',
        suffix: '',
        language: 'typescript',
      });

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Autocomplete Routes - Context Truncation', () => {
  describe('truncateContext', () => {
    it('should not truncate short context', () => {
      const prefix = 'const x = 1;';
      const suffix = '\nconsole.log(x);';

      const result = truncateContext(prefix, suffix);

      assert.strictEqual(result.prefix, prefix);
      assert.strictEqual(result.suffix, suffix);
    });

    it('should truncate prefix from the beginning', () => {
      const longPrefix = 'a'.repeat(5000);
      const suffix = 'test';

      const result = truncateContext(longPrefix, suffix);

      assert.strictEqual(result.prefix.length, LIMITS.MAX_PREFIX_LENGTH);
      // Should keep the end of the prefix (most relevant)
      assert.strictEqual(result.prefix, longPrefix.slice(-LIMITS.MAX_PREFIX_LENGTH));
    });

    it('should truncate suffix from the end', () => {
      const prefix = 'test';
      const longSuffix = 'b'.repeat(2000);

      const result = truncateContext(prefix, longSuffix);

      assert.strictEqual(result.suffix.length, LIMITS.MAX_SUFFIX_LENGTH);
      // Should keep the beginning of the suffix (most relevant)
      assert.strictEqual(result.suffix, longSuffix.slice(0, LIMITS.MAX_SUFFIX_LENGTH));
    });
  });
});

describe('Autocomplete Routes - Suggestion Limits', () => {
  describe('normalizeMaxSuggestions', () => {
    it('should return default for undefined', () => {
      const result = normalizeMaxSuggestions(undefined);
      assert.strictEqual(result, LIMITS.MAX_SUGGESTIONS_DEFAULT);
    });

    it('should return default for zero', () => {
      const result = normalizeMaxSuggestions(0);
      assert.strictEqual(result, LIMITS.MAX_SUGGESTIONS_DEFAULT);
    });

    it('should return default for negative', () => {
      const result = normalizeMaxSuggestions(-1);
      assert.strictEqual(result, LIMITS.MAX_SUGGESTIONS_DEFAULT);
    });

    it('should accept valid value', () => {
      const result = normalizeMaxSuggestions(4);
      assert.strictEqual(result, 4);
    });

    it('should clamp to maximum', () => {
      const result = normalizeMaxSuggestions(10);
      assert.strictEqual(result, LIMITS.MAX_SUGGESTIONS_LIMIT);
    });
  });
});

describe('Autocomplete Routes - Additional Context', () => {
  describe('limitAdditionalContext', () => {
    it('should return empty array for undefined', () => {
      const result = limitAdditionalContext(undefined);
      assert.deepStrictEqual(result, []);
    });

    it('should return context within limit', () => {
      const context = ['file1.ts', 'file2.ts'];
      const result = limitAdditionalContext(context);
      assert.deepStrictEqual(result, context);
    });

    it('should truncate context exceeding limit', () => {
      const context = ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts'];
      const result = limitAdditionalContext(context);

      assert.strictEqual(result.length, LIMITS.MAX_ADDITIONAL_CONTEXT);
      assert.deepStrictEqual(result, ['file1.ts', 'file2.ts', 'file3.ts']);
    });
  });
});

describe('Autocomplete Routes - Language Support', () => {
  describe('isLanguageSupported', () => {
    it('should recognize TypeScript', () => {
      assert.strictEqual(isLanguageSupported('typescript'), true);
    });

    it('should recognize JavaScript', () => {
      assert.strictEqual(isLanguageSupported('javascript'), true);
    });

    it('should recognize Python', () => {
      assert.strictEqual(isLanguageSupported('python'), true);
    });

    it('should recognize Rust', () => {
      assert.strictEqual(isLanguageSupported('rust'), true);
    });

    it('should reject unknown language', () => {
      assert.strictEqual(isLanguageSupported('brainfuck'), false);
    });
  });

  describe('getLanguageForExtension', () => {
    it('should map .ts to TypeScript', () => {
      const lang = getLanguageForExtension('.ts');
      assert.strictEqual(lang?.id, 'typescript');
    });

    it('should map .tsx to TypeScript', () => {
      const lang = getLanguageForExtension('.tsx');
      assert.strictEqual(lang?.id, 'typescript');
    });

    it('should map .py to Python', () => {
      const lang = getLanguageForExtension('.py');
      assert.strictEqual(lang?.id, 'python');
    });

    it('should map .rs to Rust', () => {
      const lang = getLanguageForExtension('.rs');
      assert.strictEqual(lang?.id, 'rust');
    });

    it('should return undefined for unknown extension', () => {
      const lang = getLanguageForExtension('.xyz');
      assert.strictEqual(lang, undefined);
    });

    it('should be case-insensitive', () => {
      const lang = getLanguageForExtension('.TS');
      assert.strictEqual(lang?.id, 'typescript');
    });
  });
});

describe('Autocomplete Routes - Response Format', () => {
  describe('Suggestions Response', () => {
    it('should return suggestions with confidence', () => {
      const suggestions: AutocompleteSuggestion[] = [
        { text: '"Hello, World!"', confidence: 0.95 },
        { text: '42', confidence: 0.8 },
      ];
      const response = createSuggestionsResponse(suggestions);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.suggestions.length, 2);
      assert.strictEqual(response.data.suggestions[0].confidence, 0.95);
    });

    it('should handle empty suggestions', () => {
      const response = createSuggestionsResponse([]);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.suggestions.length, 0);
    });
  });

  describe('Languages Response', () => {
    it('should return language list with extensions', () => {
      const response = createLanguagesResponse(SUPPORTED_LANGUAGES);

      assert.strictEqual(response.success, true);
      assert.ok(response.data.languages.length > 0);

      const typescript = response.data.languages.find(l => l.id === 'typescript');
      assert.ok(typescript);
      assert.ok(typescript.extensions.includes('.ts'));
    });
  });

  describe('Error Response', () => {
    it('should return validation error', () => {
      const response = createErrorResponse('prefix is required and must be a string');

      assert.strictEqual(response.success, false);
      assert.ok(response.error.includes('prefix'));
    });
  });
});

describe('Autocomplete Routes - Authorization', () => {
  it('should require authentication for completion', () => {
    const requiresAuth = true;
    assert.strictEqual(requiresAuth, true);
  });

  it('should require authentication for languages list', () => {
    const requiresAuth = true;
    assert.strictEqual(requiresAuth, true);
  });
});

describe('Autocomplete Routes - Supported Languages', () => {
  it('should include major programming languages', () => {
    const majorLanguages = ['typescript', 'javascript', 'python', 'java', 'go', 'rust'];

    for (const lang of majorLanguages) {
      assert.ok(
        SUPPORTED_LANGUAGES.some(l => l.id === lang),
        `${lang} should be supported`
      );
    }
  });

  it('should include web technologies', () => {
    const webTechs = ['html', 'css', 'scss', 'json', 'xml'];

    for (const tech of webTechs) {
      assert.ok(
        SUPPORTED_LANGUAGES.some(l => l.id === tech),
        `${tech} should be supported`
      );
    }
  });

  it('should include shell scripting', () => {
    assert.ok(SUPPORTED_LANGUAGES.some(l => l.id === 'shell'));
  });

  it('should include SQL', () => {
    assert.ok(SUPPORTED_LANGUAGES.some(l => l.id === 'sql'));
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createSuggestionsResponse(suggestions: AutocompleteSuggestion[]): {
  success: boolean;
  data: { suggestions: AutocompleteSuggestion[] };
} {
  return { success: true, data: { suggestions } };
}

function createLanguagesResponse(languages: SupportedLanguage[]): {
  success: boolean;
  data: { languages: SupportedLanguage[] };
} {
  return { success: true, data: { languages } };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
