import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger, getCorrelationId, createOperationContext, finalizeOperationContext, startPhase, endPhase, recordPhaseOperation, recordPhaseError, } from '../utils/logger.js';
const packageJsonCache = new Map();
const PACKAGE_JSON_CACHE_TTL_MS = 30 * 1000; // 30 seconds
/**
 * Asynchronously load and parse a package.json file with caching.
 * Returns null if the file doesn't exist or contains malformed JSON.
 */
async function loadPackageJson(filePath) {
    // Check cache first
    const cached = packageJsonCache.get(filePath);
    if (cached && Date.now() - cached.timestamp < PACKAGE_JSON_CACHE_TTL_MS) {
        return cached.data;
    }
    // Check if file exists
    if (!existsSync(filePath)) {
        return null;
    }
    try {
        const content = await readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        // Cache the result
        packageJsonCache.set(filePath, {
            data,
            timestamp: Date.now(),
        });
        return data;
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            logger.warn(`Malformed JSON in ${filePath}: ${error.message}`);
        }
        else {
            logger.debug(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
    }
}
/**
 * Clear the package.json cache. Useful for testing or when files are known to have changed.
 */
export function clearPackageJsonCache() {
    packageJsonCache.clear();
}
export async function runTests(options) {
    const { repoPath, packages = [], timeout = 10 * 60 * 1000, testPattern } = options;
    const startTime = Date.now();
    const correlationId = getCorrelationId();
    // Start evaluation phase if tracking
    if (correlationId) {
        startPhase(correlationId, 'evaluation', {
            operation: 'tests',
            repoPath,
            packageCount: packages.length,
        });
        recordPhaseOperation(correlationId, 'evaluation', 'runTests');
    }
    // Create operation context for structured logging
    const operationContext = createOperationContext('Tests', 'runTests', {
        repoPath,
        packages,
        timeout,
        testPattern,
    });
    logger.info('Running tests...', {
        correlationId,
        repoPath,
        packageCount: packages.length,
        testPattern,
    });
    try {
        const testCommands = await determineTestCommands(repoPath, packages);
        if (testCommands.length === 0) {
            logger.warn('No test commands found');
            return {
                success: true,
                output: 'No test configuration found, skipping tests',
                duration: Date.now() - startTime,
                testsRun: 0,
                testsPassed: 0,
                testsFailed: 0,
            };
        }
        let combinedOutput = '';
        let totalTests = 0;
        let passedTests = 0;
        let failedTests = 0;
        let hasFailure = false;
        for (const { command, cwd } of testCommands) {
            const fullCommand = testPattern ? `${command} -- --testPathPattern="${testPattern}"` : command;
            logger.info(`Running: ${fullCommand} in ${cwd}`);
            try {
                const output = execSync(fullCommand, {
                    cwd,
                    timeout,
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        CI: 'true',
                        NODE_ENV: 'test',
                    },
                });
                combinedOutput += `\n=== ${command} ===\n${output}`;
                // Parse test results from output
                const stats = parseTestOutput(output);
                totalTests += stats.total;
                passedTests += stats.passed;
                failedTests += stats.failed;
            }
            catch (execError) {
                const stderr = execError.stderr?.toString() || '';
                const stdout = execError.stdout?.toString() || '';
                const output = `${stdout}\n${stderr}`;
                combinedOutput += `\n=== ${command} (FAILED) ===\n${output}`;
                // Parse even failed test output
                const stats = parseTestOutput(output);
                totalTests += stats.total;
                passedTests += stats.passed;
                failedTests += stats.failed;
                hasFailure = true;
                logger.error(`Tests failed: ${command}`);
            }
        }
        const duration = Date.now() - startTime;
        if (hasFailure) {
            // Record test failure in phase tracking
            if (correlationId) {
                recordPhaseError(correlationId, 'evaluation', 'TESTS_FAILED');
                endPhase(correlationId, 'evaluation', false, {
                    operation: 'tests',
                    testsRun: totalTests,
                    testsPassed: passedTests,
                    testsFailed: failedTests,
                    duration,
                });
            }
            // Log operation failure
            const operationMetadata = finalizeOperationContext(operationContext, false, {
                testsRun: totalTests,
                testsPassed: passedTests,
                testsFailed: failedTests,
                duration,
            });
            logger.operationComplete('Tests', 'runTests', false, operationMetadata);
            return {
                success: false,
                output: combinedOutput,
                duration,
                testsRun: totalTests,
                testsPassed: passedTests,
                testsFailed: failedTests,
                error: `${failedTests} test(s) failed`,
            };
        }
        // End evaluation phase successfully
        if (correlationId) {
            endPhase(correlationId, 'evaluation', true, {
                operation: 'tests',
                testsRun: totalTests,
                testsPassed: passedTests,
                testsFailed: failedTests,
                duration,
            });
        }
        // Log operation completion with metrics
        const operationMetadata = finalizeOperationContext(operationContext, true, {
            testsRun: totalTests,
            testsPassed: passedTests,
            testsFailed: failedTests,
            duration,
        });
        logger.operationComplete('Tests', 'runTests', true, operationMetadata);
        logger.success(`Tests passed: ${passedTests}/${totalTests}`);
        return {
            success: true,
            output: combinedOutput,
            duration,
            testsRun: totalTests,
            testsPassed: passedTests,
            testsFailed: failedTests,
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        // Record error in phase tracking
        if (correlationId) {
            recordPhaseError(correlationId, 'evaluation', 'TEST_EXECUTION_ERROR');
            endPhase(correlationId, 'evaluation', false, {
                operation: 'tests',
                error: error.message,
                duration,
            });
        }
        // Log operation failure
        const operationMetadata = finalizeOperationContext(operationContext, false, {
            error: error.message,
            duration,
        });
        logger.operationComplete('Tests', 'runTests', false, operationMetadata);
        logger.error('Test execution failed', {
            error: error.message,
            correlationId,
            duration,
        });
        return {
            success: false,
            output: '',
            duration,
            testsRun: 0,
            testsPassed: 0,
            testsFailed: 0,
            error: error.message,
        };
    }
}
async function determineTestCommands(repoPath, packages) {
    const commands = [];
    // Check for root package.json
    const rootPackageJson = join(repoPath, 'package.json');
    const pkg = await loadPackageJson(rootPackageJson);
    if (pkg?.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        commands.push({
            command: 'npm test',
            cwd: repoPath,
        });
    }
    // If specific packages provided, add their test commands
    if (packages.length > 0) {
        for (const pkgPath of packages) {
            const fullPath = join(repoPath, pkgPath);
            const pkgJsonPath = join(fullPath, 'package.json');
            const subPkg = await loadPackageJson(pkgJsonPath);
            if (subPkg?.scripts?.test && subPkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
                commands.push({
                    command: 'npm test',
                    cwd: fullPath,
                });
            }
        }
    }
    return commands;
}
function parseTestOutput(output) {
    let total = 0;
    let passed = 0;
    let failed = 0;
    // Jest format: Tests:       X passed, Y failed, Z total
    const jestMatch = output.match(/Tests:\s+(\d+)\s+passed[^,]*(?:,\s+(\d+)\s+failed)?[^,]*,\s+(\d+)\s+total/i);
    if (jestMatch) {
        passed = parseInt(jestMatch[1], 10) || 0;
        failed = parseInt(jestMatch[2], 10) || 0;
        total = parseInt(jestMatch[3], 10) || 0;
        return { total, passed, failed };
    }
    // Vitest format: X passed (Y) | Z failed
    const vitestMatch = output.match(/(\d+)\s+passed.*\|\s*(\d+)\s+failed/i);
    if (vitestMatch) {
        passed = parseInt(vitestMatch[1], 10) || 0;
        failed = parseInt(vitestMatch[2], 10) || 0;
        total = passed + failed;
        return { total, passed, failed };
    }
    // Node.js built-in test runner TAP format (multiline summary)
    // Matches output like:
    //   # tests 3
    //   # pass 2
    //   # fail 1
    const nodeTapResult = parseNodeTestRunnerOutput(output);
    if (nodeTapResult) {
        return nodeTapResult;
    }
    // Generic TAP format: count "ok" and "not ok" lines
    // Matches TAP output like:
    //   ok 1 - test description
    //   not ok 2 - failing test
    const tapResult = parseTapOutput(output);
    if (tapResult.total > 0) {
        return tapResult;
    }
    // Mocha format: X passing, Y failing
    const mochaMatch = output.match(/(\d+)\s+passing[\s\S]*?(\d+)\s+failing/i);
    if (mochaMatch) {
        passed = parseInt(mochaMatch[1], 10) || 0;
        failed = parseInt(mochaMatch[2], 10) || 0;
        total = passed + failed;
        return { total, passed, failed };
    }
    // Mocha format (passing only): X passing
    const mochaPassOnlyMatch = output.match(/(\d+)\s+passing/i);
    if (mochaPassOnlyMatch && !output.match(/failing/i)) {
        passed = parseInt(mochaPassOnlyMatch[1], 10) || 0;
        total = passed;
        return { total, passed, failed: 0 };
    }
    // Generic: count ✓ and ✗ or PASS and FAIL
    const passMatches = output.match(/[✓✔]|PASS/g) || [];
    const failMatches = output.match(/[✗✘]|FAIL/g) || [];
    passed = passMatches.length;
    failed = failMatches.length;
    total = passed + failed;
    return { total, passed, failed };
}
/**
 * Parse Node.js built-in test runner output.
 * The Node.js test runner outputs TAP format with summary lines like:
 *   # tests 3
 *   # suites 1
 *   # pass 2
 *   # fail 1
 *   # cancelled 0
 *   # skipped 0
 *   # todo 0
 *   # duration_ms 55.52737
 */
function parseNodeTestRunnerOutput(output) {
    // Match individual summary lines - they appear on separate lines
    const testsMatch = output.match(/^# tests (\d+)/m);
    const passMatch = output.match(/^# pass (\d+)/m);
    const failMatch = output.match(/^# fail (\d+)/m);
    // If we find at least the tests and pass lines, consider it Node.js test runner output
    if (testsMatch && passMatch) {
        const total = parseInt(testsMatch[1], 10) || 0;
        const passed = parseInt(passMatch[1], 10) || 0;
        const failed = failMatch ? parseInt(failMatch[1], 10) || 0 : 0;
        return { total, passed, failed };
    }
    // Also support inline format: # tests X # pass Y # fail Z (backwards compatibility)
    const inlineMatch = output.match(/# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/i);
    if (inlineMatch) {
        return {
            total: parseInt(inlineMatch[1], 10) || 0,
            passed: parseInt(inlineMatch[2], 10) || 0,
            failed: parseInt(inlineMatch[3], 10) || 0,
        };
    }
    return null;
}
/**
 * Parse TAP (Test Anything Protocol) format output.
 * TAP uses "ok N" for passing tests and "not ok N" for failing tests.
 * Example:
 *   TAP version 13
 *   ok 1 - test description
 *   not ok 2 - failing test
 *   ok 3 - another passing test
 *   1..3
 */
function parseTapOutput(output) {
    // Look for TAP version header to confirm it's TAP output
    const isTapOutput = /^TAP version \d+/m.test(output);
    if (!isTapOutput) {
        // Check for TAP plan (1..N) as alternative indicator
        const hasTapPlan = /^\d+\.\.\d+/m.test(output);
        if (!hasTapPlan) {
            return { total: 0, passed: 0, failed: 0 };
        }
    }
    // Count top-level test results only (not indented subtests)
    // "ok N" at start of line = passed, "not ok N" at start of line = failed
    const lines = output.split('\n');
    let passed = 0;
    let failed = 0;
    for (const line of lines) {
        // Match top-level test results (not indented)
        // "ok N" or "ok N - description"
        if (/^ok \d+/.test(line)) {
            passed++;
        }
        // "not ok N" or "not ok N - description"
        else if (/^not ok \d+/.test(line)) {
            failed++;
        }
    }
    return { total: passed + failed, passed, failed };
}
//# sourceMappingURL=tests.js.map