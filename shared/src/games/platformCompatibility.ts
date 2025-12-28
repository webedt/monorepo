/**
 * Platform Compatibility Utilities
 * Check system compatibility with game requirements
 */

import type { CompatibilityCheck } from './types.js';
import type { CompatibilityCheckResult } from './types.js';
import type { GraphicsAPI } from './types.js';
import type { PlatformArchitecture } from './types.js';
import type { PlatformIdentifier } from './types.js';
import type { PlatformOS } from './types.js';
import type { SystemRequirements } from './types.js';
import type { UserSystemInfo } from './types.js';

/**
 * Detect the current platform from environment
 */
export function detectPlatform(): PlatformIdentifier {
  let os: PlatformOS;
  let architecture: PlatformArchitecture;

  // Detect OS
  if (typeof process !== 'undefined' && process.platform) {
    switch (process.platform) {
      case 'darwin':
        os = 'macos';
        break;
      case 'win32':
        os = 'windows';
        break;
      case 'linux':
      default:
        os = 'linux';
        break;
    }
  } else {
    // Browser environment - try to detect from user agent
    if (typeof navigator !== 'undefined') {
      const userAgent = navigator.userAgent.toLowerCase();
      if (userAgent.includes('mac')) {
        os = 'macos';
      } else if (userAgent.includes('win')) {
        os = 'windows';
      } else {
        os = 'linux';
      }
    } else {
      os = 'linux'; // Default fallback
    }
  }

  // Detect architecture
  if (typeof process !== 'undefined' && process.arch) {
    const arch = process.arch as string;
    switch (arch) {
      case 'x64':
        architecture = 'x64';
        break;
      case 'arm64':
        architecture = 'arm64';
        break;
      case 'ia32':
      default:
        architecture = 'x86';
        break;
    }
  } else {
    architecture = 'x64'; // Default to x64
  }

  return { os, architecture };
}

/**
 * Get display name for a platform
 */
export function getPlatformDisplayName(platform: PlatformIdentifier): string {
  const osNames: Record<PlatformOS, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
  };

  const archNames: Record<PlatformArchitecture, string> = {
    x64: '64-bit',
    x86: '32-bit',
    arm64: 'ARM64',
  };

  return `${osNames[platform.os]} ${archNames[platform.architecture]}`;
}

/**
 * Check if a platform matches another
 */
export function platformMatches(
  platform: PlatformIdentifier,
  target: PlatformIdentifier
): boolean {
  return platform.os === target.os && platform.architecture === target.architecture;
}

/**
 * Check system compatibility with game requirements
 */
