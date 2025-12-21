#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { sessionCommand } from './commands/session.js';
import { githubCommand } from './commands/github.js';
import { adminCommand } from './commands/admin.js';

const program = new Command();

program
  .name('webedt')
  .description('CLI for WebEDT administration')
  .version('1.0.0');

// Add commands
program.addCommand(sessionCommand);
program.addCommand(githubCommand);
program.addCommand(adminCommand);

program.parse();
