/**
 * LLM CLI Command
 * One-off LLM requests (no session persistence)
 *
 * Uses constructor injection pattern for better testability.
 * Services can be injected via factory functions instead of ServiceProvider.get().
 */

import { Command } from 'commander';
import { createLazyServiceContainer } from '@webedt/shared';

import type { LlmCliServices } from '@webedt/shared';

// =============================================================================
// Command Factory (Recommended Pattern)
// =============================================================================

/**
 * Create the LLM command with injected services.
 *
 * This factory function enables proper unit testing by accepting
 * services as parameters instead of using ServiceProvider.get().
 *
 * @param services - LLM CLI services container
 * @returns Commander command for LLM operations
 *
 * @example
 * ```typescript
 * // In production
 * const container = createServiceContainer();
 * const command = createLlmCommand(container);
 * program.addCommand(command);
 *
 * // In tests
 * const mockContainer = createMockServiceContainer({
 *   llm: mockLlm,
 *   logger: mockLogger,
 * });
 * const command = createLlmCommand(mockContainer);
 * ```
 */
export function createLlmCommand(services: LlmCliServices): Command {
  const { llm } = services;

  const command = new Command('llm')
    .description('One-off LLM requests (no session persistence)');

  command
    .command('execute <prompt>')
    .description('Execute a one-off LLM request')
    .option('-m, --model <model>', 'Model to use (default: auto-select)')
    .option('--json', 'Output as JSON')
    .action(async (prompt, options) => {
      try {
        if (!options.json) {
          console.log(`Executing prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
          console.log('-'.repeat(80));
        }

        // Use injected service instead of ServiceProvider.get()
        const result = await llm.execute({
          prompt,
          model: options.model,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log('\nResult:');
        console.log('-'.repeat(80));
        console.log(result.content);
        console.log('-'.repeat(80));
        console.log(`Provider: ${result.provider}`);
        console.log(`Model: ${result.model}`);
        if (result.cost) {
          console.log(`Cost: $${result.cost.toFixed(6)}`);
        }
      } catch (error) {
        console.error('Error executing LLM request:', error);
        process.exit(1);
      }
    });

  return command;
}

// =============================================================================
// Default Export (Backward Compatibility)
// =============================================================================

/**
 * Default LLM command using lazy service container.
 *
 * For new code, prefer using createLlmCommand() with explicit
 * service injection for better testability.
 *
 * @deprecated Use createLlmCommand() for new code
 */
const lazyContainer = createLazyServiceContainer();
export const llmCommand = createLlmCommand({
  llm: lazyContainer.llm,
  logger: lazyContainer.logger,
});
