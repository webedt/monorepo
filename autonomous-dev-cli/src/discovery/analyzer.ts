import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';
import { logger } from '../utils/logger.js';

export interface CodebaseAnalysis {
  structure: DirectoryEntry[];
  fileCount: number;
  todoComments: TodoComment[];
  recentChanges: string[];
  packages: PackageInfo[];
  configFiles: string[];
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: DirectoryEntry[];
}

export interface TodoComment {
  file: string;
  line: number;
  text: string;
  type: 'TODO' | 'FIXME' | 'HACK' | 'XXX';
}

export interface PackageInfo {
  name: string;
  path: string;
  dependencies: string[];
  scripts: Record<string, string>;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.turbo',
  '__pycache__',
]);

const IGNORED_FILES = new Set([
  '.DS_Store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.cs',
  '.cpp',
  '.c',
  '.h',
]);

const CONFIG_EXTENSIONS = new Set([
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.ini',
  '.env',
]);

export class CodebaseAnalyzer {
  private repoPath: string;
  private excludePaths: string[];

  constructor(repoPath: string, excludePaths: string[] = []) {
    this.repoPath = repoPath;
    this.excludePaths = excludePaths;
  }

  async analyze(): Promise<CodebaseAnalysis> {
    logger.info('Analyzing codebase...', { path: this.repoPath });

    const structure = this.scanDirectory(this.repoPath);
    const todoComments = await this.findTodoComments();
    const packages = await this.findPackages();
    const configFiles = this.findConfigFiles();

    const fileCount = this.countFiles(structure);

    logger.info(`Found ${fileCount} files, ${todoComments.length} TODOs, ${packages.length} packages`);

    return {
      structure,
      fileCount,
      todoComments,
      recentChanges: [], // Could integrate with git log
      packages,
      configFiles,
    };
  }

  private scanDirectory(dirPath: string, depth: number = 0): DirectoryEntry[] {
    if (depth > 5) {
      return []; // Limit recursion depth
    }

    const entries: DirectoryEntry[] = [];

    try {
      const items = readdirSync(dirPath);

      for (const item of items) {
        if (IGNORED_DIRS.has(item) || IGNORED_FILES.has(item)) {
          continue;
        }

        const fullPath = join(dirPath, item);
        const relativePath = relative(this.repoPath, fullPath);

        // Check exclude paths
        if (this.excludePaths.some((p) => relativePath.startsWith(p) || relativePath.match(p))) {
          continue;
        }

        try {
          const stat = statSync(fullPath);

          if (stat.isDirectory()) {
            entries.push({
              name: item,
              path: relativePath,
              type: 'directory',
              children: this.scanDirectory(fullPath, depth + 1),
            });
          } else if (stat.isFile()) {
            entries.push({
              name: item,
              path: relativePath,
              type: 'file',
            });
          }
        } catch {
          // Skip files we can't access
        }
      }
    } catch (error) {
      logger.warn(`Failed to scan directory: ${dirPath}`, { error });
    }

    return entries;
  }

  private countFiles(entries: DirectoryEntry[]): number {
    let count = 0;
    for (const entry of entries) {
      if (entry.type === 'file') {
        count++;
      } else if (entry.children) {
        count += this.countFiles(entry.children);
      }
    }
    return count;
  }

