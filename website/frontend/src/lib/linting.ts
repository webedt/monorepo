/**
 * Linting Service
 * Provides real-time linting for code files with debounced analysis
 */

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity: LintSeverity;
  rule?: string;
  source?: string;
}

export interface LintResult {
  diagnostics: LintDiagnostic[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export type LinterFunction = (code: string, filename: string) => LintDiagnostic[];
export type LintCallback = (result: LintResult) => void;

// Debounced lint callback type
type DebouncedLintFn = (code: string, filename: string, callback: LintCallback) => void;

/**
 * JavaScript/TypeScript Linter
 * Performs basic static analysis without a full parser
 */
function lintJavaScript(code: string, _filename: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = code.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // Check for console statements
    const consoleMatch = line.match(/console\.(log|warn|error|info|debug|trace)\s*\(/);
    if (consoleMatch) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(consoleMatch[0]) + 1,
        message: `Unexpected console.${consoleMatch[1]} statement`,
        severity: 'warning',
        rule: 'no-console',
        source: 'linter',
      });
    }

    // Check for debugger statements
    if (/\bdebugger\b/.test(trimmed)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('debugger') + 1,
        message: 'Unexpected debugger statement',
        severity: 'error',
        rule: 'no-debugger',
        source: 'linter',
      });
    }

    // Check for var usage (prefer let/const)
    const varMatch = line.match(/\bvar\s+/);
    if (varMatch && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(varMatch[0]) + 1,
        message: "Unexpected var, use 'let' or 'const' instead",
        severity: 'warning',
        rule: 'no-var',
        source: 'linter',
      });
    }

    // Check for == or != (prefer === or !==)
    const eqMatch = line.match(/[^=!<>]==[^=]|[^=!]!=[^=]/);
    if (eqMatch && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const isDoubleEqual = eqMatch[0].includes('==');
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(eqMatch[0]) + 2,
        message: `Use '${isDoubleEqual ? '===' : '!=='}' instead of '${isDoubleEqual ? '==' : '!='}'`,
        severity: 'warning',
        rule: 'eqeqeq',
        source: 'linter',
      });
    }

    // Check for trailing whitespace
    if (line.endsWith(' ') || line.endsWith('\t')) {
      diagnostics.push({
        line: lineNum,
        column: line.length,
        message: 'Trailing whitespace',
        severity: 'info',
        rule: 'no-trailing-spaces',
        source: 'linter',
      });
    }

    // Check for TODO/FIXME comments
    const todoMatch = line.match(/\/\/\s*(TODO|FIXME|XXX|HACK)[\s:]/i);
    if (todoMatch) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(todoMatch[0]) + 1,
        message: `${todoMatch[1].toUpperCase()} comment found`,
        severity: 'info',
        rule: 'no-warning-comments',
        source: 'linter',
      });
    }

    // Check for empty catch blocks
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('catch') + 1,
        message: 'Empty catch block',
        severity: 'warning',
        rule: 'no-empty',
        source: 'linter',
      });
    }

    // Check for alert/confirm/prompt
    const alertMatch = line.match(/\b(alert|confirm|prompt)\s*\(/);
    if (alertMatch && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(alertMatch[0]) + 1,
        message: `Unexpected ${alertMatch[1]}`,
        severity: 'warning',
        rule: 'no-alert',
        source: 'linter',
      });
    }

    // Check for very long lines
    if (line.length > 120) {
      diagnostics.push({
        line: lineNum,
        column: 121,
        message: `Line too long (${line.length} > 120 characters)`,
        severity: 'info',
        rule: 'max-len',
        source: 'linter',
      });
    }
  });

  return diagnostics;
}

/**
 * JSON Linter
 * Validates JSON syntax
 */
function lintJSON(code: string, _filename: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  try {
    JSON.parse(code);
  } catch (error) {
    if (error instanceof SyntaxError) {
      // Try to extract line and column from error message
      const match = error.message.match(/position (\d+)/);
      let line = 1;
      let column = 1;

      if (match) {
        const position = parseInt(match[1], 10);
        const beforePosition = code.substring(0, position);
        const lines = beforePosition.split('\n');
        line = lines.length;
        column = (lines[lines.length - 1]?.length || 0) + 1;
      }

      diagnostics.push({
        line,
        column,
        message: `JSON syntax error: ${error.message}`,
        severity: 'error',
        rule: 'json-parse',
        source: 'linter',
      });
    }
  }

  // Additional JSON-specific checks
  const lines = code.split('\n');
  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Check for trailing commas (invalid in JSON)
    if (/,\s*[}\]]/.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(',') + 1,
        message: 'Trailing comma in JSON',
        severity: 'error',
        rule: 'json-trailing-comma',
        source: 'linter',
      });
    }

    // Check for single quotes (should be double quotes in JSON)
    if (/'[^']*'\s*:/.test(line) || /:\s*'[^']*'/.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf("'") + 1,
        message: 'JSON requires double quotes, not single quotes',
        severity: 'error',
        rule: 'json-quotes',
        source: 'linter',
      });
    }
  });

  return diagnostics;
}

