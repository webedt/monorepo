#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { bootstrapServices } from '@webedt/shared';
import { authCommand } from './commands/auth.js';
import { claudeCommand } from './commands/claude.js';
import { dbCommand } from './commands/db.js';
import { githubCommand } from './commands/github.js';
import { llmCommand } from './commands/llm.js';
import { sessionsCommand } from './commands/sessions.js';
import { usersCommand } from './commands/users.js';

async function main() {
  // Bootstrap all services (registers singletons with ServiceProvider)
  await bootstrapServices();

  const program = new Command();

  program
    .name('webedt')
    .description('CLI for WebEDT administration')
    .version('1.0.0');

  // Add command groups
  program.addCommand(authCommand);
  program.addCommand(claudeCommand);
  program.addCommand(dbCommand);
  program.addCommand(githubCommand);
  program.addCommand(llmCommand);
  program.addCommand(sessionsCommand);
  program.addCommand(usersCommand);

  program.parse();
}

main().catch((error) => {
  console.error('CLI error:', error);
  process.exit(1);
});