  private async findTodoComments(): Promise<TodoComment[]> {
    const todos: TodoComment[] = [];
    const todoPattern = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/gi;

    const scanFile = (filePath: string) => {
      const ext = extname(filePath);
      if (!CODE_EXTENSIONS.has(ext)) {
        return;
      }

      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const matches = line.matchAll(todoPattern);

          for (const match of matches) {
            todos.push({
              file: relative(this.repoPath, filePath),
              line: i + 1,
              text: match[2]?.trim() || '',
              type: match[1].toUpperCase() as 'TODO' | 'FIXME' | 'HACK' | 'XXX',
            });
          }
        }
      } catch {
        // Skip files we can't read
      }
    };

    const scanDir = (dirPath: string) => {
      try {
        const items = readdirSync(dirPath);

        for (const item of items) {
          if (IGNORED_DIRS.has(item)) {
            continue;
          }

          const fullPath = join(dirPath, item);

          try {
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
              scanDir(fullPath);
            } else if (stat.isFile()) {
              scanFile(fullPath);
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    scanDir(this.repoPath);

    return todos;
  }

  private async findPackages(): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = [];

    const findPackageJson = (dirPath: string) => {
      const packageJsonPath = join(dirPath, 'package.json');

      if (existsSync(packageJsonPath)) {
        try {
          const content = readFileSync(packageJsonPath, 'utf-8');
          const pkg = JSON.parse(content);

          packages.push({
            name: pkg.name || relative(this.repoPath, dirPath),
            path: relative(this.repoPath, dirPath) || '.',
            dependencies: Object.keys(pkg.dependencies || {}),
            scripts: pkg.scripts || {},
          });
        } catch {
          // Skip invalid package.json
        }
      }

      // Check subdirectories
      try {
        const items = readdirSync(dirPath);

        for (const item of items) {
          if (IGNORED_DIRS.has(item)) {
            continue;
          }

          const fullPath = join(dirPath, item);

          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              findPackageJson(fullPath);
            }
          } catch {
            // Skip inaccessible
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    findPackageJson(this.repoPath);

    return packages;
  }

  private findConfigFiles(): string[] {
    const configFiles: string[] = [];
    const configPatterns = [
      /^\..*rc$/,
      /^\..*rc\.js$/,
      /^\..*rc\.json$/,
      /\.config\.(js|ts|json|mjs|cjs)$/,
      /^tsconfig.*\.json$/,
      /^package\.json$/,
      /^docker-compose.*\.ya?ml$/,
      /^Dockerfile$/,
      /^\.github/,
    ];

    const scanDir = (dirPath: string, depth: number = 0) => {
      if (depth > 2) return; // Only top-level config files

      try {
        const items = readdirSync(dirPath);

        for (const item of items) {
          if (IGNORED_DIRS.has(item)) {
            continue;
          }

          const fullPath = join(dirPath, item);
          const relativePath = relative(this.repoPath, fullPath);

          try {
            const stat = statSync(fullPath);

            if (stat.isFile()) {
              const isConfig = configPatterns.some((pattern) => pattern.test(item));
              if (isConfig) {
                configFiles.push(relativePath);
              }
            } else if (stat.isDirectory() && item === '.github') {
              // Include .github directory
              configFiles.push(relativePath);
            }
          } catch {
            // Skip inaccessible
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    scanDir(this.repoPath);

    return configFiles;
  }

  // Generate a summary suitable for Claude
  generateSummary(analysis: CodebaseAnalysis): string {
    const lines: string[] = [];

    lines.push('## Codebase Structure\n');

    // Package overview
    if (analysis.packages.length > 0) {
      lines.push('### Packages\n');
      for (const pkg of analysis.packages) {
        lines.push(`- **${pkg.name}** (${pkg.path})`);
        if (Object.keys(pkg.scripts).length > 0) {
          const scriptNames = Object.keys(pkg.scripts).slice(0, 5).join(', ');
          lines.push(`  - Scripts: ${scriptNames}${Object.keys(pkg.scripts).length > 5 ? '...' : ''}`);
        }
      }
      lines.push('');
    }

    // Directory structure (top-level only)
    lines.push('### Top-Level Structure\n');
    for (const entry of analysis.structure) {
      const icon = entry.type === 'directory' ? '📁' : '📄';
      lines.push(`- ${icon} ${entry.name}`);
    }
    lines.push('');

    // Config files
    if (analysis.configFiles.length > 0) {
      lines.push('### Configuration Files\n');
      for (const file of analysis.configFiles.slice(0, 10)) {
        lines.push(`- ${file}`);
      }
      if (analysis.configFiles.length > 10) {
        lines.push(`- ... and ${analysis.configFiles.length - 10} more`);
      }
      lines.push('');
    }

    // TODOs
    if (analysis.todoComments.length > 0) {
      lines.push('### TODO Comments\n');
      const byType: Record<string, TodoComment[]> = {};
      for (const todo of analysis.todoComments) {
        if (!byType[todo.type]) {
          byType[todo.type] = [];
        }
        byType[todo.type].push(todo);
      }

      for (const [type, todos] of Object.entries(byType)) {
        lines.push(`\n**${type}** (${todos.length}):`);
        for (const todo of todos.slice(0, 5)) {
          lines.push(`- ${todo.file}:${todo.line}: ${todo.text}`);
        }
        if (todos.length > 5) {
          lines.push(`- ... and ${todos.length - 5} more`);
        }
      }
      lines.push('');
    }

    lines.push(`\n**Total Files:** ${analysis.fileCount}`);

    return lines.join('\n');
  }
}
