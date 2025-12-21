import { Command } from 'commander';
import { ClaudeRemoteClient, ClaudeRemoteError, fetchEnvironmentIdFromSessions } from '@webedt/shared';
import type { SessionEvent } from '@webedt/shared';

// Helper to get client configuration from env/options
function getClientConfig(options: { token?: string; environment?: string; org?: string }) {
  const accessToken = options.token || process.env.CLAUDE_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('Claude access token required. Use --token or set CLAUDE_ACCESS_TOKEN env.');
    process.exit(1);
  }

  const environmentId = options.environment || process.env.CLAUDE_ENVIRONMENT_ID;
  if (!environmentId) {
    console.error('Claude environment ID required. Use --environment or set CLAUDE_ENVIRONMENT_ID env.');
    console.error('You can find this in your Claude.ai account settings.');
    process.exit(1);
  }

  return {
    accessToken,
    environmentId,
    orgUuid: options.org || process.env.CLAUDE_ORG_UUID,
  };
}

// Helper to create client
function createClient(options: { token?: string; environment?: string; org?: string }) {
  const config = getClientConfig(options);
  return new ClaudeRemoteClient(config);
}

// Format event for display
function formatEvent(event: SessionEvent): string {
  const type = event.type || 'unknown';
  const timestamp = new Date().toISOString().slice(11, 19);

  switch (type) {
    case 'user':
      return `[${timestamp}] USER: ${getMessagePreview(event)}`;
    case 'assistant':
      return `[${timestamp}] ASSISTANT: ${getMessagePreview(event)}`;
    case 'tool_use':
      const toolName = (event as { tool_name?: string }).tool_name || 'unknown';
      return `[${timestamp}] TOOL: ${toolName}`;
    case 'tool_result':
      return `[${timestamp}] RESULT: (tool completed)`;
    case 'result':
      const cost = (event as { total_cost_usd?: number }).total_cost_usd;
      const duration = (event as { duration_ms?: number }).duration_ms;
      return `[${timestamp}] COMPLETED: $${cost?.toFixed(4) || '?'} | ${Math.round((duration || 0) / 1000)}s`;
    default:
      return `[${timestamp}] ${type.toUpperCase()}`;
  }
}

function getMessagePreview(event: SessionEvent): string {
  const message = (event as { message?: { content?: string | Array<{ type: string; text?: string }> } }).message;
  if (!message?.content) return '(no content)';

  if (typeof message.content === 'string') {
    return message.content.slice(0, 80).replace(/\n/g, ' ');
  }

  // Handle content blocks
  const textBlock = message.content.find(b => b.type === 'text');
  return textBlock?.text?.slice(0, 80).replace(/\n/g, ' ') || '(no text)';
}

// ============================================================================
// MAIN CLAUDE COMMAND
// ============================================================================

export const claudeCommand = new Command('claude')
  .description('Claude execution environments');

// ============================================================================
// WEB SUBGROUP (Claude Remote Sessions API)
// ============================================================================

const webCommand = new Command('web')
  .description('Claude Remote Sessions (cloud-based execution)')
  .option('-t, --token <token>', 'Claude access token (or set CLAUDE_ACCESS_TOKEN env)')
  .option('-e, --environment <id>', 'Claude environment ID (or set CLAUDE_ENVIRONMENT_ID env)')
  .option('-o, --org <uuid>', 'Organization UUID (or set CLAUDE_ORG_UUID env)');

