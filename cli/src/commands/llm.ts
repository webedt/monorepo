import { Command } from 'commander';

export const llmCommand = new Command('llm')
  .description('One-off LLM requests (no session persistence)');

llmCommand
  .command('execute <prompt>')
  .description('Execute a one-off LLM request')
  .option('-m, --model <model>', 'Model to use (default: auto-select)')
  .option('--json', 'Output as JSON')
  .action(async (prompt, options) => {
    try {
      // Import dynamically to avoid circular deps
      const { ALlm, ServiceProvider } = await import('@webedt/shared');

      const llm = ServiceProvider.get(ALlm);

      if (!options.json) {
        console.log(`Executing prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
        console.log('-'.repeat(80));
      }

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
