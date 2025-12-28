import hljs from 'highlight.js/lib/core';

import type { HighlightResult } from 'highlight.js';

// Import commonly used languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import scala from 'highlight.js/lib/languages/scala';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import graphql from 'highlight.js/lib/languages/graphql';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('svg', xml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('zsh', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('go', go);
hljs.registerLanguage('golang', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c++', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('kt', kotlin);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('patch', diff);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('docker', dockerfile);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('gql', graphql);

// Language name normalization for display
const languageDisplayNames: Record<string, string> = {
  js: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  ts: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  json: 'JSON',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  xml: 'XML',
  svg: 'SVG',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Zsh',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown',
  sql: 'SQL',
  go: 'Go',
  golang: 'Go',
  rust: 'Rust',
  rs: 'Rust',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  csharp: 'C#',
  cs: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  rb: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  kt: 'Kotlin',
  scala: 'Scala',
  diff: 'Diff',
  patch: 'Patch',
  dockerfile: 'Dockerfile',
  docker: 'Dockerfile',
  graphql: 'GraphQL',
  gql: 'GraphQL',
};

// Maximum size (in characters) for syntax highlighting
// Larger files skip highlighting to prevent UI lag
const MAX_HIGHLIGHT_SIZE = 100000; // 100KB

/**
 * Highlight code with syntax highlighting
 * @param code The code to highlight
 * @param language Optional language identifier
 * @returns Highlighted HTML string
 */
export function highlightCode(code: string, language?: string): string {
  if (!code) return '';

  // Skip highlighting for very large content to prevent UI lag
  if (code.length > MAX_HIGHLIGHT_SIZE) {
    return escapeHtml(code);
  }

  try {
    let result: HighlightResult;

    if (language && hljs.getLanguage(language.toLowerCase())) {
      result = hljs.highlight(code, { language: language.toLowerCase() });
    } else {
      // Auto-detect language
      result = hljs.highlightAuto(code);
    }

    return result.value;
  } catch {
    // Return escaped code on error
    return escapeHtml(code);
  }
}

/**
 * Get the display name for a language
 */
export function getLanguageDisplayName(lang: string): string {
  return languageDisplayNames[lang.toLowerCase()] || lang.toUpperCase();
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(lang: string): boolean {
  return !!hljs.getLanguage(lang.toLowerCase());
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Get file extension to language mapping
 */
export function getLanguageFromExtension(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;

  const extensionMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    // Python
    py: 'python',
    pyw: 'python',
    // Data formats
    json: 'json',
    jsonc: 'json',
    // Stylesheets
    css: 'css',
    scss: 'css',
    less: 'css',
    // Markup
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    xhtml: 'xml',
    // Shell
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    // Config files
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'yaml',
    ini: 'bash',
    conf: 'bash',
    env: 'bash',
    // Documentation
    md: 'markdown',
    markdown: 'markdown',
    // Database
    sql: 'sql',
    // Systems languages
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hxx: 'cpp',
    cs: 'csharp',
    // Scripting languages
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    // Container/DevOps
    graphql: 'graphql',
    gql: 'graphql',
    // Lock files and other common formats
    lock: 'json',
  };

  return extensionMap[ext];
}

export { hljs };
