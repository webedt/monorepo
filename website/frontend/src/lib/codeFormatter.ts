/**
 * Code Formatter Utility
 * Provides code formatting for common file types
 *
 * Known Limitations:
 * - JavaScript/TypeScript: String detection doesn't handle escaped quotes (e.g., 'it\'s')
 * - JavaScript/TypeScript: Template literal detection is simplified and may not handle
 *   escaped backticks or complex nested expressions correctly
 * - HTML: Self-closing tag detection may not work with all XML-style tags
 * - These formatters provide basic indentation normalization, not full code reformatting
 */

export type FormatLanguage = 'javascript' | 'typescript' | 'json' | 'css' | 'html' | 'markdown' | 'unknown';

export interface FormatOptions {
  tabSize: number;
  useTabs: boolean;
}

export interface FormatResult {
  success: boolean;
  content: string;
  error?: string;
}

const DEFAULT_OPTIONS: FormatOptions = {
  tabSize: 2,
  useTabs: false,
};

function getIndent(options: FormatOptions): string {
  return options.useTabs ? '\t' : ' '.repeat(options.tabSize);
}

function formatJSON(content: string, options: FormatOptions): FormatResult {
  try {
    const parsed = JSON.parse(content);
    const indent = options.useTabs ? '\t' : options.tabSize;
    const formatted = JSON.stringify(parsed, null, indent);
    return { success: true, content: formatted };
  } catch (error) {
    return {
      success: false,
      content,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

function formatJavaScript(content: string, options: FormatOptions): FormatResult {
  const indent = getIndent(options);
  const lines = content.split('\n');
  const formattedLines: string[] = [];
  let indentLevel = 0;
  let inMultiLineComment = false;
  let inTemplateLiteral = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();

    // Skip empty lines but preserve them
    if (trimmedLine === '') {
      formattedLines.push('');
      continue;
    }

    // Track multi-line comments
    if (inMultiLineComment) {
      formattedLines.push(indent.repeat(indentLevel) + trimmedLine);
      if (trimmedLine.includes('*/')) {
        inMultiLineComment = false;
      }
      continue;
    }

    if (trimmedLine.startsWith('/*') && !trimmedLine.includes('*/')) {
      inMultiLineComment = true;
      formattedLines.push(indent.repeat(indentLevel) + trimmedLine);
      continue;
    }

    // Track template literals (simplified)
    const backtickCount = (trimmedLine.match(/`/g) || []).length;
    if (backtickCount % 2 === 1) {
      inTemplateLiteral = !inTemplateLiteral;
    }

    // If inside template literal, preserve original indentation relative to current level
    if (inTemplateLiteral && backtickCount === 0) {
      formattedLines.push(indent.repeat(indentLevel) + trimmedLine);
      continue;
    }

    // Count brackets to determine indent changes (excluding strings and comments)
    const lineWithoutStrings = trimmedLine
      .replace(/'[^']*'/g, '')
      .replace(/"[^"]*"/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/\/\/.*$/, '')
      .replace(/\/\*.*?\*\//g, '');

    const openBrackets = (lineWithoutStrings.match(/[{[(]/g) || []).length;
    const closeBrackets = (lineWithoutStrings.match(/[}\])]/g) || []).length;

    // Decrease indent if line starts with closing bracket
    if (/^[}\])]/.test(trimmedLine)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // Add the formatted line
    formattedLines.push(indent.repeat(indentLevel) + trimmedLine);

    // Adjust indent for next line
    indentLevel += openBrackets - closeBrackets;
    indentLevel = Math.max(0, indentLevel);

    // Handle case statements
    if (/^case\s+.*:|^default:/.test(trimmedLine) && !trimmedLine.includes('{')) {
      indentLevel++;
    }
    if (/^break;$|^return\s+.*;$/.test(trimmedLine)) {
      const prevLine = formattedLines[formattedLines.length - 2]?.trim() || '';
      if (/^case\s+.*:|^default:/.test(prevLine)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }
    }
  }

  // Normalize trailing newline
  let result = formattedLines.join('\n');
  if (!result.endsWith('\n')) {
    result += '\n';
  }

  return { success: true, content: result };
}

function formatCSS(content: string, options: FormatOptions): FormatResult {
  const indent = getIndent(options);
  const lines = content.split('\n');
  const formattedLines: string[] = [];
  let indentLevel = 0;
  let inComment = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === '') {
      formattedLines.push('');
      continue;
    }

    // Handle multi-line comments
    if (inComment) {
      formattedLines.push(indent.repeat(indentLevel) + trimmedLine);
      if (trimmedLine.includes('*/')) {
        inComment = false;
      }
      continue;
    }

    if (trimmedLine.startsWith('/*') && !trimmedLine.includes('*/')) {
      inComment = true;
      formattedLines.push(indent.repeat(indentLevel) + trimmedLine);
      continue;
    }

    // Handle closing braces
    if (trimmedLine.startsWith('}')) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    formattedLines.push(indent.repeat(indentLevel) + trimmedLine);

    // Handle opening braces
    if (trimmedLine.endsWith('{')) {
      indentLevel++;
    }
  }

  let result = formattedLines.join('\n');
  if (!result.endsWith('\n')) {
    result += '\n';
  }

  return { success: true, content: result };
}

function formatHTML(content: string, options: FormatOptions): FormatResult {
  const indent = getIndent(options);

  // Simple HTML formatting: normalize whitespace and indent
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);

  const lines = content.split('\n');
  const formattedLines: string[] = [];
  let indentLevel = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === '') {
      formattedLines.push('');
      continue;
    }

    // Check for closing tags at the start
    const startsWithClosing = /^<\//.test(trimmedLine);
    if (startsWithClosing) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    formattedLines.push(indent.repeat(indentLevel) + trimmedLine);

    // Count opening and closing tags (exclude self-closing tags ending with />)
    const openingTags = trimmedLine.match(/<([a-zA-Z][a-zA-Z0-9-]*)[^>]*(?<!\/)>/g) || [];
    const closingTags = trimmedLine.match(/<\/([a-zA-Z][a-zA-Z0-9-]*)>/g) || [];

    // Adjust for self-closing and void elements
    for (const tag of openingTags) {
      const tagName = tag.match(/<([a-zA-Z][a-zA-Z0-9-]*)/)?.[1]?.toLowerCase();
      if (tagName && !voidElements.has(tagName) && !tag.endsWith('/>')) {
        indentLevel++;
      }
    }

    // Decrease for closing tags (not already handled)
    if (!startsWithClosing) {
      indentLevel -= closingTags.length;
      indentLevel = Math.max(0, indentLevel);
    }
  }

  let result = formattedLines.join('\n');
  if (!result.endsWith('\n')) {
    result += '\n';
  }

  return { success: true, content: result };
}

export function getLanguageFromExtension(filename: string): FormatLanguage {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const languageMap: Record<string, FormatLanguage> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'mts': 'typescript',
    'cts': 'typescript',
    'json': 'json',
    'css': 'css',
    'scss': 'css',
    'less': 'css',
    'html': 'html',
    'htm': 'html',
    'xml': 'html',
    'svg': 'html',
    'md': 'markdown',
    'markdown': 'markdown',
  };

  return languageMap[ext] || 'unknown';
}

export function formatCode(
  content: string,
  language: FormatLanguage,
  options: Partial<FormatOptions> = {}
): FormatResult {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  switch (language) {
    case 'json':
      return formatJSON(content, mergedOptions);

    case 'javascript':
    case 'typescript':
      return formatJavaScript(content, mergedOptions);

    case 'css':
      return formatCSS(content, mergedOptions);

    case 'html':
      return formatHTML(content, mergedOptions);

    case 'markdown':
      // Markdown doesn't need formatting, just normalize trailing newline
      let result = content;
      if (!result.endsWith('\n')) {
        result += '\n';
      }
      return { success: true, content: result };

    default:
      return {
        success: false,
        content,
        error: `Formatting not supported for language: ${language}`,
      };
  }
}

export function formatByFilename(
  content: string,
  filename: string,
  options: Partial<FormatOptions> = {}
): FormatResult {
  const language = getLanguageFromExtension(filename);
  return formatCode(content, language, options);
}

export function canFormat(filename: string): boolean {
  const language = getLanguageFromExtension(filename);
  return language !== 'unknown';
}
