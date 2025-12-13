import { runBuild } from './build.js';
import { runTests } from './tests.js';
import { runHealthChecks, generatePreviewUrl } from './health.js';
import { logger, getCorrelationId, createOperationContext, finalizeOperationContext, startPhase, endPhase, recordPhaseError, } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
export { runBuild, runTypeCheck, BuildCache, getBuildCache, initBuildCache } from './build.js';
export { runTests } from './tests.js';
export { runHealthChecks, generatePreviewUrl } from './health.js';
export async function runEvaluation(options) {
    const startTime = Date.now();
    const { repoPath, branchName, config, repoInfo } = options;
    const repository = `${repoInfo.owner}/${repoInfo.repo}`;
    const correlationId = getCorrelationId();
    // Start evaluation phase if tracking
    if (correlationId) {
        startPhase(correlationId, 'evaluation', {
            repository,
            branchName,
            requireBuild: config.requireBuild,
            requireTests: config.requireTests,
            requireHealthCheck: config.requireHealthCheck,
        });
    }
    // Create operation context for structured logging
    const operationContext = createOperationContext('Evaluation', 'runEvaluation', {
        repository,
        branchName,
        repoPath,
    });
    logger.header('Running Evaluation Pipeline');
    logger.info('Starting evaluation', {
        repository,
        branchName,
        correlationId,
        requireBuild: config.requireBuild,
        requireTests: config.requireTests,
        requireHealthCheck: config.requireHealthCheck,
    });
    const result = {
        success: true,
        duration: 0,
        summary: '',
    };
    const summaryParts = [];
    // Step 1: Build verification
    if (config.requireBuild) {
        logger.step(1, 3, 'Build verification');
        result.build = await runBuild({ repoPath });
        // Record build metrics
        metrics.recordBuild(result.build.success, result.build.duration, { repository });
        if (!result.build.success) {
            result.success = false;
            summaryParts.push(`❌ Build failed: ${result.build.error}`);
            // Record error
            metrics.recordError({
                repository,
                component: 'Evaluation',
                operation: 'build',
                errorCode: 'BUILD_FAILED',
                severity: 'error',
            });
        }
        else {
            summaryParts.push(`✅ Build passed (${result.build.duration}ms)`);
        }
    }
    else {
        summaryParts.push('⏭️ Build skipped');
    }
    // Step 2: Tests (only if build passed)
    if (config.requireTests && result.success) {
        logger.step(2, 3, 'Running tests');
        result.tests = await runTests({ repoPath });
        // Record test metrics
        metrics.recordTests(result.tests.success, result.tests.duration, { repository });
        if (!result.tests.success) {
            result.success = false;
            summaryParts.push(`❌ Tests failed: ${result.tests.testsFailed}/${result.tests.testsRun} failed`);
            // Record error
            metrics.recordError({
                repository,
                component: 'Evaluation',
                operation: 'tests',
                errorCode: 'TESTS_FAILED',
                severity: 'error',
            });
        }
        else {
            summaryParts.push(`✅ Tests passed: ${result.tests.testsPassed}/${result.tests.testsRun}`);
        }
    }
    else if (!config.requireTests) {
        summaryParts.push('⏭️ Tests skipped');
    }
    else {
        summaryParts.push('⏭️ Tests skipped (build failed)');
    }
    // Step 3: Health checks (only if tests passed)
    if (config.requireHealthCheck && result.success) {
        logger.step(3, 3, 'Health checks');
        // Generate health check URLs
        const urls = [...config.healthCheckUrls];
        // Add preview URL if pattern is configured
        if (config.previewUrlPattern) {
            const previewUrl = generatePreviewUrl(config.previewUrlPattern, {
                owner: repoInfo.owner,
                repo: repoInfo.repo,
                branch: branchName,
            });
            urls.push(previewUrl);
        }
        if (urls.length > 0) {
            result.health = await runHealthChecks({ urls });
            if (!result.health.success) {
                result.success = false;
                const failedCount = result.health.checks.filter((c) => !c.ok).length;
                summaryParts.push(`❌ Health checks failed: ${failedCount}/${result.health.checks.length}`);
            }
            else {
                summaryParts.push(`✅ Health checks passed: ${result.health.checks.length}/${result.health.checks.length}`);
            }
        }
        else {
            summaryParts.push('⏭️ Health checks skipped (no URLs configured)');
        }
    }
    else if (!config.requireHealthCheck) {
        summaryParts.push('⏭️ Health checks skipped');
    }
    else {
        summaryParts.push('⏭️ Health checks skipped (previous step failed)');
    }
    result.duration = Date.now() - startTime;
    result.summary = summaryParts.join('\n');
    // End evaluation phase
    if (correlationId) {
        if (result.success) {
            endPhase(correlationId, 'evaluation', true, {
                duration: result.duration,
                buildSuccess: result.build?.success,
                testsSuccess: result.tests?.success,
                healthSuccess: result.health?.success,
            });
        }
        else {
            recordPhaseError(correlationId, 'evaluation', 'EVALUATION_FAILED');
            endPhase(correlationId, 'evaluation', false, {
                duration: result.duration,
                buildSuccess: result.build?.success,
                testsSuccess: result.tests?.success,
                healthSuccess: result.health?.success,
            });
        }
    }
    // Log operation completion with metrics
    const operationMetadata = finalizeOperationContext(operationContext, result.success, {
        duration: result.duration,
        buildDuration: result.build?.duration,
        testsDuration: result.tests?.duration,
        healthDuration: result.health?.duration,
        testsRun: result.tests?.testsRun,
        testsPassed: result.tests?.testsPassed,
    });
    logger.operationComplete('Evaluation', 'runEvaluation', result.success, operationMetadata);
    logger.divider();
    logger.info(`Evaluation ${result.success ? 'PASSED' : 'FAILED'} in ${result.duration}ms`, {
        success: result.success,
        duration: result.duration,
        repository,
        branchName,
        correlationId,
    });
    console.log(result.summary);
    return result;
}
//# sourceMappingURL=index.js.map