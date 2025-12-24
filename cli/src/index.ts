#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { bootstrapServices } from '@webedt/shared';
import { dbCommand } from './commands/db.js';
import { claudeCommand } from './commands/claude.js';
import { githubCommand } from './commands/github.js';

async function main() {
  // Bootstrap all services (registers singletons with ServiceProvider)
  await bootstrapServices();

  const program = new Command();

  program
    .name('webedt')
    .description('CLI for WebEDT administration')
    .version('1.0.0');

  // Add command groups
  program.addCommand(dbCommand);
  program.addCommand(claudeCommand);
  program.addCommand(githubCommand);

  program.parse();
}

main().catch((error) => {
  console.error('CLI error:', error);
  process.exit(1);
});
