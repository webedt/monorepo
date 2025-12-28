#!/usr/bin/env node
/**
 * Auto-Task CLI
 * Automated task discovery and GitHub Projects management
 */

import { Command } from 'commander';
import { discoverCommand } from './commands/discover.js';
import { syncCommand } from './commands/sync.js';
import { statusCommand } from './commands/status.js';
import { daemonCommand } from './commands/daemon.js';

const program = new Command();

program
  .name('auto-task')
  .description('Automated task discovery and GitHub Projects management')
  .version('1.0.0');

program.addCommand(discoverCommand);
program.addCommand(syncCommand);
program.addCommand(statusCommand);
program.addCommand(daemonCommand);

program.parse();
