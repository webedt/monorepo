/**
 * Jest Global Teardown
 *
 * This file runs once after all test suites complete.
 * It handles global cleanup tasks like closing connections and removing temp files.
 */
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
export default async function globalTeardown() {
    // Clean up any test directories that might have been left behind
    const testDirPattern = /^(daemon-test|integration-test|config-daemon-test|lifecycle-test|worker-test|pool-test)-\d+$/;
    try {
        const tempDir = tmpdir();
        const { readdirSync } = await import('fs');
        const entries = readdirSync(tempDir);
        for (const entry of entries) {
            if (testDirPattern.test(entry)) {
                const fullPath = join(tempDir, entry);
                try {
                    if (existsSync(fullPath)) {
                        rmSync(fullPath, { recursive: true, force: true });
                    }
                }
                catch {
                    // Ignore cleanup errors
                }
            }
        }
    }
    catch {
        // Ignore errors during cleanup
    }
    // Log teardown completion
    if (process.env.VERBOSE_TEARDOWN) {
        console.log('Jest global teardown complete');
    }
}
//# sourceMappingURL=jest-teardown.js.map