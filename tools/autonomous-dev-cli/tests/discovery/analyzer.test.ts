import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { CodebaseAnalyzer, type AnalyzerConfig, type CodebaseAnalysis, type ValidationResult } from '../../src/discovery/analyzer.js';
import { AnalyzerError, ErrorCode } from '../../src/utils/errors.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CodebaseAnalyzer', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory with sample structure
    testDir = join(tmpdir(), `analyzer-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create analyzer with default config', () => {
      const analyzer = new CodebaseAnalyzer(testDir);
      assert.ok(analyzer);
    });

    it('should accept custom exclude paths', () => {
      const excludePaths = ['node_modules', 'dist', 'build'];
      const analyzer = new CodebaseAnalyzer(testDir, excludePaths);
      assert.ok(analyzer);
    });

    it('should accept custom config', () => {
      const config: AnalyzerConfig = {
        maxDepth: 5,
        maxFiles: 1000,
      };
      const analyzer = new CodebaseAnalyzer(testDir, [], config);
      assert.ok(analyzer);
    });

    it('should clamp maxDepth to valid range', () => {
      const config: AnalyzerConfig = {
        maxDepth: 100, // Exceeds max of 20
      };
      const analyzer = new CodebaseAnalyzer(testDir, [], config);
      // Should not throw, value should be clamped internally
      assert.ok(analyzer);
    });

    it('should clamp maxFiles to valid range', () => {
      const config: AnalyzerConfig = {
        maxFiles: 100000, // Exceeds max of 50000
      };
      const analyzer = new CodebaseAnalyzer(testDir, [], config);
      assert.ok(analyzer);
    });

    it('should handle relative paths by resolving to absolute', () => {
      const analyzer = new CodebaseAnalyzer('.');
      assert.ok(analyzer);
    });
  });

  describe('validateDirectoryPath', () => {
    it('should return valid for existing directory', async () => {
      const analyzer = new CodebaseAnalyzer(testDir);
      const result = await analyzer.validateDirectoryPath(testDir);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('should return error for non-existent path', async () => {
      const analyzer = new CodebaseAnalyzer(testDir);
      const result = await analyzer.validateDirectoryPath('/nonexistent/path');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error instanceof AnalyzerError);
      assert.strictEqual(result.error?.code, ErrorCode.ANALYZER_PATH_NOT_FOUND);
    });

    it('should return error for file path instead of directory', async () => {
      const filePath = join(testDir, 'test-file.txt');
      writeFileSync(filePath, 'content');

      const analyzer = new CodebaseAnalyzer(testDir);
      const result = await analyzer.validateDirectoryPath(filePath);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error instanceof AnalyzerError);
      assert.strictEqual(result.error?.code, ErrorCode.ANALYZER_PATH_NOT_DIRECTORY);
    });
  });

  describe('validateGlobPattern', () => {
    it('should accept valid simple patterns', () => {
      const analyzer = new CodebaseAnalyzer(testDir);

      assert.strictEqual(analyzer.validateGlobPattern('*.ts').valid, true);
      assert.strictEqual(analyzer.validateGlobPattern('src/**/*.js').valid, true);
      assert.strictEqual(analyzer.validateGlobPattern('node_modules').valid, true);
    });

    it('should reject patterns exceeding max length', () => {
      const analyzer = new CodebaseAnalyzer(testDir);
      const longPattern = 'a'.repeat(501);

      const result = analyzer.validateGlobPattern(longPattern);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error?.code, ErrorCode.ANALYZER_INVALID_GLOB_PATTERN);
    });

    it('should reject patterns with excessive wildcards', () => {
      const analyzer = new CodebaseAnalyzer(testDir);
      // Pattern with more than 10 wildcard sequences
      const pattern = '*a*b*c*d*e*f*g*h*i*j*k*';

      const result = analyzer.validateGlobPattern(pattern);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error?.code, ErrorCode.ANALYZER_INVALID_GLOB_PATTERN);
    });

    it('should reject ReDoS-vulnerable patterns', () => {
      const analyzer = new CodebaseAnalyzer(testDir);

      // Pattern like (.*)+
      const result = analyzer.validateGlobPattern('(.*)+');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error?.code, ErrorCode.ANALYZER_INVALID_GLOB_PATTERN);
    });
  });

  describe('validateRegexPattern', () => {
    it('should accept valid regex patterns', () => {
      const analyzer = new CodebaseAnalyzer(testDir);

      assert.strictEqual(analyzer.validateRegexPattern('^test$').valid, true);
      assert.strictEqual(analyzer.validateRegexPattern('\\w+').valid, true);
      assert.strictEqual(analyzer.validateRegexPattern('[a-z]+').valid, true);
    });

    it('should reject invalid regex patterns', () => {
      const analyzer = new CodebaseAnalyzer(testDir);

      const result = analyzer.validateRegexPattern('[invalid');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error?.code, ErrorCode.ANALYZER_INVALID_REGEX_PATTERN);
    });

    it('should reject patterns exceeding max length', () => {
      const analyzer = new CodebaseAnalyzer(testDir);
      const longPattern = 'a'.repeat(501);

      const result = analyzer.validateRegexPattern(longPattern);

      assert.strictEqual(result.valid, false);
    });

    it('should reject ReDoS-vulnerable regex patterns', () => {
      const analyzer = new CodebaseAnalyzer(testDir);

      const result = analyzer.validateRegexPattern('(.*)+');

      assert.strictEqual(result.valid, false);
    });
  });

  describe('validateConfig', () => {
    it('should validate valid configuration', () => {
      const analyzer = new CodebaseAnalyzer(testDir, [], {
        maxDepth: 10,
        maxFiles: 10000,
      });

      const result = analyzer.validateConfig();

      assert.strictEqual(result.valid, true);
    });

    it('should validate exclude paths', () => {
      const analyzer = new CodebaseAnalyzer(testDir, ['node_modules', 'dist']);

      const result = analyzer.validateConfig();

      assert.strictEqual(result.valid, true);
    });
  });

  describe('analyze', () => {
    it('should analyze empty directory', async () => {
      const analyzer = new CodebaseAnalyzer(testDir);

      const analysis = await analyzer.analyze();

      assert.ok(analysis);
      assert.strictEqual(analysis.fileCount, 0);
      assert.deepStrictEqual(analysis.structure, []);
      assert.deepStrictEqual(analysis.packages, []);
    });

    it('should find files in directory', async () => {
      // Create some test files
      writeFileSync(join(testDir, 'file1.ts'), 'const x = 1;');
      writeFileSync(join(testDir, 'file2.ts'), 'const y = 2;');

      const analyzer = new CodebaseAnalyzer(testDir);
      const analysis = await analyzer.analyze();

      assert.strictEqual(analysis.fileCount, 2);
      assert.ok(analysis.structure.some(e => e.name === 'file1.ts'));
      assert.ok(analysis.structure.some(e => e.name === 'file2.ts'));
    });

    it('should scan nested directories', async () => {
      // Create nested structure
      mkdirSync(join(testDir, 'src'));
      mkdirSync(join(testDir, 'src', 'components'));
      writeFileSync(join(testDir, 'src', 'index.ts'), 'export {};');
      writeFileSync(join(testDir, 'src', 'components', 'Button.tsx'), 'export const Button = () => null;');

      const analyzer = new CodebaseAnalyzer(testDir);
      const analysis = await analyzer.analyze();

      assert.strictEqual(analysis.fileCount, 2);
    });

    it('should find package.json files', async () => {
      const packageJson = {
        name: 'test-package',
        dependencies: {
          'lodash': '^4.0.0',
        },
        scripts: {
          test: 'jest',
          build: 'tsc',
        },
      };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson));

      const analyzer = new CodebaseAnalyzer(testDir);
      const analysis = await analyzer.analyze();

      assert.strictEqual(analysis.packages.length, 1);
      assert.strictEqual(analysis.packages[0].name, 'test-package');
      assert.ok(analysis.packages[0].dependencies.includes('lodash'));
      assert.ok('test' in analysis.packages[0].scripts);
    });

    it('should find config files', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}');
      writeFileSync(join(testDir, 'tsconfig.json'), '{}');
      writeFileSync(join(testDir, '.eslintrc.json'), '{}');

      const analyzer = new CodebaseAnalyzer(testDir);
      const analysis = await analyzer.analyze();

      assert.ok(analysis.configFiles.length >= 2);
      assert.ok(analysis.configFiles.some(f => f.includes('package.json')));
      assert.ok(analysis.configFiles.some(f => f.includes('tsconfig.json')));
    });

    it('should exclude ignored directories', async () => {
      // Create node_modules directory (should be ignored)
      mkdirSync(join(testDir, 'node_modules'));
      writeFileSync(join(testDir, 'node_modules', 'dep.js'), 'module.exports = {};');

      // Create regular file
      writeFileSync(join(testDir, 'index.ts'), 'export {};');

      const analyzer = new CodebaseAnalyzer(testDir);
      const analysis = await analyzer.analyze();

      assert.strictEqual(analysis.fileCount, 1);
      assert.ok(!analysis.structure.some(e => e.name === 'node_modules'));
    });

    it('should respect maxDepth configuration', async () => {
      // Create deeply nested structure
      let currentPath = testDir;
      for (let i = 0; i < 15; i++) {
        currentPath = join(currentPath, `level${i}`);
        mkdirSync(currentPath);
        writeFileSync(join(currentPath, 'file.ts'), `const level = ${i};`);
      }

      const analyzer = new CodebaseAnalyzer(testDir, [], { maxDepth: 3 });
      const analysis = await analyzer.analyze();

      // Should not scan beyond depth 3
      assert.ok(analysis.fileCount <= 4);
    });

    it('should respect maxFiles configuration', async () => {
      // Create many files
      for (let i = 0; i < 150; i++) {
        writeFileSync(join(testDir, `file${i}.ts`), `const x = ${i};`);
      }

      const analyzer = new CodebaseAnalyzer(testDir, [], { maxFiles: 100 });
      const analysis = await analyzer.analyze();

      // Should be limited to ~100 files
      assert.ok(analysis.fileCount <= 100);
    });

    it('should respect exclude paths', async () => {
      mkdirSync(join(testDir, 'excluded'));
      writeFileSync(join(testDir, 'excluded', 'file.ts'), 'const x = 1;');
      writeFileSync(join(testDir, 'included.ts'), 'const y = 2;');

      const analyzer = new CodebaseAnalyzer(testDir, ['excluded']);
      const analysis = await analyzer.analyze();

      assert.strictEqual(analysis.fileCount, 1);
      assert.ok(analysis.structure.some(e => e.name === 'included.ts'));
      assert.ok(!analysis.structure.some(e => e.name === 'excluded'));
    });

    it('should throw AnalyzerError for invalid path', async () => {
      const analyzer = new CodebaseAnalyzer('/nonexistent/path');

      await assert.rejects(
        () => analyzer.analyze(),
        (error: Error) => {
          return error instanceof AnalyzerError &&
            error.code === ErrorCode.ANALYZER_PATH_NOT_FOUND;
        }
      );
    });
  });

  describe('generateSummary', () => {
    it('should generate markdown summary', async () => {
      // Create test structure
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test-app',
        scripts: { test: 'jest' },
      }));
      writeFileSync(join(testDir, 'index.ts'), '// TODO: Add main logic\nexport {};');

      const analyzer = new CodebaseAnalyzer(testDir);
      const analysis = await analyzer.analyze();
      const summary = analyzer.generateSummary(analysis);

      assert.ok(summary.includes('Codebase Structure'));
      assert.ok(summary.includes('Total Files'));
    });

    it('should include packages section when packages exist', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'my-package',
        scripts: { build: 'tsc' },
      }));

      const analyzer = new CodebaseAnalyzer(testDir);
      const analysis = await analyzer.analyze();
      const summary = analyzer.generateSummary(analysis);

      assert.ok(summary.includes('Packages'));
      assert.ok(summary.includes('my-package'));
    });

    it('should include top-level structure', async () => {
      mkdirSync(join(testDir, 'src'));
      writeFileSync(join(testDir, 'README.md'), '# Test');

      const analyzer = new CodebaseAnalyzer(testDir);
      const analysis = await analyzer.analyze();
      const summary = analyzer.generateSummary(analysis);

      assert.ok(summary.includes('Top-Level Structure'));
    });
  });

  describe('AnalyzerError', () => {
    it('should include path in context', () => {
      const error = new AnalyzerError(
        ErrorCode.ANALYZER_PATH_NOT_FOUND,
        'Path not found',
        { path: '/test/path' }
      );

      assert.strictEqual(error.context.path, '/test/path');
    });

    it('should include recovery actions', () => {
      const error = new AnalyzerError(
        ErrorCode.ANALYZER_PATH_NOT_FOUND,
        'Path not found'
      );

      assert.ok(error.recoveryActions.length > 0);
    });

    it('should not be retryable', () => {
      const error = new AnalyzerError(
        ErrorCode.ANALYZER_INVALID_GLOB_PATTERN,
        'Invalid pattern'
      );

      assert.strictEqual(error.isRetryable, false);
    });
  });
});

describe('File type handling', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `filetype-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should handle various code file extensions', async () => {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
    extensions.forEach((ext, i) => {
      writeFileSync(join(testDir, `file${i}${ext}`), `// Code file ${i}`);
    });

    const analyzer = new CodebaseAnalyzer(testDir);
    const analysis = await analyzer.analyze();

    assert.strictEqual(analysis.fileCount, extensions.length);
  });

  it('should handle config file extensions', async () => {
    writeFileSync(join(testDir, 'config.json'), '{}');
    writeFileSync(join(testDir, 'config.yaml'), 'key: value');
    writeFileSync(join(testDir, 'config.toml'), 'key = "value"');

    const analyzer = new CodebaseAnalyzer(testDir);
    const analysis = await analyzer.analyze();

    assert.strictEqual(analysis.fileCount, 3);
  });

  it('should skip lock files in ignored list', async () => {
    writeFileSync(join(testDir, 'package-lock.json'), '{}');
    writeFileSync(join(testDir, 'yarn.lock'), '# yarn lockfile');
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4');
    writeFileSync(join(testDir, 'index.ts'), 'export {};');

    const analyzer = new CodebaseAnalyzer(testDir);
    const analysis = await analyzer.analyze();

    // Only index.ts should be counted (lock files are ignored)
    assert.strictEqual(analysis.fileCount, 1);
  });
});