/**
 * CSS Linter
 * Basic CSS validation
 */
function lintCSS(code: string, _filename: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = code.split('\n');

  let braceDepth = 0;
  let inComment = false;

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Handle multi-line comments
    if (line.includes('/*')) inComment = true;
    if (line.includes('*/')) inComment = false;
    if (inComment) return;

    const trimmed = line.trim();

    // Track brace depth
    for (const char of line) {
      if (char === '{') braceDepth++;
      if (char === '}') braceDepth--;
    }

    // Check for !important
    if (/!important/i.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('!important') + 1,
        message: 'Avoid using !important',
        severity: 'warning',
        rule: 'no-important',
        source: 'linter',
      });
    }

    // Check for ID selectors
    if (/#[a-zA-Z][\w-]*\s*\{/.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('#') + 1,
        message: 'Avoid ID selectors for styling',
        severity: 'info',
        rule: 'no-id-selectors',
        source: 'linter',
      });
    }

    // Check for vendor prefixes (suggest using autoprefixer)
    const vendorMatch = line.match(/-(webkit|moz|ms|o)-/);
    if (vendorMatch) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(vendorMatch[0]) + 1,
        message: 'Consider using autoprefixer instead of vendor prefixes',
        severity: 'info',
        rule: 'no-vendor-prefixes',
        source: 'linter',
      });
    }

    // Check for empty rules
    if (/\{\s*\}/.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('{') + 1,
        message: 'Empty rule block',
        severity: 'warning',
        rule: 'no-empty-rules',
        source: 'linter',
      });
    }

    // Check for duplicate properties in same line (basic check)
    const propertyMatches = trimmed.match(/[\w-]+\s*:/g);
    if (propertyMatches) {
      const seen = new Set<string>();
      for (const prop of propertyMatches) {
        const propName = prop.replace(/\s*:$/, '');
        if (seen.has(propName)) {
          diagnostics.push({
            line: lineNum,
            column: line.lastIndexOf(prop) + 1,
            message: `Duplicate property '${propName}'`,
            severity: 'warning',
            rule: 'no-duplicate-properties',
            source: 'linter',
          });
        }
        seen.add(propName);
      }
    }
  });

  // Check for unclosed braces
  if (braceDepth !== 0) {
    diagnostics.push({
      line: lines.length,
      column: 1,
      message: braceDepth > 0 ? 'Unclosed brace' : 'Extra closing brace',
      severity: 'error',
      rule: 'brace-matching',
      source: 'linter',
    });
  }

  return diagnostics;
}

/**
 * HTML Linter
 * Basic HTML validation
 */
function lintHTML(code: string, _filename: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = code.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Check for missing alt attribute on images
    if (/<img\s[^>]*(?!alt=)[^>]*>/i.test(line) && !/<img[^>]*alt=/i.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('<img') + 1,
        message: "Image missing 'alt' attribute",
        severity: 'warning',
        rule: 'img-alt',
        source: 'linter',
      });
    }

    // Check for inline styles
    if (/style\s*=\s*["'][^"']+["']/i.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('style=') + 1,
        message: 'Avoid inline styles',
        severity: 'info',
        rule: 'no-inline-styles',
        source: 'linter',
      });
    }

    // Check for deprecated tags
    const deprecatedTags = ['font', 'center', 'marquee', 'blink', 'strike', 'big', 'tt'];
    for (const tag of deprecatedTags) {
      const regex = new RegExp(`<${tag}\\b`, 'i');
      if (regex.test(line)) {
        diagnostics.push({
          line: lineNum,
          column: line.indexOf(`<${tag}`) + 1,
          message: `Deprecated HTML tag <${tag}>`,
          severity: 'warning',
          rule: 'no-deprecated-tags',
          source: 'linter',
        });
      }
    }

    // Check for missing doctype
    if (lineNum === 1 && /<html/i.test(line) && !code.toLowerCase().includes('<!doctype')) {
      diagnostics.push({
        line: 1,
        column: 1,
        message: 'Missing DOCTYPE declaration',
        severity: 'warning',
        rule: 'doctype-first',
        source: 'linter',
      });
    }
  });

  return diagnostics;
}

