import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
export async function runBuild(options) {
    const { repoPath, packages = [], timeout = 5 * 60 * 1000 } = options;
    const startTime = Date.now();
    logger.info('Running build verification...');
    try {
        // Determine build commands based on project structure
        const buildCommands = await determineBuildCommands(repoPath, packages);
        if (buildCommands.length === 0) {
            logger.warn('No build commands found');
            return {
                success: true,
                output: 'No build configuration found, skipping build',
                duration: Date.now() - startTime,
            };
        }
        let combinedOutput = '';
        for (const { command, cwd } of buildCommands) {
            logger.info(`Running: ${command} in ${cwd}`);
            try {
                const output = execSync(command, {
                    cwd,
                    timeout,
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        CI: 'true',
                        NODE_ENV: 'production',
                    },
                });
                combinedOutput += `\n=== ${command} ===\n${output}`;
            }
            catch (execError) {
                const stderr = execError.stderr?.toString() || '';
                const stdout = execError.stdout?.toString() || '';
                logger.error(`Build failed: ${command}`, { stderr, stdout });
                return {
                    success: false,
                    output: `${combinedOutput}\n=== ${command} (FAILED) ===\n${stdout}\n${stderr}`,
                    duration: Date.now() - startTime,
                    error: `Build command failed: ${command}`,
                };
            }
        }
        logger.success('Build completed successfully');
        return {
            success: true,
            output: combinedOutput,
            duration: Date.now() - startTime,
        };
    }
    catch (error) {
        logger.error('Build verification failed', { error: error.message });
        return {
            success: false,
            output: '',
            duration: Date.now() - startTime,
            error: error.message,
        };
    }
}
async function determineBuildCommands(repoPath, packages) {
    const commands = [];
    // Check for root package.json
    const rootPackageJson = join(repoPath, 'package.json');
    if (existsSync(rootPackageJson)) {
        try {
            const pkg = require(rootPackageJson);
            // Check if it's a monorepo with workspaces
            const hasWorkspaces = pkg.workspaces && pkg.workspaces.length > 0;
            if (hasWorkspaces && pkg.scripts?.build) {
                // Monorepo with root build script (e.g., turbo, nx, lerna)
                commands.push({
                    command: 'npm run build',
                    cwd: repoPath,
                });
            }
            else if (pkg.scripts?.build) {
                // Simple project with build script
                commands.push({
                    command: 'npm run build',
                    cwd: repoPath,
                });
            }
            // Check for TypeScript
            if (existsSync(join(repoPath, 'tsconfig.json')) && !pkg.scripts?.build) {
                commands.push({
                    command: 'npx tsc --noEmit',
                    cwd: repoPath,
                });
            }
        }
        catch {
            // Ignore JSON parse errors
        }
    }
    // If specific packages provided, add their build commands
    if (packages.length > 0) {
        for (const pkgPath of packages) {
            const fullPath = join(repoPath, pkgPath);
            const pkgJsonPath = join(fullPath, 'package.json');
            if (existsSync(pkgJsonPath)) {
                try {
                    const pkg = require(pkgJsonPath);
                    if (pkg.scripts?.build) {
                        commands.push({
                            command: 'npm run build',
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
// Type-check only (faster than full build)
export async function runTypeCheck(repoPath) {
    const startTime = Date.now();
    logger.info('Running TypeScript type check...');
    // Find tsconfig
    const tsconfigPath = join(repoPath, 'tsconfig.json');
    if (!existsSync(tsconfigPath)) {
        return {
            success: true,
            output: 'No tsconfig.json found, skipping type check',
            duration: Date.now() - startTime,
        };
    }
    try {
        const output = execSync('npx tsc --noEmit', {
            cwd: repoPath,
            encoding: 'utf-8',
            timeout: 3 * 60 * 1000, // 3 minutes
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        logger.success('Type check passed');
        return {
            success: true,
            output,
            duration: Date.now() - startTime,
        };
    }
    catch (error) {
        const stderr = error.stderr?.toString() || '';
        const stdout = error.stdout?.toString() || '';
        logger.error('Type check failed');
        return {
            success: false,
            output: `${stdout}\n${stderr}`,
            duration: Date.now() - startTime,
            error: 'TypeScript type check failed',
        };
    }
}
//# sourceMappingURL=build.js.map