webCommand
  .command('list')
  .description('List remote sessions from Anthropic API')
  .option('-l, --limit <number>', 'Limit number of results', '20')
  .action(async (options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = createClient(parentOpts);
      const limit = parseInt(options.limit, 10);

      const response = await client.listSessions(limit);
      const sessions = response.data || [];

      if (sessions.length === 0) {
        console.log('No remote sessions found.');
        return;
      }

      console.log('\nRemote Sessions (from Anthropic API):');
      console.log('-'.repeat(120));
      console.log(
        'ID'.padEnd(40) +
        'Title'.padEnd(40) +
        'Status'.padEnd(15) +
        'Created'.padEnd(25)
      );
      console.log('-'.repeat(120));

      for (const session of sessions) {
        const created = session.created_at ? new Date(session.created_at).toISOString().slice(0, 19) : 'N/A';
        const title = (session.title || '').slice(0, 38);
        console.log(
          (session.id || '').padEnd(40) +
          title.padEnd(40) +
          (session.session_status || 'unknown').padEnd(15) +
          created.padEnd(25)
        );
      }

      console.log('-'.repeat(120));
      console.log(`Total: ${sessions.length} session(s)${response.has_more ? ' (more available)' : ''}`);
    } catch (error) {
      if (error instanceof ClaudeRemoteError) {
        console.error(`API Error: ${error.message}`);
      } else {
        console.error('Error listing sessions:', error);
      }
      process.exit(1);
    }
  });

webCommand
  .command('get <sessionId>')
  .description('Get details of a remote session')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = createClient(parentOpts);

      const session = await client.getSession(sessionId);

      console.log('\nRemote Session Details:');
      console.log('-'.repeat(60));
      console.log(`ID:           ${session.id}`);
      console.log(`Title:        ${session.title || 'N/A'}`);
      console.log(`Status:       ${session.session_status}`);
      console.log(`Environment:  ${session.environment_id}`);
      console.log(`Created:      ${session.created_at}`);
      console.log(`Updated:      ${session.updated_at || 'N/A'}`);
      console.log(`Web URL:      https://claude.ai/code/${session.id}`);
      console.log('-'.repeat(60));
    } catch (error) {
      if (error instanceof ClaudeRemoteError) {
        console.error(`API Error: ${error.message}`);
      } else {
        console.error('Error getting session:', error);
      }
      process.exit(1);
    }
  });

webCommand
  .command('events <sessionId>')
  .description('Get events for a remote session')
  .option('--json', 'Output as JSON')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = createClient(parentOpts);

      const response = await client.getEvents(sessionId);
      const events = response.data || [];

      if (options.json) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }

      if (events.length === 0) {
        console.log('No events found for this session.');
        return;
      }

      console.log(`\nEvents for session ${sessionId}:`);
      console.log('-'.repeat(100));

      for (const event of events) {
        console.log(formatEvent(event));
      }

      console.log('-'.repeat(100));
      console.log(`Total: ${events.length} event(s)`);
    } catch (error) {
      if (error instanceof ClaudeRemoteError) {
        console.error(`API Error: ${error.message}`);
      } else {
        console.error('Error getting events:', error);
      }
      process.exit(1);
    }
  });

webCommand
  .command('execute <gitUrl> <prompt>')
  .description('Execute a coding task on a GitHub repository')
  .option('-m, --model <model>', 'Model to use', 'claude-sonnet-4-20250514')
  .option('-b, --branch-prefix <prefix>', 'Branch prefix (default: claude/{prompt-words})')
  .option('--title <title>', 'Session title')
  .option('--quiet', 'Only show final result, not streaming events')
  .action(async (gitUrl, prompt, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = createClient(parentOpts);

      console.log(`\nCreating session for: ${gitUrl}`);
      console.log(`Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
      console.log('-'.repeat(80));

      const result = await client.execute(
        {
          prompt,
          gitUrl,
          model: options.model,
          branchPrefix: options.branchPrefix,
          title: options.title,
        },
        (event) => {
          if (!options.quiet) {
            console.log(formatEvent(event));
          }
        }
      );

      console.log('-'.repeat(80));
      console.log('\nResult:');
      console.log(`  Session ID: ${result.sessionId}`);
      console.log(`  Status:     ${result.status}`);
      console.log(`  Title:      ${result.title || 'N/A'}`);
      console.log(`  Branch:     ${result.branch || 'N/A'}`);
      console.log(`  Cost:       $${result.totalCost?.toFixed(4) || 'N/A'}`);
      console.log(`  Duration:   ${result.durationMs ? Math.round(result.durationMs / 1000) + 's' : 'N/A'}`);
      console.log(`  Web URL:    https://claude.ai/code/${result.sessionId}`);
    } catch (error) {
      if (error instanceof ClaudeRemoteError) {
        console.error(`API Error: ${error.message}`);
      } else {
        console.error('Error executing session:', error);
      }
      process.exit(1);
    }
  });

