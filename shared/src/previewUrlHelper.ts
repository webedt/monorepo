/**
 * Preview URL Helper
 *
 * Generates preview URLs for deployed branches based on repository information.
 * Supports custom URLs via `.webedt` configuration files.
 *
 * ## Default URL Format
 *
 * ```
 * https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/
 * ```
 *
 * Branch names containing slashes are converted to hyphens:
 * - `feature/login` → `feature-login`
 *
 * ## Custom Preview URLs
 *
 * Create a `.webedt` file in your repository root to customize the preview URL:
 *
 * ```json
 * {
 *   "preview_url": "https://my-app.vercel.app"
 * }
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { getPreviewUrl, getPreviewUrlFromSession } from '@webedt/shared';
 *
 * // Get preview URL for a repository
 * const url = await getPreviewUrl(
 *   '/path/to/workspace',
 *   'webedt',
 *   'monorepo',
 *   'feature/new-ui'
 * );
 * // 'https://webedt.etdofresh.com/github/webedt/monorepo/feature-new-ui/'
 *
 * // Get preview URL from a session object
 * const sessionUrl = await getPreviewUrlFromSession(session, workspacePath);
 * ```
 *
 * @module previewUrlHelper
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from './logger.js';

/**
 * Configuration from `.webedt` file.
 *
 * Place this file in your repository root to customize WebEDT behavior.
 *
 * @example
 * ```json
 * {
 *   "preview_url": "https://my-custom-preview.vercel.app"
 * }
 * ```
 */
interface WebedtConfig {
  /** Custom preview URL for the deployed application */
  preview_url?: string;
  /** Additional configuration fields */
  [key: string]: unknown;
}

/**
 * Get the preview URL for a repository and branch.
 *
 * Resolution order:
 * 1. Check for `.webedt` file in repository and use `preview_url` if present
 * 2. Fall back to default: `https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/`
 *
 * @param workspacePath - Path to the git repository workspace (optional)
 * @param owner - Repository owner (GitHub username or org)
 * @param repo - Repository name
 * @param branch - Branch name (slashes converted to hyphens in URL)
 * @returns The preview URL
 *
 * @example
 * ```typescript
 * // Standard usage
 * const url = await getPreviewUrl(
 *   '/workspace/my-repo',
 *   'webedt',
 *   'monorepo',
 *   'main'
 * );
 * // 'https://webedt.etdofresh.com/github/webedt/monorepo/main/'
 *
 * // Without workspace (no .webedt check)
 * const url = await getPreviewUrl(undefined, 'org', 'repo', 'feature/login');
 * // 'https://webedt.etdofresh.com/github/org/repo/feature-login/'
 * ```
 */
export async function getPreviewUrl(
  workspacePath: string | undefined,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  try {
    // If workspace path is provided, try to read .webedt file
    if (workspacePath) {
      try {
        const webedtPath = path.join(workspacePath, '.webedt');
        const webedtContent = await fs.readFile(webedtPath, 'utf-8');
        const config: WebedtConfig = JSON.parse(webedtContent);

        if (config.preview_url) {
          logger.info('Using preview URL from .webedt file', {
            component: 'PreviewUrlHelper',
            previewUrl: config.preview_url
          });
          return config.preview_url;
        }
      } catch (error) {
        // .webedt file doesn't exist or is invalid - this is expected for most repos
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('Failed to parse .webedt file, using default preview URL', {
            component: 'PreviewUrlHelper'
          });
        }
      }
    }

    // Use default preview URL
    // Replace forward slashes in branch name with dashes for URL safety
    const safeBranch = branch.replace(/\//g, '-');
    const defaultUrl = `https://webedt.etdofresh.com/github/${owner}/${repo}/${safeBranch}/`;
    logger.debug('Using default preview URL', {
      component: 'PreviewUrlHelper',
      previewUrl: defaultUrl
    });

    return defaultUrl;
  } catch (error) {
    logger.error('Error generating preview URL', error, { component: 'PreviewUrlHelper' });

    // Return default URL even on error
    // Replace forward slashes in branch name with dashes for URL safety
    const safeBranch = branch.replace(/\//g, '-');
    return `https://webedt.etdofresh.com/github/${owner}/${repo}/${safeBranch}/`;
  }
}

/**
 * Get the preview URL from a session object.
 *
 * Convenience method for use with ChatSession objects that may contain
 * repository information.
 *
 * @param session - Session object with repository metadata
 * @param workspacePath - Optional workspace path to check for `.webedt` file
 * @returns The preview URL, or `null` if session lacks repository info
 *
 * @example
 * ```typescript
 * const session = {
 *   repositoryOwner: 'webedt',
 *   repositoryName: 'monorepo',
 *   branch: 'claude/fix-bug-123',
 * };
 *
 * const url = await getPreviewUrlFromSession(session);
 * // 'https://webedt.etdofresh.com/github/webedt/monorepo/claude-fix-bug-123/'
 * ```
 */
export async function getPreviewUrlFromSession(
  session: {
    repositoryOwner: string | null;
    repositoryName: string | null;
    branch: string | null;
  },
  workspacePath?: string
): Promise<string | null> {
  if (!session.repositoryOwner || !session.repositoryName || !session.branch) {
    return null;
  }

  return getPreviewUrl(
    workspacePath,
    session.repositoryOwner,
    session.repositoryName,
    session.branch
  );
}

/**
 * Check if a `.webedt` configuration file exists in the repository.
 *
 * @param workspacePath - Path to the git repository workspace
 * @returns `true` if `.webedt` file exists
 *
 * @example
 * ```typescript
 * if (await hasWebedtFile('/workspace/my-repo')) {
 *   console.log('Repository has custom WebEDT configuration');
 * }
 * ```
 */
export async function hasWebedtFile(workspacePath: string): Promise<boolean> {
  try {
    const webedtPath = path.join(workspacePath, '.webedt');
    await fs.access(webedtPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse the `.webedt` configuration file.
 *
 * @param workspacePath - Path to the git repository workspace
 * @returns The parsed configuration, or `null` if file doesn't exist or is invalid
 *
 * @example
 * ```typescript
 * const config = await readWebedtConfig('/workspace/my-repo');
 * if (config?.preview_url) {
 *   console.log(`Custom preview URL: ${config.preview_url}`);
 * }
 * ```
 */
export async function readWebedtConfig(workspacePath: string): Promise<WebedtConfig | null> {
  try {
    const webedtPath = path.join(workspacePath, '.webedt');
    const content = await fs.readFile(webedtPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to read .webedt file', { component: 'PreviewUrlHelper' });
    }
    return null;
  }
}

export type { WebedtConfig };
