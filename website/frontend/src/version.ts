// Version info injected by vite-plugin-version-mark at build time
// The plugin provides version + git SHA + timestamp via window global

// Declare the global type from vite-plugin-version-mark
declare global {
  interface Window {
    __WEBEDT_VERSION__?: string;
  }
}

export const GITHUB_REPO_URL = 'https://github.com/webedt/monorepo';

// Cache for parsed version info
let cachedVersionInfo: { version: string; sha: string | null; timestamp: string | null } | null = null;

// Parse the version string which is in format "version [sha] [timestamp]"
function parseVersionInfo(): { version: string; sha: string | null; timestamp: string | null } {
  if (cachedVersionInfo) {
    return cachedVersionInfo;
  }

  const versionString = typeof window !== 'undefined' ? window.__WEBEDT_VERSION__ : undefined;

  if (!versionString) {
    cachedVersionInfo = { version: '0.0.0', sha: null, timestamp: null };
    return cachedVersionInfo;
  }

  // The plugin outputs format like "0.0.123 [abc1234] [2025-01-15T10:30:00-06:00]"
  const match = versionString.match(/^([^\s[]+)(?:\s*\[([^\]]+)\])?(?:\s*\[([^\]]+)\])?$/);
  if (match) {
    cachedVersionInfo = {
      version: match[1],
      sha: match[2] || null,
      timestamp: match[3] || null,
    };
  } else {
    cachedVersionInfo = { version: versionString, sha: null, timestamp: null };
  }

  return cachedVersionInfo;
}

// Export functions that read the value at runtime (after plugin has injected it)
export function getVersion(): string {
  return parseVersionInfo().version;
}

export function getVersionSHA(): string | null {
  return parseVersionInfo().sha;
}

export function getVersionTimestamp(): string | null {
  return parseVersionInfo().timestamp;
}

// Legacy exports for backward compatibility (evaluated lazily)
export const VERSION = '0.0.0'; // Default, use getVersion() for runtime value
export const VERSION_SHA: string | null = null; // Default, use getVersionSHA() for runtime value
export const VERSION_TIMESTAMP: string | null = null; // Default, use getVersionTimestamp() for runtime value