webCommand
  .command('resume <sessionId> <message>')
  .description('Send a follow-up message to an existing session')
  .option('--quiet', 'Only show final result, not streaming events')
  .action(async (sessionId, message, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = createClient(parentOpts);

      console.log(`\nResuming session: ${sessionId}`);
      console.log(`Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);
      console.log('-'.repeat(80));

      const result = await client.resume(
        sessionId,
        message,
        (event) => {
          if (!options.quiet) {
            console.log(formatEvent(event));
          }
        }
      );

      console.log('-'.repeat(80));
      console.log('\nResult:');
      console.log(`  Status:     ${result.status}`);
      console.log(`  Branch:     ${result.branch || 'N/A'}`);
      console.log(`  Cost:       $${result.totalCost?.toFixed(4) || 'N/A'}`);
      console.log(`  Duration:   ${result.durationMs ? Math.round(result.durationMs / 1000) + 's' : 'N/A'}`);
    } catch (error) {
      if (error instanceof ClaudeRemoteError) {
        console.error(`API Error: ${error.message}`);
      } else {
        console.error('Error resuming session:', error);
      }
      process.exit(1);
    }
  });

webCommand
  .command('archive <sessionId>')
  .description('Archive a remote session')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = createClient(parentOpts);

      await client.archiveSession(sessionId);
      console.log(`Session ${sessionId} archived successfully.`);
    } catch (error) {
      if (error instanceof ClaudeRemoteError) {
        console.error(`API Error: ${error.message}`);
      } else {
        console.error('Error archiving session:', error);
      }
      process.exit(1);
    }
  });

webCommand
  .command('rename <sessionId> <newTitle>')
  .description('Rename a remote session')
  .action(async (sessionId, newTitle, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = createClient(parentOpts);

      await client.renameSession(sessionId, newTitle);
      console.log(`Session ${sessionId} renamed to "${newTitle}".`);
    } catch (error) {
      if (error instanceof ClaudeRemoteError) {
        console.error(`API Error: ${error.message}`);
      } else {
        console.error('Error renaming session:', error);
      }
      process.exit(1);
    }
  });

webCommand
  .command('interrupt <sessionId>')
  .description('Interrupt a running session')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = createClient(parentOpts);

      await client.interruptSession(sessionId);
      console.log(`Interrupt signal sent to session ${sessionId}.`);
    } catch (error) {
      if (error instanceof ClaudeRemoteError) {
        console.error(`API Error: ${error.message}`);
      } else {
        console.error('Error interrupting session:', error);
      }
      process.exit(1);
    }
  });

webCommand
  .command('discover-env')
  .description('Discover your environment ID from existing sessions')
  .action(async (options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const accessToken = parentOpts.token || process.env.CLAUDE_ACCESS_TOKEN;

      if (!accessToken) {
        console.error('Claude access token required. Use --token or set CLAUDE_ACCESS_TOKEN env.');
        process.exit(1);
      }

      console.log('Discovering environment ID from your sessions...');

      const envId = await fetchEnvironmentIdFromSessions(accessToken);

      if (envId) {
        console.log(`\nEnvironment ID found: ${envId}`);
        console.log('\nAdd this to your .env file:');
        console.log(`  CLAUDE_ENVIRONMENT_ID=${envId}`);
      } else {
        console.log('\nNo environment ID found. You may not have any existing sessions.');
        console.log('You can find your environment ID in your Claude.ai account settings.');
      }
    } catch (error) {
      console.error('Error discovering environment ID:', error);
      process.exit(1);
    }
  });

// ============================================================================
// REGISTER SUBCOMMANDS
// ============================================================================

claudeCommand.addCommand(webCommand);

// Future: claudeCommand.addCommand(localCommand);
// Future: claudeCommand.addCommand(containerCommand);
