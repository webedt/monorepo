import { Command } from 'commander';
import { storageService } from '../../logic/storage/storageService.js';

export const storageCommand = new Command('storage')
  .description('Storage operations');

storageCommand
  .command('list')
  .description('List all sessions in storage')
  .action(async () => {
    try {
      const sessions = await storageService.listSessions();

      if (sessions.length === 0) {
        console.log('No sessions found in storage.');
        return;
      }

      console.log('\nSessions in storage:');
      console.log('-'.repeat(80));

      for (const session of sessions) {
        console.log(`  ${session.sessionPath} (${session.lastModified || 'N/A'})`);
      }

      console.log('-'.repeat(80));
      console.log(`Total: ${sessions.length} session(s)`);
    } catch (error) {
      console.error('Error listing sessions:', error);
      process.exit(1);
    }
  });

storageCommand
  .command('files <sessionPath>')
  .description('List files in a session')
  .action(async (sessionPath) => {
    try {
      const files = await storageService.listSessionFiles(sessionPath);

      if (files.length === 0) {
        console.log('No files found.');
        return;
      }

      console.log(`\nFiles in ${sessionPath}:`);
      console.log('-'.repeat(80));

      for (const file of files) {
        const sizeKB = file.size ? (file.size / 1024).toFixed(2) : '0';
        console.log(`  ${file.path.padEnd(50)} ${sizeKB.padStart(10)} KB`);
      }

      console.log('-'.repeat(80));
      console.log(`Total: ${files.length} file(s)`);
    } catch (error) {
      console.error('Error listing files:', error);
      process.exit(1);
    }
  });

storageCommand
  .command('read <sessionPath> <filePath>')
  .description('Read a file from storage')
  .action(async (sessionPath, filePath) => {
    try {
      const result = await storageService.getSessionFile(sessionPath, filePath);

      if (result === null) {
        console.error('File not found.');
        process.exit(1);
      }

      // Output file content (as string if text, otherwise note it's binary)
      if (result.mimeType.startsWith('text/') || result.mimeType === 'application/json') {
        console.log(result.content.toString('utf-8'));
      } else {
        console.log(`Binary file (${result.mimeType}), ${result.content.length} bytes`);
      }
    } catch (error) {
      console.error('Error reading file:', error);
      process.exit(1);
    }
  });

storageCommand
  .command('delete-session <sessionPath>')
  .description('Delete a session from storage')
  .option('-f, --force', 'Skip confirmation')
  .action(async (sessionPath, options) => {
    try {
      if (!options.force) {
        console.log(`\nAbout to delete session: ${sessionPath}`);
        console.log('Use --force to confirm deletion.');
        process.exit(0);
      }

      await storageService.deleteSession(sessionPath);
      console.log(`Session '${sessionPath}' deleted from storage.`);
    } catch (error) {
      console.error('Error deleting session:', error);
      process.exit(1);
    }
  });

storageCommand
  .command('exists <sessionPath>')
  .description('Check if a session exists in storage')
  .action(async (sessionPath) => {
    try {
      const exists = await storageService.sessionExists(sessionPath);
      console.log(exists ? 'Session exists.' : 'Session does not exist.');
      process.exit(exists ? 0 : 1);
    } catch (error) {
      console.error('Error checking session:', error);
      process.exit(1);
    }
  });
