#!/usr/bin/env node

/**
 * Generate version number based on git tags and commit count
 *
 * Version format: MAJOR.MINOR.PATCH
 * - MAJOR.MINOR comes from the latest git tag (e.g., v1.2.0)
 * - PATCH is the number of commits since that tag
 *
 * Tag only major/minor versions (v1.0.0, v1.1.0, v2.0.0)
 * Patch versions are auto-calculated from commit count
 *
 * Examples:
 *   Tag v1.2.0 + 5 commits = 1.2.5
 *   Tag v1.2.0 + 0 commits = 1.2.0
 *   No tags + 42 commits = 0.0.42
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getVersion() {
  let versionInfo;

  try {
    // Try to get the latest tag and commit count
    // Format: v1.2.0-5-g1234abc (tag-commitsSince-hash)
    const describe = execSync('git describe --tags --long --match "v*.*.*" 2>/dev/null', {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..')
    }).trim();

    // Parse git describe output: v1.2.0-5-g1234abc
    const match = describe.match(/^v(\d+)\.(\d+)\.(\d+)-(\d+)-g([a-f0-9]+)$/);

    if (match) {
      const [, major, minor, tagPatch, commitsSince, hash] = match;
      const patch = parseInt(commitsSince, 10);

      versionInfo = {
        version: `${major}.${minor}.${patch}`,
        major: parseInt(major, 10),
        minor: parseInt(minor, 10),
        patch,
        tag: `v${major}.${minor}.${tagPatch}`,
        commitsSince: patch,
        hash
      };
    }
  } catch (error) {
    // No tags found or not a git repo
  }

  if (!versionInfo) {
    try {
      // No tags - count all commits from the beginning
      const commitCount = execSync('git rev-list --count HEAD 2>/dev/null', {
        encoding: 'utf8',
        cwd: path.join(__dirname, '..')
      }).trim();

      const patch = parseInt(commitCount, 10);

      versionInfo = {
        version: `0.0.${patch}`,
        major: 0,
        minor: 0,
        patch,
        tag: null,
        commitsSince: patch,
        hash: null
      };
    } catch (error) {
      // Not a git repo or no commits
      versionInfo = {
        version: '0.0.0',
        major: 0,
        minor: 0,
        patch: 0,
        tag: null,
        commitsSince: 0,
        hash: null
      };
    }
  }

  // Get the timestamp of the latest commit
  try {
    const timestamp = execSync('git log -1 --format=%cI HEAD 2>/dev/null', {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..')
    }).trim();

    versionInfo.timestamp = timestamp || null;
  } catch (error) {
    versionInfo.timestamp = null;
  }

  // Get the full commit SHA
  try {
    const sha = execSync('git rev-parse HEAD 2>/dev/null', {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..')
    }).trim();

    versionInfo.sha = sha || null;
  } catch (error) {
    versionInfo.sha = null;
  }

  return versionInfo;
}

function updatePackageJson(version) {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
}

function updateVersionTs(version, timestamp, sha) {
  const versionPath = path.join(__dirname, '..', 'apps', 'client', 'src', 'version.ts');
  const content = `// Auto-generated from git tags and commits
// Run 'pnpm version:generate' to update
export const VERSION = '${version}';
export const VERSION_TIMESTAMP = ${timestamp ? `'${timestamp}'` : 'null'};
export const VERSION_SHA = ${sha ? `'${sha}'` : 'null'};
`;
  fs.writeFileSync(versionPath, content);
}

// Main execution
if (require.main === module) {
  const versionInfo = getVersion();

  const mode = process.argv[2];

  if (mode === '--json') {
    console.log(JSON.stringify(versionInfo, null, 2));
  } else if (mode === '--update') {
    updatePackageJson(versionInfo.version);
    updateVersionTs(versionInfo.version, versionInfo.timestamp, versionInfo.sha);
    console.log(`✓ Updated version to ${versionInfo.version}`);
    if (versionInfo.tag) {
      console.log(`  Based on tag: ${versionInfo.tag} + ${versionInfo.commitsSince} commits`);
    } else {
      console.log(`  Based on ${versionInfo.patch} total commits (no tags found)`);
    }
    if (versionInfo.timestamp) {
      console.log(`  Commit date: ${versionInfo.timestamp}`);
    }
    if (versionInfo.sha) {
      console.log(`  Commit SHA: ${versionInfo.sha}`);
    }
  } else {
    console.log(versionInfo.version);
  }
}

module.exports = { getVersion };
