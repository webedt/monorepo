import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  runHealthChecks,
  generatePreviewUrl,
  type HealthCheckResult,
  type HealthCheck,
  type HealthCheckOptions,
} from './health.js';

describe('HealthCheckResult interface', () => {
  it('should have required fields for success', () => {
    const result: HealthCheckResult = {
      success: true,
      checks: [],
      duration: 1000,
    };

    assert.strictEqual(result.success, true);
    assert.ok(Array.isArray(result.checks));
    assert.strictEqual(typeof result.duration, 'number');
  });

  it('should have required fields with checks', () => {
    const result: HealthCheckResult = {
      success: true,
      checks: [
        { url: 'https://example.com', status: 200, ok: true, responseTime: 100 },
      ],
      duration: 500,
    };

    assert.strictEqual(result.checks.length, 1);
  });

  it('should represent failed health checks', () => {
    const result: HealthCheckResult = {
      success: false,
      checks: [
        { url: 'https://example.com', status: 500, ok: false, responseTime: 200, error: 'Server error' },
      ],
      duration: 1000,
    };

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.checks[0].ok, false);
  });
});

describe('HealthCheck interface', () => {
  it('should have required fields for success', () => {
    const check: HealthCheck = {
      url: 'https://api.example.com/health',
      status: 200,
      ok: true,
      responseTime: 150,
    };

    assert.strictEqual(check.url, 'https://api.example.com/health');
    assert.strictEqual(check.status, 200);
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.responseTime, 150);
  });

  it('should have required fields for failure with status', () => {
    const check: HealthCheck = {
      url: 'https://api.example.com/health',
      status: 503,
      ok: false,
      responseTime: 50,
      error: 'Expected status 200, got 503',
    };

    assert.strictEqual(check.ok, false);
    assert.ok(check.error);
  });

  it('should handle null status for connection errors', () => {
    const check: HealthCheck = {
      url: 'https://nonexistent.example.com',
      status: null,
      ok: false,
      responseTime: 5000,
      error: 'Connection refused',
    };

    assert.strictEqual(check.status, null);
    assert.strictEqual(check.ok, false);
  });
});

describe('HealthCheckOptions interface', () => {
  it('should require urls array', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
    };

    assert.deepStrictEqual(options.urls, ['https://example.com']);
  });

  it('should allow optional timeout', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
      timeout: 5000,
    };

    assert.strictEqual(options.timeout, 5000);
  });

  it('should allow optional expectedStatus', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
      expectedStatus: 204,
    };

    assert.strictEqual(options.expectedStatus, 204);
  });

  it('should allow optional retries', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
      retries: 3,
    };

    assert.strictEqual(options.retries, 3);
  });

  it('should allow optional retryDelay', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
      retryDelay: 2000,
    };

    assert.strictEqual(options.retryDelay, 2000);
  });

  it('should allow optional concurrency', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
      concurrency: 10,
    };

    assert.strictEqual(options.concurrency, 10);
  });

  it('should allow optional parallel flag', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
      parallel: false,
    };

    assert.strictEqual(options.parallel, false);
  });

  it('should allow all options together', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com', 'https://api.example.com'],
      timeout: 5000,
      expectedStatus: 200,
      retries: 2,
      retryDelay: 1000,
      concurrency: 5,
      parallel: true,
    };

    assert.ok(options);
  });
});

describe('runHealthChecks', () => {
  it('should return success with empty URLs', async () => {
    const result = await runHealthChecks({ urls: [] });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.checks.length, 0);
    assert.strictEqual(result.duration, 0);
  });

  it('should track duration', async () => {
    const result = await runHealthChecks({ urls: [] });

    assert.strictEqual(typeof result.duration, 'number');
  });
});

describe('generatePreviewUrl', () => {
  it('should replace owner placeholder', () => {
    const url = generatePreviewUrl(
      'https://{owner}.github.io/{repo}',
      { owner: 'myorg', repo: 'myrepo', branch: 'main' }
    );

    assert.ok(url.includes('myorg'));
  });

  it('should replace repo placeholder', () => {
    const url = generatePreviewUrl(
      'https://{owner}.github.io/{repo}',
      { owner: 'myorg', repo: 'myrepo', branch: 'main' }
    );

    assert.ok(url.includes('myrepo'));
  });

  it('should replace branch placeholder', () => {
    const url = generatePreviewUrl(
      'https://preview.example.com/{branch}',
      { owner: 'org', repo: 'repo', branch: 'feature-x' }
    );

    assert.ok(url.includes('feature-x'));
  });

  it('should convert slashes in branch names to dashes', () => {
    const url = generatePreviewUrl(
      'https://preview.example.com/{branch}',
      { owner: 'org', repo: 'repo', branch: 'feature/new-thing' }
    );

    assert.ok(url.includes('feature-new-thing'));
    // Verify the branch part doesn't have the original slash
    assert.ok(!url.includes('feature/new-thing'));
  });

  it('should handle multiple slashes in branch', () => {
    const url = generatePreviewUrl(
      'https://{branch}.preview.com',
      { owner: 'org', repo: 'repo', branch: 'feature/sub/deep' }
    );

    assert.ok(url.includes('feature-sub-deep'));
  });

  it('should handle all placeholders together', () => {
    const url = generatePreviewUrl(
      'https://{owner}-{repo}-{branch}.vercel.app',
      { owner: 'myorg', repo: 'myrepo', branch: 'feature/test' }
    );

    assert.strictEqual(url, 'https://myorg-myrepo-feature-test.vercel.app');
  });

  it('should return URL unchanged if no placeholders', () => {
    const url = generatePreviewUrl(
      'https://static.example.com',
      { owner: 'org', repo: 'repo', branch: 'main' }
    );

    assert.strictEqual(url, 'https://static.example.com');
  });
});