describe('DirectoryEntry structure', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `entry-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should correctly identify file types', async () => {
    writeFileSync(join(testDir, 'file.ts'), 'const x = 1;');
    mkdirSync(join(testDir, 'subdir'));

    const analyzer = new CodebaseAnalyzer(testDir);
    const analysis = await analyzer.analyze();

    const file = analysis.structure.find(e => e.name === 'file.ts');
    const dir = analysis.structure.find(e => e.name === 'subdir');

    assert.strictEqual(file?.type, 'file');
    assert.strictEqual(dir?.type, 'directory');
  });

  it('should include relative paths', async () => {
    mkdirSync(join(testDir, 'src'));
    writeFileSync(join(testDir, 'src', 'index.ts'), 'export {};');

    const analyzer = new CodebaseAnalyzer(testDir);
    const analysis = await analyzer.analyze();

    const srcDir = analysis.structure.find(e => e.name === 'src');
    assert.ok(srcDir);
    assert.ok(srcDir.children);
    // Normalize path separators for cross-platform compatibility
    assert.ok(srcDir.children.some(c => c.path.replace(/\\/g, '/') === 'src/index.ts'));
  });

  it('should nest children in directory entries', async () => {
    mkdirSync(join(testDir, 'parent'));
    mkdirSync(join(testDir, 'parent', 'child'));
    writeFileSync(join(testDir, 'parent', 'child', 'file.ts'), 'const x = 1;');

    const analyzer = new CodebaseAnalyzer(testDir);
    const analysis = await analyzer.analyze();

    const parent = analysis.structure.find(e => e.name === 'parent');
    assert.ok(parent?.children);
    const child = parent.children.find(e => e.name === 'child');
    assert.ok(child?.children);
    assert.ok(child.children.some(e => e.name === 'file.ts'));
  });
});