/**
 * Python Linter
 * Basic Python style checking
 */
function lintPython(code: string, _filename: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = code.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trimStart();

    // Check for print statements (Python 2 style)
    if (/^print\s+[^(]/.test(trimmed)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('print') + 1,
        message: "Use print() function instead of print statement",
        severity: 'error',
        rule: 'print-function',
        source: 'linter',
      });
    }

    // Check for tabs (PEP 8 recommends spaces)
    if (line.startsWith('\t')) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        message: 'Use spaces instead of tabs for indentation',
        severity: 'warning',
        rule: 'no-tabs',
        source: 'linter',
      });
    }

    // Check for line length (PEP 8 recommends 79 or 99)
    if (line.length > 99) {
      diagnostics.push({
        line: lineNum,
        column: 100,
        message: `Line too long (${line.length} > 99 characters)`,
        severity: 'info',
        rule: 'max-line-length',
        source: 'linter',
      });
    }

    // Check for TODO/FIXME
    const todoMatch = line.match(/#\s*(TODO|FIXME|XXX|HACK)[\s:]/i);
    if (todoMatch) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(todoMatch[0]) + 1,
        message: `${todoMatch[1].toUpperCase()} comment found`,
        severity: 'info',
        rule: 'no-warning-comments',
        source: 'linter',
      });
    }

    // Check for bare except
    if (/^\s*except\s*:/.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('except') + 1,
        message: 'Bare except clause, specify an exception type',
        severity: 'warning',
        rule: 'bare-except',
        source: 'linter',
      });
    }

    // Check for mutable default arguments
    const defaultArgMatch = line.match(/def\s+\w+\s*\([^)]*=\s*(\[\]|\{\}|\set\(\))/);
    if (defaultArgMatch) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(defaultArgMatch[1]) + 1,
        message: 'Mutable default argument detected',
        severity: 'warning',
        rule: 'mutable-default-arg',
        source: 'linter',
      });
    }

    // Check for == None (should use 'is None')
    if (/==\s*None\b/.test(line)) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('== None') + 1,
        message: "Use 'is None' instead of '== None'",
        severity: 'warning',
        rule: 'compare-to-none',
        source: 'linter',
      });
    }
  });

  return diagnostics;
}

/**
 * Markdown Linter
 * Basic Markdown style checking
 */
function lintMarkdown(code: string, _filename: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = code.split('\n');

  let lastHeadingLevel = 0;

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Check for heading level jumps
    const headingMatch = line.match(/^(#{1,6})\s/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
        diagnostics.push({
          line: lineNum,
          column: 1,
          message: `Heading level jumped from h${lastHeadingLevel} to h${level}`,
          severity: 'warning',
          rule: 'heading-increment',
          source: 'linter',
        });
      }
      lastHeadingLevel = level;
    }

    // Check for trailing whitespace
    if (line.endsWith(' ') && !line.endsWith('  ')) {
      diagnostics.push({
        line: lineNum,
        column: line.length,
        message: 'Trailing whitespace (use double space for line break or remove)',
        severity: 'info',
        rule: 'no-trailing-spaces',
        source: 'linter',
      });
    }

    // Check for bare URLs (should be linked)
    const urlMatch = line.match(/(?<!\(|<)https?:\/\/\S+(?!\)|>)/);
    if (urlMatch && !line.startsWith('[') && !line.includes('](')) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf(urlMatch[0]) + 1,
        message: 'Bare URL detected, consider using a link',
        severity: 'info',
        rule: 'no-bare-urls',
        source: 'linter',
      });
    }

    // Check for multiple blank lines
    if (index > 0 && line === '' && lines[index - 1] === '' && (lines[index - 2] === '' || index === 1)) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        message: 'Multiple consecutive blank lines',
        severity: 'info',
        rule: 'no-multiple-blanks',
        source: 'linter',
      });
    }
  });

  return diagnostics;
}

/**
 * YAML Linter
 * Basic YAML validation
 */