export function checkCompatibility(
  userSystem: UserSystemInfo,
  minimumRequirements: SystemRequirements | null,
  recommendedRequirements: SystemRequirements | null
): CompatibilityCheckResult {
  const checks: CompatibilityCheck[] = [];
  let passedMinimum = true;
  let passedRecommended = true;

  const requirements = minimumRequirements ?? recommendedRequirements;
  if (!requirements) {
    return {
      compatible: true,
      platform: { os: userSystem.os, architecture: userSystem.architecture },
      checks: [],
      overallScore: 100,
      recommendation: 'exceeds',
    };
  }

  // OS Check
  if (requirements.osVersion) {
    const osCheck: CompatibilityCheck = {
      category: 'os',
      passed: true, // Simplified check
      required: requirements.osVersion,
      detected: userSystem.osVersion,
    };
    checks.push(osCheck);
    if (!osCheck.passed) passedMinimum = false;
  }

  // Memory Check
  if (requirements.memory && userSystem.memoryMB !== undefined) {
    const memoryCheck: CompatibilityCheck = {
      category: 'memory',
      passed: userSystem.memoryMB >= requirements.memory,
      required: `${requirements.memory} MB`,
      detected: `${userSystem.memoryMB} MB`,
    };
    checks.push(memoryCheck);
    if (!memoryCheck.passed) passedMinimum = false;
  }

  // Graphics Check
  if (requirements.graphics && userSystem.graphics) {
    const graphicsCheck: CompatibilityCheck = {
      category: 'graphics',
      passed: true, // Simplified - would need GPU database for accurate check
      required: requirements.graphics,
      detected: userSystem.graphics,
    };
    checks.push(graphicsCheck);
  }

  // Graphics Memory Check
  if (requirements.graphicsMemory && userSystem.graphicsMemoryMB !== undefined) {
    const vramCheck: CompatibilityCheck = {
      category: 'graphics',
      passed: userSystem.graphicsMemoryMB >= requirements.graphicsMemory,
      required: `${requirements.graphicsMemory} MB VRAM`,
      detected: `${userSystem.graphicsMemoryMB} MB VRAM`,
    };
    checks.push(vramCheck);
    if (!vramCheck.passed) passedMinimum = false;
  }

  // Graphics API Check
  if (requirements.graphicsApi && userSystem.graphicsApi) {
    const apiCheck: CompatibilityCheck = {
      category: 'api',
      passed: userSystem.graphicsApi.includes(requirements.graphicsApi),
      required: requirements.graphicsApi,
      detected: userSystem.graphicsApi.join(', '),
    };
    checks.push(apiCheck);
    if (!apiCheck.passed) passedMinimum = false;
  }

  // Storage Check
  if (requirements.storage && userSystem.availableStorageMB !== undefined) {
    const storageCheck: CompatibilityCheck = {
      category: 'storage',
      passed: userSystem.availableStorageMB >= requirements.storage,
      required: `${requirements.storage} MB`,
      detected: `${userSystem.availableStorageMB} MB available`,
    };
    checks.push(storageCheck);
    if (!storageCheck.passed) passedMinimum = false;
  }

  // Check against recommended if available
  if (recommendedRequirements) {
    if (recommendedRequirements.memory && userSystem.memoryMB !== undefined) {
      passedRecommended = passedRecommended && userSystem.memoryMB >= recommendedRequirements.memory;
    }
    if (recommendedRequirements.graphicsMemory && userSystem.graphicsMemoryMB !== undefined) {
      passedRecommended = passedRecommended && userSystem.graphicsMemoryMB >= recommendedRequirements.graphicsMemory;
    }
    if (recommendedRequirements.storage && userSystem.availableStorageMB !== undefined) {
      passedRecommended = passedRecommended && userSystem.availableStorageMB >= recommendedRequirements.storage;
    }
  }

  // Calculate overall score
  const passedChecks = checks.filter((c) => c.passed).length;
  const totalChecks = checks.length;
  const overallScore = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;

  // Determine recommendation
  let recommendation: CompatibilityCheckResult['recommendation'];
  if (!passedMinimum) {
    recommendation = 'not_supported';
  } else if (!passedRecommended) {
    recommendation = 'minimum';
  } else if (overallScore >= 100) {
    recommendation = 'exceeds';
  } else {
    recommendation = 'recommended';
  }

  return {
    compatible: passedMinimum,
    platform: { os: userSystem.os, architecture: userSystem.architecture },
    checks,
    overallScore,
    recommendation,
  };
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Format download speed in human-readable format
 */
export function formatDownloadSpeed(bytesPerSecond: number): string {
  return `${formatFileSize(bytesPerSecond)}/s`;
}

/**
 * Format time remaining in human-readable format
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.ceil(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Get supported graphics APIs for a platform
 */
export function getSupportedGraphicsApis(os: PlatformOS): GraphicsAPI[] {
  switch (os) {
    case 'windows':
      return ['directx11', 'directx12', 'vulkan', 'opengl'];
    case 'macos':
      return ['metal', 'opengl'];
    case 'linux':
      return ['vulkan', 'opengl'];
    default:
      return ['opengl'];
  }
}

/**
 * Check if a graphics API is supported on a platform
 */
export function isGraphicsApiSupported(os: PlatformOS, api: GraphicsAPI): boolean {
  const supported = getSupportedGraphicsApis(os);
  return supported.includes(api);
}

/**
 * Get the preferred graphics API for a platform
 */
export function getPreferredGraphicsApi(os: PlatformOS): GraphicsAPI {
  switch (os) {
    case 'windows':
      return 'directx12';
    case 'macos':
      return 'metal';
    case 'linux':
      return 'vulkan';
    default:
      return 'opengl';
  }
}

/**
 * Compare versions (semver-like comparison)
 */
export function compareVersions(version1: string, version2: string): number {
  const v1Parts = version1.split('.').map(Number);
  const v2Parts = version2.split('.').map(Number);

  const maxLength = Math.max(v1Parts.length, v2Parts.length);

  for (let i = 0; i < maxLength; i++) {
    const v1Part = v1Parts[i] ?? 0;
    const v2Part = v2Parts[i] ?? 0;

    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }

  return 0;
}

/**
 * Check if an update is available
 */
export function isUpdateAvailable(currentVersion: string, latestVersion: string): boolean {
  return compareVersions(latestVersion, currentVersion) > 0;
}

/**
 * Calculate download progress percentage
 */
export function calculateProgress(downloadedBytes: number, totalBytes: number): number {
  if (totalBytes === 0) return 0;
  return Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
}

/**
 * Estimate remaining download time
 */
export function estimateRemainingTime(
  remainingBytes: number,
  bytesPerSecond: number
): number {
  if (bytesPerSecond === 0) return Infinity;
  return Math.ceil(remainingBytes / bytesPerSecond);
}
