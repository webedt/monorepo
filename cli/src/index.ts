#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { dbCommand } from './commands/db.js';
import { claudeCommand } from './commands/claude.js';
import { githubCommand } from './commands/github.js';

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
