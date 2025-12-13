import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { TestError, ErrorCode, } from '../utils/errors.js';
/**
 * Get error context for test operations
 */
function getErrorContext(repoPath, command) {
    return {
        operation: 'test',
        component: 'TestEvaluator',
        repoPath,
        command,
    };
}
/**
 * Create a TestError with appropriate error code based on the failure
 */
function createTestError(message, output, repoPath, testsRun, testsPassed, testsFailed, command, exitCode, cause) {
    // Determine error code based on output patterns
    let code = ErrorCode.TEST_FAILED;
    if (output.includes('ETIMEDOUT') || output.includes('timed out') || output.includes('Exceeded timeout')) {
        code = ErrorCode.TEST_TIMEOUT;
    }
    else if (output.includes('Cannot find module') || output.includes('Module not found')) {
        code = ErrorCode.TEST_ENVIRONMENT_ERROR;
    }
    else if (output.includes('ECONNREFUSED') ||
        output.includes('Connection refused') ||
        output.includes('database')) {
        code = ErrorCode.TEST_ENVIRONMENT_ERROR;
    }
    else if (output.includes('Invalid configuration') ||
        output.includes('Configuration error') ||
        output.includes('jest.config')) {
        code = ErrorCode.TEST_CONFIG_INVALID;
    }
    return new TestError(code, message, {
        exitCode,
        testOutput: output,
        testsRun,
        testsPassed,
        testsFailed,
        command,
        repoPath,
        context: getErrorContext(repoPath, command),
        cause,
    });
}
export async function runTests(options) {
    const { repoPath, packages = [], timeout = 10 * 60 * 1000, testPattern } = options;
    const startTime = Date.now();
    logger.info('Running tests...');
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
        let lastCommand = '';
        for (const { command, cwd } of testCommands) {
            const fullCommand = testPattern ? `${command} -- --testPathPattern="${testPattern}"` : command;
            lastCommand = fullCommand;
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
                logger.error(`Tests failed: ${command}`, {
                    exitCode: execError.status,
                    testsRun: stats.total,
                    testsFailed: stats.failed,
                });
            }
        }
        if (hasFailure) {
            // Create structured error for test failures
            const structuredError = createTestError(`${failedTests} test(s) failed`, combinedOutput, repoPath, totalTests, passedTests, failedTests, lastCommand);
            // Log user-friendly error message
            logger.error(structuredError.getUserFriendlyMessage());
            return {
                success: false,
                output: combinedOutput,
                duration: Date.now() - startTime,
                testsRun: totalTests,
                testsPassed: passedTests,
                testsFailed: failedTests,
                error: `${failedTests} test(s) failed`,
                structuredError,
            };
        }
        logger.success(`Tests passed: ${passedTests}/${totalTests}`);
        return {
            success: true,
            output: combinedOutput,
            duration: Date.now() - startTime,
            testsRun: totalTests,
            testsPassed: passedTests,
            testsFailed: failedTests,
        };
    }
    catch (error) {
        // Handle timeout or other unexpected errors
        const isTimeout = error.message?.includes('ETIMEDOUT') || error.killed;
        const errorCode = isTimeout ? ErrorCode.TEST_TIMEOUT : ErrorCode.TEST_FAILED;
        const structuredError = new TestError(errorCode, isTimeout ? 'Test execution timed out' : `Test execution failed: ${error.message}`, {
            repoPath,
            testsRun: 0,
            testsPassed: 0,
            testsFailed: 0,
            context: getErrorContext(repoPath),
            cause: error,
        });
        logger.error('Test execution failed', {
            code: structuredError.code,
            message: structuredError.message,
        });
        return {
            success: false,
            output: '',
            duration: Date.now() - startTime,
            testsRun: 0,
            testsPassed: 0,
            testsFailed: 0,
            error: structuredError.message,
            structuredError,
        };
    }
}
async function determineTestCommands(repoPath, packages) {
    const commands = [];
    // Check for root package.json
    const rootPackageJson = join(repoPath, 'package.json');
    if (existsSync(rootPackageJson)) {
        try {
            const pkg = require(rootPackageJson);
            if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
                commands.push({
                    command: 'npm test',
                    cwd: repoPath,
                });
            }
        }
        catch {
            // Ignore JSON parse errors
        }
    }
    // If specific packages provided, add their test commands
    if (packages.length > 0) {
        for (const pkgPath of packages) {
            const fullPath = join(repoPath, pkgPath);
            const pkgJsonPath = join(fullPath, 'package.json');
            if (existsSync(pkgJsonPath)) {
                try {
                    const pkg = require(pkgJsonPath);
                    if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
                        commands.push({
                            command: 'npm test',
                            cwd: fullPath,
                        });
                    }
                }
                catch {
                    // Ignore
                }
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
    // Node test runner format: # tests X, # pass Y, # fail Z
    const nodeMatch = output.match(/# tests (\d+).*# pass (\d+).*# fail (\d+)/is);
    if (nodeMatch) {
        total = parseInt(nodeMatch[1], 10) || 0;
        passed = parseInt(nodeMatch[2], 10) || 0;
        failed = parseInt(nodeMatch[3], 10) || 0;
        return { total, passed, failed };
    }
    // Mocha format: X passing, Y failing
    const mochaMatch = output.match(/(\d+)\s+passing.*?(\d+)\s+failing/is);
    if (mochaMatch) {
        passed = parseInt(mochaMatch[1], 10) || 0;
        failed = parseInt(mochaMatch[2], 10) || 0;
        total = passed + failed;
        return { total, passed, failed };
    }
    // Generic: count ✓ and ✗ or PASS and FAIL
    const passMatches = output.match(/[✓✔]|PASS/g) || [];
    const failMatches = output.match(/[✗✘]|FAIL/g) || [];
    passed = passMatches.length;
    failed = failMatches.length;
    total = passed + failed;
    return { total, passed, failed };
}
//# sourceMappingURL=tests.js.map