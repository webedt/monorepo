import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Truncate a session name if it exceeds the maximum length
 * @param name The session name to truncate
 * @param maxLength Maximum length before truncation (default: 80)
 * @returns Truncated name with ellipsis if needed
 */
export function truncateSessionName(name: string, maxLength: number = 80): string {
  if (!name || name.length <= maxLength) {
    return name;
  }
  return name.substring(0, maxLength - 3) + '...';
}

/**
 * Map file extensions to syntax highlighting language identifiers
 * Used by react-syntax-highlighter for proper code highlighting
 */
const extensionToLanguageMap: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mjs: 'javascript',
  cjs: 'javascript',

  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',

  // Data formats
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  csv: 'csv',

  // Markup
  md: 'markdown',
  mdx: 'markdown',

  // Python
  py: 'python',
  pyw: 'python',
  pyx: 'python',

  // Systems programming
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',

  // JVM languages
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  groovy: 'groovy',

  // .NET
  cs: 'csharp',
  fs: 'fsharp',
  vb: 'vbnet',

  // Ruby
  rb: 'ruby',
  erb: 'erb',

  // PHP
  php: 'php',

  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'batch',
  cmd: 'batch',

  // Database
  sql: 'sql',
  mysql: 'sql',
  pgsql: 'sql',
  plsql: 'sql',

  // Config files
  dockerfile: 'dockerfile',
  gitignore: 'bash',
  env: 'bash',
  ini: 'ini',
  conf: 'nginx',
  nginx: 'nginx',

  // Mobile
  swift: 'swift',
  m: 'objectivec',
  mm: 'objectivec',
  dart: 'dart',

  // Other languages
  lua: 'lua',
  r: 'r',
  R: 'r',
  pl: 'perl',
  pm: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  hs: 'haskell',
  lhs: 'haskell',
  clj: 'clojure',
  cljs: 'clojure',
  lisp: 'lisp',
  el: 'lisp',
  vim: 'vim',

  // GraphQL
  graphql: 'graphql',
  gql: 'graphql',

  // Web frameworks
  vue: 'vue',
  svelte: 'svelte',

  // Misc
  makefile: 'makefile',
  cmake: 'cmake',
  tf: 'hcl',
  hcl: 'hcl',
  proto: 'protobuf',
  asm: 'nasm',
  s: 'nasm',
  diff: 'diff',
  patch: 'diff',
};

/**
 * Get the syntax highlighting language for a given filename
 * @param filename The filename or path to get the language for
 * @returns The language identifier for syntax highlighting, or 'text' if unknown
 */
export function getLanguageFromFilename(filename: string): string {
  if (!filename) return 'text';

  // Get just the filename without path
  const name = filename.split('/').pop() || filename;

  // Handle special filenames (case-insensitive for some)
  const lowerName = name.toLowerCase();
  if (lowerName === 'dockerfile') return 'dockerfile';
  if (lowerName === 'makefile' || lowerName === 'gnumakefile') return 'makefile';
  if (lowerName === 'cmakelists.txt') return 'cmake';
  if (lowerName.startsWith('.env')) return 'bash';
  if (lowerName === '.gitignore' || lowerName === '.dockerignore') return 'bash';

  // Get extension
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return 'text';

  return extensionToLanguageMap[ext] || 'text';
}
