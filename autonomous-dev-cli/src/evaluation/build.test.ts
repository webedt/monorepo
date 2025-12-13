import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  BuildCache,
  getBuildCache,
  initBuildCache,
  runBuild,
  runTypeCheck,
  type BuildResult,
  type BuildOptions,
} from './build.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('BuildCache', () => {
  describe('constructor', () => {
    it('should create cache with default options', () => {
      const cache = new BuildCache();
      assert.ok(cache);
    });

    it('should accept custom maxEntries', () => {
      const cache = new BuildCache({ maxEntries: 100 });
      assert.ok(cache);
    });

    it('should accept custom ttlMs', () => {
      const cache = new BuildCache({ ttlMs: 5 * 60 * 1000 });
      assert.ok(cache);
    });

    it('should accept both options', () => {
      const cache = new BuildCache({ maxEntries: 50, ttlMs: 10 * 60 * 1000 });
      assert.ok(cache);
    });
  });

  describe('generateKey', () => {
    it('should generate consistent key for same inputs', () => {
      const cache = new BuildCache();
      const key1 = cache.generateKey('/path/to/repo', ['pkg1']);
      const key2 = cache.generateKey('/path/to/repo', ['pkg1']);

      assert.strictEqual(key1, key2);
    });

    it('should generate different keys for different paths', () => {
      const cache = new BuildCache();
      const key1 = cache.generateKey('/path/to/repo1', []);
      const key2 = cache.generateKey('/path/to/repo2', []);

      assert.notStrictEqual(key1, key2);
    });

    it('should generate different keys for different packages', () => {
      const cache = new BuildCache();
      const key1 = cache.generateKey('/path', ['pkg1']);
      const key2 = cache.generateKey('/path', ['pkg2']);

      assert.notStrictEqual(key1, key2);
    });

    it('should handle empty packages array', () => {
      const cache = new BuildCache();
      const key = cache.generateKey('/path', []);
      assert.ok(key);
    });
  });

  describe('generateContentHash', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `cache-hash-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should generate hash for directory with package.json', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        version: '1.0.0',
      }));

      const cache = new BuildCache();
      const hash = cache.generateContentHash(testDir);

      assert.ok(hash);
      assert.ok(hash.length > 0);
    });

    it('should generate hash for directory with src files', () => {
      mkdirSync(join(testDir, 'src'));
      writeFileSync(join(testDir, 'package.json'), '{}');
      writeFileSync(join(testDir, 'src', 'index.ts'), 'export {};');

      const cache = new BuildCache();
      const hash = cache.generateContentHash(testDir);

      assert.ok(hash);
    });

    it('should include tsconfig in hash if present', () => {
      writeFileSync(join(testDir, 'package.json'), '{}');
      writeFileSync(join(testDir, 'tsconfig.json'), '{}');

      const cache = new BuildCache();
      const hash = cache.generateContentHash(testDir);

      assert.ok(hash);
    });

    it('should generate consistent hashes', () => {
      writeFileSync(join(testDir, 'package.json'), '{"name":"test"}');

      const cache = new BuildCache();
      const hash1 = cache.generateContentHash(testDir);
      const hash2 = cache.generateContentHash(testDir);

      assert.strictEqual(hash1, hash2);
    });
  });

  describe('get and set', () => {
    it('should return null for missing key', () => {
      const cache = new BuildCache();
      const result = cache.get('nonexistent', 'hash123');

      assert.strictEqual(result, null);
    });

    it('should cache and retrieve successful build', () => {
      const cache = new BuildCache();
      const key = 'test-key';
      const contentHash = 'hash123';
      const buildResult: BuildResult = {
        success: true,
        output: 'Build successful',
        duration: 1000,
      };

      cache.set(key, buildResult, contentHash);
      const retrieved = cache.get(key, contentHash);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.success, true);
      assert.strictEqual(retrieved.cached, true);
    });

    it('should not cache failed builds', () => {
      const cache = new BuildCache();
      const key = 'test-key';
      const contentHash = 'hash123';
      const buildResult: BuildResult = {
        success: false,
        output: 'Build failed',
        duration: 500,
        error: 'Compilation error',
      };

      cache.set(key, buildResult, contentHash);
      const retrieved = cache.get(key, contentHash);

      assert.strictEqual(retrieved, null);
    });

    it('should invalidate on content hash change', () => {
      const cache = new BuildCache();
      const key = 'test-key';
      const buildResult: BuildResult = {
        success: true,
        output: 'Success',
        duration: 1000,
      };

      cache.set(key, buildResult, 'hash1');
      const retrieved = cache.get(key, 'hash2');

      assert.strictEqual(retrieved, null);
    });

    it('should invalidate expired entries', async () => {
      const cache = new BuildCache({ ttlMs: 1 }); // 1ms TTL
      const key = 'test-key';
      const contentHash = 'hash123';
      const buildResult: BuildResult = {
        success: true,
        output: 'Success',
        duration: 1000,
      };

      cache.set(key, buildResult, contentHash);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));

      const retrieved = cache.get(key, contentHash);
      assert.strictEqual(retrieved, null);
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', () => {
      const cache = new BuildCache();
      const buildResult: BuildResult = {
        success: true,
        output: 'Success',
        duration: 1000,
      };

      cache.set('key1', buildResult, 'hash1');
      cache.set('key2', buildResult, 'hash2');
      cache.clear();

      assert.strictEqual(cache.get('key1', 'hash1'), null);
      assert.strictEqual(cache.get('key2', 'hash2'), null);
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const cache = new BuildCache();
      const stats = cache.getStats();

      assert.strictEqual(stats.hits, 0);
      assert.strictEqual(stats.misses, 0);
      assert.strictEqual(stats.invalidations, 0);
      assert.strictEqual(stats.size, 0);
      assert.strictEqual(stats.hitRate, 0);
    });

    it('should track cache hits', () => {
      const cache = new BuildCache();
      const buildResult: BuildResult = {
        success: true,
        output: 'Success',
        duration: 1000,
      };

      cache.set('key', buildResult, 'hash');
      cache.get('key', 'hash');
      cache.get('key', 'hash');

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 2);
    });

    it('should track cache misses', () => {
      const cache = new BuildCache();

      cache.get('nonexistent1', 'hash');
      cache.get('nonexistent2', 'hash');

      const stats = cache.getStats();
      assert.strictEqual(stats.misses, 2);
    });

    it('should track invalidations', () => {
      const cache = new BuildCache();
      const buildResult: BuildResult = {
        success: true,
        output: 'Success',
        duration: 1000,
      };

      cache.set('key', buildResult, 'hash1');
      cache.get('key', 'hash2'); // Invalidate due to hash mismatch

      const stats = cache.getStats();
      assert.strictEqual(stats.invalidations, 1);
    });

    it('should calculate hit rate', () => {
      const cache = new BuildCache();
      const buildResult: BuildResult = {
        success: true,
        output: 'Success',
        duration: 1000,
      };

      cache.set('key', buildResult, 'hash');
      cache.get('key', 'hash'); // hit
      cache.get('key', 'hash'); // hit
      cache.get('nonexistent', 'hash'); // miss

      const stats = cache.getStats();
      assert.ok(stats.hitRate > 0.5);
    });
  });

  describe('max entries limit', () => {
    it('should enforce max entries', () => {
      const cache = new BuildCache({ maxEntries: 2 });
      const buildResult: BuildResult = {
        success: true,
        output: 'Success',
        duration: 1000,
      };

      cache.set('key1', buildResult, 'hash1');
      cache.set('key2', buildResult, 'hash2');
      cache.set('key3', buildResult, 'hash3');

      const stats = cache.getStats();
      assert.ok(stats.size <= 2);
    });
  });
});

describe('Global build cache', () => {
  it('should return same instance from getBuildCache', () => {
    const cache1 = getBuildCache();
    const cache2 = getBuildCache();

    assert.strictEqual(cache1, cache2);
  });

  it('should create new instance with initBuildCache', () => {
    const originalCache = getBuildCache();
    const newCache = initBuildCache({ maxEntries: 100 });

    assert.notStrictEqual(originalCache, newCache);
  });

  it('should update global cache after initBuildCache', () => {
    initBuildCache({ maxEntries: 100 });
    const cache = getBuildCache();

    assert.ok(cache);
  });
});

describe('BuildResult interface', () => {
  it('should have required fields for success', () => {
    const result: BuildResult = {
      success: true,
      output: 'Build completed successfully',
      duration: 5000,
    };

    assert.strictEqual(result.success, true);
    assert.ok(result.output);
    assert.strictEqual(typeof result.duration, 'number');
  });

  it('should have required fields for failure', () => {
    const result: BuildResult = {
      success: false,
      output: 'Compilation failed',
      duration: 1000,
      error: 'Type error in index.ts',
    };

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  it('should allow optional cached flag', () => {
    const result: BuildResult = {
      success: true,
      output: 'From cache',
      duration: 0,
      cached: true,
      cacheKey: 'abc123',
    };

    assert.strictEqual(result.cached, true);
    assert.ok(result.cacheKey);
  });
});

describe('BuildOptions interface', () => {
  it('should require repoPath', () => {
    const options: BuildOptions = {
      repoPath: '/path/to/repo',
    };

    assert.strictEqual(options.repoPath, '/path/to/repo');
  });

  it('should allow optional packages', () => {
    const options: BuildOptions = {
      repoPath: '/path',
      packages: ['pkg1', 'pkg2'],
    };

    assert.deepStrictEqual(options.packages, ['pkg1', 'pkg2']);
  });

  it('should allow optional timeout', () => {
    const options: BuildOptions = {
      repoPath: '/path',
      timeout: 10 * 60 * 1000,
    };

    assert.strictEqual(options.timeout, 10 * 60 * 1000);
  });

  it('should allow optional enableCache', () => {
    const options: BuildOptions = {
      repoPath: '/path',
      enableCache: false,
    };

    assert.strictEqual(options.enableCache, false);
  });

  it('should allow custom cache instance', () => {
    const customCache = new BuildCache();
    const options: BuildOptions = {
      repoPath: '/path',
      cache: customCache,
    };

    assert.strictEqual(options.cache, customCache);
  });
});

describe('runBuild', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `build-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return success for project without build script', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: {},
    }));

    const result = await runBuild({ repoPath: testDir });

    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('No build'));
  });

  it('should return success for project without package.json', async () => {
    // Empty directory
    const result = await runBuild({ repoPath: testDir });

    assert.strictEqual(result.success, true);
  });

  it('should use cached result when available', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: {},
    }));

    const customCache = new BuildCache();
    const cachedResult: BuildResult = {
      success: true,
      output: 'Cached build output',
      duration: 1000,
    };

    const key = customCache.generateKey(testDir, []);
    const hash = customCache.generateContentHash(testDir);
    customCache.set(key, cachedResult, hash);

    const result = await runBuild({
      repoPath: testDir,
      enableCache: true,
      cache: customCache,
    });

    assert.strictEqual(result.cached, true);
    assert.strictEqual(result.duration, 0); // Cached builds are instant
  });

  it('should skip cache when disabled', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: {},
    }));

    const result = await runBuild({
      repoPath: testDir,
      enableCache: false,
    });

    assert.strictEqual(result.cached, undefined);
  });
});

describe('runTypeCheck', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `typecheck-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should skip when no tsconfig.json', async () => {
    const result = await runTypeCheck(testDir);

    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('No tsconfig.json'));
  });

  it('should be a function', () => {
    assert.strictEqual(typeof runTypeCheck, 'function');
  });
});