function lintYAML(code: string, _filename: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = code.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) return;

    const currentIndent = line.search(/\S/);

    // Check for tabs
    if (line.includes('\t')) {
      diagnostics.push({
        line: lineNum,
        column: line.indexOf('\t') + 1,
        message: 'Use spaces instead of tabs in YAML',
        severity: 'error',
        rule: 'no-tabs',
        source: 'linter',
      });
    }

    // Check for inconsistent indentation
    if (currentIndent > 0 && currentIndent % 2 !== 0) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        message: 'Odd number of spaces for indentation (use 2 spaces)',
        severity: 'warning',
        rule: 'indent',
        source: 'linter',
      });
    }

    // Check for trailing whitespace
    if (line.endsWith(' ') || line.endsWith('\t')) {
      diagnostics.push({
        line: lineNum,
        column: line.length,
        message: 'Trailing whitespace',
        severity: 'info',
        rule: 'no-trailing-spaces',
        source: 'linter',
      });
    }

    // Basic key validation (future: could check for duplicate keys with more context)
    // const keyMatch = line.match(/^\s*([\w.-]+)\s*:/);
  });

  return diagnostics;
}

// Map file extensions to linters
const LINTER_MAP: Record<string, LinterFunction> = {
  // JavaScript/TypeScript
  'js': lintJavaScript,
  'jsx': lintJavaScript,
  'ts': lintJavaScript,
  'tsx': lintJavaScript,
  'mjs': lintJavaScript,
  'cjs': lintJavaScript,
  // JSON
  'json': lintJSON,
  'jsonc': lintJSON,
  // CSS
  'css': lintCSS,
  'scss': lintCSS,
  'less': lintCSS,
  // HTML
  'html': lintHTML,
  'htm': lintHTML,
  // Python
  'py': lintPython,
  'pyw': lintPython,
  // Markdown
  'md': lintMarkdown,
  'markdown': lintMarkdown,
  // YAML
  'yml': lintYAML,
  'yaml': lintYAML,
};

/**
 * Get file extension from filename
 */
function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Lint code and return diagnostics
 */
export function lintCode(code: string, filename: string): LintResult {
  const ext = getExtension(filename);
  const linter = LINTER_MAP[ext];

  if (!linter) {
    return {
      diagnostics: [],
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
    };
  }

  const diagnostics = linter(code, filename);

  // Sort by line number, then by severity
  const severityOrder: Record<LintSeverity, number> = {
    'error': 0,
    'warning': 1,
    'info': 2,
  };

  diagnostics.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  return {
    diagnostics,
    errorCount: diagnostics.filter(d => d.severity === 'error').length,
    warningCount: diagnostics.filter(d => d.severity === 'warning').length,
    infoCount: diagnostics.filter(d => d.severity === 'info').length,
  };
}

/**
 * Check if a file type is supported for linting
 */
export function isLintable(filename: string): boolean {
  const ext = getExtension(filename);
  return ext in LINTER_MAP;
}

/**
 * Get supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(LINTER_MAP);
}

/**
 * LintingService class for managing real-time linting
 */
export class LintingService {
  private debouncedLint: DebouncedLintFn;
  private lastResult: LintResult | null = null;
  private enabled = true;
  private debounceMs: number;

  constructor(debounceMs = 300) {
    this.debounceMs = debounceMs;
    this.debouncedLint = this.createDebouncedLintFn();
  }

  private createDebouncedLintFn(): DebouncedLintFn {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return (code: string, filename: string, callback: LintCallback) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        if (!this.enabled) {
          callback({
            diagnostics: [],
            errorCount: 0,
            warningCount: 0,
            infoCount: 0,
          });
          return;
        }

        const result = lintCode(code, filename);
        this.lastResult = result;
        callback(result);
        timeoutId = null;
      }, this.debounceMs);
    };
  }

  /**
   * Lint code with debouncing
   */
  lint(code: string, filename: string, callback: LintCallback): void {
    if (!isLintable(filename)) {
      callback({
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
      });
      return;
    }

    this.debouncedLint(code, filename, callback);
  }

  /**
   * Lint code immediately without debouncing
   */
  lintImmediate(code: string, filename: string): LintResult {
    if (!isLintable(filename)) {
      return {
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
      };
    }

    const result = lintCode(code, filename);
    this.lastResult = result;
    return result;
  }

  /**
   * Get the last lint result
   */
  getLastResult(): LintResult | null {
    return this.lastResult;
  }

  /**
   * Enable or disable linting
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if linting is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Clear the last result
   */
  clear(): void {
    this.lastResult = null;
  }
}

// Export singleton instance
export const lintingService = new LintingService();