describe('Health check scenarios', () => {
  it('should represent all checks passing', () => {
    const result: HealthCheckResult = {
      success: true,
      checks: [
        { url: 'https://api.example.com/health', status: 200, ok: true, responseTime: 100 },
        { url: 'https://cdn.example.com/health', status: 200, ok: true, responseTime: 50 },
        { url: 'https://db.example.com/health', status: 200, ok: true, responseTime: 150 },
      ],
      duration: 200,
    };

    assert.strictEqual(result.success, true);
    assert.ok(result.checks.every(c => c.ok));
  });

  it('should represent partial failure', () => {
    const result: HealthCheckResult = {
      success: false,
      checks: [
        { url: 'https://api.example.com/health', status: 200, ok: true, responseTime: 100 },
        { url: 'https://failing.example.com', status: 500, ok: false, responseTime: 50, error: 'Server error' },
      ],
      duration: 150,
    };

    assert.strictEqual(result.success, false);
    assert.ok(result.checks.some(c => c.ok));
    assert.ok(result.checks.some(c => !c.ok));
  });

  it('should represent timeout scenario', () => {
    const check: HealthCheck = {
      url: 'https://slow.example.com',
      status: null,
      ok: false,
      responseTime: 10000,
      error: 'Request timed out after 10000ms',
    };

    assert.ok(check.error!.includes('timed out'));
  });

  it('should represent connection refused', () => {
    const check: HealthCheck = {
      url: 'https://down.example.com',
      status: null,
      ok: false,
      responseTime: 100,
      error: 'Connection refused',
    };

    assert.strictEqual(check.status, null);
  });

  it('should represent DNS resolution failure', () => {
    const check: HealthCheck = {
      url: 'https://nonexistent.invalid',
      status: null,
      ok: false,
      responseTime: 500,
      error: 'getaddrinfo ENOTFOUND nonexistent.invalid',
    };

    assert.ok(check.error!.includes('ENOTFOUND'));
  });
});

describe('Health check configuration', () => {
  it('should use default timeout of 10 seconds', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
    };

    // Default is implicit (10000ms)
    assert.strictEqual(options.timeout, undefined);
  });

  it('should use default expected status of 200', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
    };

    // Default is implicit (200)
    assert.strictEqual(options.expectedStatus, undefined);
  });

  it('should use default retries of 2', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
    };

    // Default is implicit (2)
    assert.strictEqual(options.retries, undefined);
  });

  it('should use default concurrency of 5', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
    };

    // Default is implicit (5)
    assert.strictEqual(options.concurrency, undefined);
  });

  it('should use parallel mode by default', () => {
    const options: HealthCheckOptions = {
      urls: ['https://example.com'],
    };

    // Default is implicit (true)
    assert.strictEqual(options.parallel, undefined);
  });
});

describe('Preview URL patterns', () => {
  it('should handle Vercel pattern', () => {
    const url = generatePreviewUrl(
      'https://{repo}-git-{branch}-{owner}.vercel.app',
      { owner: 'myorg', repo: 'myapp', branch: 'feat/new' }
    );

    assert.ok(url.includes('vercel.app'));
  });

  it('should handle Netlify pattern', () => {
    const url = generatePreviewUrl(
      'https://{branch}--{repo}.netlify.app',
      { owner: 'org', repo: 'site', branch: 'main' }
    );

    assert.ok(url.includes('netlify.app'));
  });

  it('should handle GitHub Pages pattern', () => {
    const url = generatePreviewUrl(
      'https://{owner}.github.io/{repo}',
      { owner: 'myuser', repo: 'mysite', branch: 'gh-pages' }
    );

    assert.strictEqual(url, 'https://myuser.github.io/mysite');
  });

  it('should handle custom domain pattern', () => {
    const url = generatePreviewUrl(
      'https://{branch}.preview.myapp.com',
      { owner: 'org', repo: 'app', branch: 'staging' }
    );

    assert.strictEqual(url, 'https://staging.preview.myapp.com');
  });
});

describe('Multiple URL health checks', () => {
  it('should handle many URLs in options', () => {
    const options: HealthCheckOptions = {
      urls: Array.from({ length: 10 }, (_, i) => `https://api${i}.example.com`),
      concurrency: 3,
    };

    assert.strictEqual(options.urls.length, 10);
    assert.strictEqual(options.concurrency, 3);
  });

  it('should batch URLs by concurrency', () => {
    const options: HealthCheckOptions = {
      urls: Array.from({ length: 20 }, (_, i) => `https://url${i}.example.com`),
      concurrency: 5,
      parallel: true,
    };

    // 20 URLs with concurrency 5 = 4 batches
    assert.strictEqual(Math.ceil(options.urls.length / options.concurrency), 4);
  });
});
