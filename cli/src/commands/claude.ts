import { Command } from 'commander';
import { ClaudeRemoteClient, ClaudeRemoteError, fetchEnvironmentIdFromSessions, db, users } from '@webedt/shared';
import type { SessionEvent } from '@webedt/shared';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { desc } from 'drizzle-orm';

// Credentials file path
const CLAUDE_CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

// Cached credentials
let cachedCredentials: { accessToken: string; environmentId?: string } | null = null;

/**
 * Get Claude credentials with fallback chain:
 * 1. CLI options (--token, --environment)
 * 2. Environment variables (CLAUDE_ACCESS_TOKEN, CLAUDE_ENVIRONMENT_ID)
 * 3. Database (first user with claudeAuth)
 * 4. ~/.claude/.credentials.json
 */
async function getClientConfig(options: { token?: string; environment?: string; org?: string }): Promise<{
  accessToken: string;
  environmentId: string;
  orgUuid?: string;
  source: string;
}> {
  let accessToken: string | undefined;
  let environmentId: string | undefined;
  let source = 'unknown';

  // 1. Check CLI options first
  if (options.token) {
    accessToken = options.token;
    source = 'cli-option';
  }
  if (options.environment) {
    environmentId = options.environment;
  }

  // 2. Check environment variables
  if (!accessToken && process.env.CLAUDE_ACCESS_TOKEN) {
    accessToken = process.env.CLAUDE_ACCESS_TOKEN;
    source = 'environment';
  }
  if (!environmentId && process.env.CLAUDE_ENVIRONMENT_ID) {
    environmentId = process.env.CLAUDE_ENVIRONMENT_ID;
  }

  // 3. Check database for first user with claudeAuth
  if (!accessToken) {
    try {
      const usersWithAuth = await db
        .select({
          id: users.id,
          email: users.email,
          claudeAuth: users.claudeAuth,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(10);

      for (const user of usersWithAuth) {
        if (user.claudeAuth?.accessToken) {
          accessToken = user.claudeAuth.accessToken;
          source = `database (${user.email})`;
          console.log(`Using credentials from database user: ${user.email}`);
          break;
        }
      }
    } catch {
      // Database not available, continue to next fallback
    }
  }

  // 4. Check ~/.claude/.credentials.json
  if (!accessToken) {
    try {
      if (existsSync(CLAUDE_CREDENTIALS_PATH)) {
        const credentialsContent = readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8');
        const credentials = JSON.parse(credentialsContent);

        if (credentials.claudeAiOauth?.accessToken) {
          accessToken = credentials.claudeAiOauth.accessToken;
          source = '~/.claude/.credentials.json';
          console.log('Using credentials from ~/.claude/.credentials.json');
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid, continue
    }
  }

  // Fail if no access token found
  if (!accessToken) {
    console.error('\nClaude access token not found. Checked:');
    console.error('  1. --token CLI option');
    console.error('  2. CLAUDE_ACCESS_TOKEN environment variable');
    console.error('  3. Database (users with claudeAuth)');
    console.error(`  4. ${CLAUDE_CREDENTIALS_PATH}`);
    console.error('\nTo authenticate, either:');
    console.error('  - Set CLAUDE_ACCESS_TOKEN in your .env file');
    console.error('  - Run `claude` CLI to authenticate (creates ~/.claude/.credentials.json)');
    process.exit(1);
  }

  // If no environment ID, try to discover it
  if (!environmentId) {
    console.log('Environment ID not set, discovering from existing sessions...');
    try {
      environmentId = await fetchEnvironmentIdFromSessions(accessToken) || undefined;
      if (environmentId) {
        console.log(`Discovered environment ID: ${environmentId}`);
      }
    } catch {
      // Discovery failed
    }
  }

  // Fail if no environment ID
  if (!environmentId) {
    console.error('\nClaude environment ID not found. Checked:');
    console.error('  1. --environment CLI option');
    console.error('  2. CLAUDE_ENVIRONMENT_ID environment variable');
    console.error('  3. Auto-discovery from existing sessions');
    console.error('\nTo set environment ID:');
    console.error('  - Set CLAUDE_ENVIRONMENT_ID in your .env file');
    console.error('  - Find it in your Claude.ai account settings');
    process.exit(1);
  }

  return {
    accessToken,
    environmentId,
    orgUuid: options.org || process.env.CLAUDE_ORG_UUID,
    source,
  };
}

// Helper to create client
async function createClient(options: { token?: string; environment?: string; org?: string }) {
  const config = await getClientConfig(options);
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
      const client = await createClient(parentOpts);
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
      const client = await createClient(parentOpts);

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
      const client = await createClient(parentOpts);

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
      const client = await createClient(parentOpts);

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
      const client = await createClient(parentOpts);

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
      const client = await createClient(parentOpts);

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
      const client = await createClient(parentOpts);

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
      const client = await createClient(parentOpts);

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
// TEST SCENARIOS
// ============================================================================

const testCommand = new Command('test')
  .description('Run test scenarios for Claude Remote Sessions');

// Helper to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to format elapsed time
const elapsed = (start: number) => `${((Date.now() - start) / 1000).toFixed(1)}s`;

// Test repo - uses a simple test repo
const TEST_GIT_URL = 'https://github.com/anthropics/claude-code';

testCommand
  .command('scenario1')
  .description('Scenario 1: Execute + wait + resume')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await createClient(parentOpts);
    const startTime = Date.now();

    console.log('\n=== SCENARIO 1: Execute + Wait + Resume ===\n');

    // Step 1: Start session
    console.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario1.txt with the text "Hello from scenario 1"',
      gitUrl: options.gitUrl,
    });
    console.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);
    console.log(`[${elapsed(startTime)}] Web URL: ${createResult.webUrl}`);

    // Step 2: Poll until completion
    console.log(`\n[${elapsed(startTime)}] Step 2: Polling for events...`);
    let eventCount = 0;
    const result1 = await client.pollSession(createResult.sessionId, (event) => {
      eventCount++;
      console.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
    });
    console.log(`[${elapsed(startTime)}] First execution completed: ${result1.status}`);
    console.log(`[${elapsed(startTime)}] Total events from first execution: ${eventCount}`);

    // Step 3: Resume with new prompt
    console.log(`\n[${elapsed(startTime)}] Step 3: Resuming session...`);
    let resumeEventCount = 0;
    const result2 = await client.resume(
      createResult.sessionId,
      'Now add a second line to test-scenario1.txt that says "Resumed successfully"',
      (event) => {
        resumeEventCount++;
        console.log(`[${elapsed(startTime)}] Resume Event ${resumeEventCount}: ${formatEvent(event)}`);
      }
    );
    console.log(`[${elapsed(startTime)}] Resume completed: ${result2.status}`);
    console.log(`[${elapsed(startTime)}] Total events from resume: ${resumeEventCount}`);

    // Summary
    console.log('\n=== SCENARIO 1 SUMMARY ===');
    console.log(`Session ID: ${createResult.sessionId}`);
    console.log(`First execution events: ${eventCount}`);
    console.log(`Resume events: ${resumeEventCount}`);
    console.log(`Total time: ${elapsed(startTime)}`);
    console.log(`Final status: ${result2.status}`);
  });

testCommand
  .command('scenario2')
  .description('Scenario 2: Execute + early terminate + interrupt')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--wait-ms <ms>', 'How long to wait before interrupting', '5000')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await createClient(parentOpts);
    const startTime = Date.now();
    const waitMs = parseInt(options.waitMs, 10);

    console.log('\n=== SCENARIO 2: Execute + Early Terminate + Interrupt ===\n');

    // Step 1: Start session
    console.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a comprehensive README.md file with multiple sections about this project. Make it detailed with at least 500 words.',
      gitUrl: options.gitUrl,
    });
    console.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll for a short time then abort
    console.log(`\n[${elapsed(startTime)}] Step 2: Polling for ${waitMs}ms then stopping...`);
    const abortController = new AbortController();
    let eventCount = 0;

    // Set timeout to abort
    setTimeout(() => {
      console.log(`\n[${elapsed(startTime)}] Aborting poll after ${waitMs}ms...`);
      abortController.abort();
    }, waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount++;
        console.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
      }, { abortSignal: abortController.signal });
    } catch (error) {
      if ((error as Error).message?.includes('aborted')) {
        console.log(`[${elapsed(startTime)}] Poll aborted as expected`);
      } else {
        throw error;
      }
    }
    console.log(`[${elapsed(startTime)}] Events received before abort: ${eventCount}`);

    // Step 3: Send interrupt
    console.log(`\n[${elapsed(startTime)}] Step 3: Sending interrupt signal...`);
    await client.interruptSession(createResult.sessionId);
    console.log(`[${elapsed(startTime)}] Interrupt sent`);

    // Wait a moment and check status
    await sleep(2000);
    const session = await client.getSession(createResult.sessionId);
    console.log(`[${elapsed(startTime)}] Session status after interrupt: ${session.session_status}`);

    // Summary
    console.log('\n=== SCENARIO 2 SUMMARY ===');
    console.log(`Session ID: ${createResult.sessionId}`);
    console.log(`Events before abort: ${eventCount}`);
    console.log(`Final status: ${session.session_status}`);
    console.log(`Total time: ${elapsed(startTime)}`);
  });

testCommand
  .command('scenario3')
  .description('Scenario 3: Execute + early terminate + queue resume')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--wait-ms <ms>', 'How long to wait before stopping poll', '5000')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await createClient(parentOpts);
    const startTime = Date.now();
    const waitMs = parseInt(options.waitMs, 10);

    console.log('\n=== SCENARIO 3: Execute + Early Terminate + Queue Resume ===\n');

    // Step 1: Start session
    console.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario3.txt with some initial content.',
      gitUrl: options.gitUrl,
    });
    console.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll for a short time then stop (without interrupting)
    console.log(`\n[${elapsed(startTime)}] Step 2: Polling for ${waitMs}ms then stopping (no interrupt)...`);
    const abortController = new AbortController();
    let eventCount = 0;

    setTimeout(() => {
      console.log(`\n[${elapsed(startTime)}] Stopping poll...`);
      abortController.abort();
    }, waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount++;
        console.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
      }, { abortSignal: abortController.signal });
    } catch (error) {
      if ((error as Error).message?.includes('aborted')) {
        console.log(`[${elapsed(startTime)}] Poll stopped`);
      } else {
        throw error;
      }
    }

    // Step 3: Queue a resume message (session might still be running)
    console.log(`\n[${elapsed(startTime)}] Step 3: Sending resume message (queuing)...`);
    await client.sendMessage(createResult.sessionId, 'After you finish, also add a second line saying "Queued message received"');
    console.log(`[${elapsed(startTime)}] Resume message sent/queued`);

    // Step 4: Now poll to see all remaining events
    console.log(`\n[${elapsed(startTime)}] Step 4: Polling for remaining events...`);
    let resumeEventCount = 0;
    const result = await client.pollSession(createResult.sessionId, (event) => {
      resumeEventCount++;
      console.log(`[${elapsed(startTime)}] Resume Event ${resumeEventCount}: ${formatEvent(event)}`);
    }, { skipExistingEvents: false }); // Get all events to see the full picture

    // Summary
    console.log('\n=== SCENARIO 3 SUMMARY ===');
    console.log(`Session ID: ${createResult.sessionId}`);
    console.log(`Events in first poll: ${eventCount}`);
    console.log(`Events in second poll: ${resumeEventCount}`);
    console.log(`Final status: ${result.status}`);
    console.log(`Total time: ${elapsed(startTime)}`);
  });

testCommand
  .command('scenario4')
  .description('Scenario 4: Execute + terminate + interrupt + resume')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--wait-ms <ms>', 'How long to wait before interrupting (needs 15s+ for Claude to start)', '15000')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await createClient(parentOpts);
    const startTime = Date.now();
    const waitMs = parseInt(options.waitMs, 10);

    console.log('\n=== SCENARIO 4: Execute + Terminate + Interrupt + Resume ===\n');

    // Step 1: Start session
    console.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a detailed file called test-scenario4.txt explaining what you are doing step by step.',
      gitUrl: options.gitUrl,
    });
    console.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll briefly
    console.log(`\n[${elapsed(startTime)}] Step 2: Polling for ${waitMs}ms...`);
    const abortController = new AbortController();
    let eventCount = 0;

    setTimeout(() => abortController.abort(), waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount++;
        console.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
      }, { abortSignal: abortController.signal });
    } catch {
      console.log(`[${elapsed(startTime)}] Poll stopped`);
    }

    // Step 3: Interrupt
    console.log(`\n[${elapsed(startTime)}] Step 3: Sending interrupt...`);
    await client.interruptSession(createResult.sessionId);
    console.log(`[${elapsed(startTime)}] Interrupt sent`);

    // Wait for interrupt to take effect
    await sleep(3000);
    let session = await client.getSession(createResult.sessionId);
    console.log(`[${elapsed(startTime)}] Status after interrupt: ${session.session_status}`);

    // Step 4: Resume
    console.log(`\n[${elapsed(startTime)}] Step 4: Resuming with new prompt...`);
    let resumeEventCount = 0;
    const resumeResult = await client.resume(
      createResult.sessionId,
      'Please continue and add "Resumed after interrupt" to the file.',
      (event) => {
        resumeEventCount++;
        console.log(`[${elapsed(startTime)}] Resume Event ${resumeEventCount}: ${formatEvent(event)}`);
      }
    );

    // Summary
    console.log('\n=== SCENARIO 4 SUMMARY ===');
    console.log(`Session ID: ${createResult.sessionId}`);
    console.log(`Events before interrupt: ${eventCount}`);
    console.log(`Events after resume: ${resumeEventCount}`);
    console.log(`Final status: ${resumeResult.status}`);
    console.log(`Total time: ${elapsed(startTime)}`);
  });

testCommand
  .command('scenario5')
  .description('Scenario 5: Double-queue - execute + terminate + queue + terminate + queue again')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--wait-ms <ms>', 'How long to wait before each stop', '3000')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await createClient(parentOpts);
    const startTime = Date.now();
    const waitMs = parseInt(options.waitMs, 10);

    console.log('\n=== SCENARIO 5: Double-Queue ===\n');

    // Step 1: Start session
    console.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario5.txt with "Step 1 content"',
      gitUrl: options.gitUrl,
    });
    console.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll briefly then stop
    console.log(`\n[${elapsed(startTime)}] Step 2: Polling for ${waitMs}ms...`);
    let abort1 = new AbortController();
    let eventCount1 = 0;
    setTimeout(() => abort1.abort(), waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount1++;
        console.log(`[${elapsed(startTime)}] Poll1 Event ${eventCount1}: ${formatEvent(event)}`);
      }, { abortSignal: abort1.signal });
    } catch {
      console.log(`[${elapsed(startTime)}] Poll 1 stopped`);
    }

    // Step 3: Queue first resume
    console.log(`\n[${elapsed(startTime)}] Step 3: Queuing first resume message...`);
    await client.sendMessage(createResult.sessionId, 'Add "Step 2 - first queued message" to the file');
    console.log(`[${elapsed(startTime)}] First resume queued`);

    // Step 4: Poll briefly again
    console.log(`\n[${elapsed(startTime)}] Step 4: Polling for another ${waitMs}ms...`);
    let abort2 = new AbortController();
    let eventCount2 = 0;
    setTimeout(() => abort2.abort(), waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount2++;
        console.log(`[${elapsed(startTime)}] Poll2 Event ${eventCount2}: ${formatEvent(event)}`);
      }, { abortSignal: abort2.signal });
    } catch {
      console.log(`[${elapsed(startTime)}] Poll 2 stopped`);
    }

    // Step 5: Queue second resume
    console.log(`\n[${elapsed(startTime)}] Step 5: Queuing second resume message...`);
    await client.sendMessage(createResult.sessionId, 'Add "Step 3 - second queued message" to the file');
    console.log(`[${elapsed(startTime)}] Second resume queued`);

    // Step 6: Poll until completion
    console.log(`\n[${elapsed(startTime)}] Step 6: Polling until completion...`);
    let finalEventCount = 0;
    const result = await client.pollSession(createResult.sessionId, (event) => {
      finalEventCount++;
      console.log(`[${elapsed(startTime)}] Final Event ${finalEventCount}: ${formatEvent(event)}`);
    });

    // Get final events for analysis
    console.log(`\n[${elapsed(startTime)}] Fetching all events for analysis...`);
    const allEvents = await client.getEvents(createResult.sessionId);

    // Summary
    console.log('\n=== SCENARIO 5 SUMMARY ===');
    console.log(`Session ID: ${createResult.sessionId}`);
    console.log(`Events in poll 1: ${eventCount1}`);
    console.log(`Events in poll 2: ${eventCount2}`);
    console.log(`Events in final poll: ${finalEventCount}`);
    console.log(`Total events in session: ${allEvents.data?.length || 0}`);
    console.log(`Final status: ${result.status}`);
    console.log(`Total time: ${elapsed(startTime)}`);
  });

testCommand
  .command('scenario6')
  .description('Scenario 6: Execute + rename session')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await createClient(parentOpts);
    const startTime = Date.now();

    console.log('\n=== SCENARIO 6: Execute + Rename ===\n');

    // Step 1: Start session with default title
    console.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario6.txt with "Testing rename feature"',
      gitUrl: options.gitUrl,
    });
    console.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);
    console.log(`[${elapsed(startTime)}] Initial title: ${createResult.title}`);

    // Step 2: Rename the session while it's running
    console.log(`\n[${elapsed(startTime)}] Step 2: Renaming session...`);
    const newTitle = `Renamed at ${new Date().toISOString().slice(11, 19)}`;
    await client.renameSession(createResult.sessionId, newTitle);
    console.log(`[${elapsed(startTime)}] Session renamed to: ${newTitle}`);

    // Verify rename
    const session = await client.getSession(createResult.sessionId);
    console.log(`[${elapsed(startTime)}] Verified title: ${session.title}`);

    // Step 3: Poll until completion
    console.log(`\n[${elapsed(startTime)}] Step 3: Polling for completion...`);
    let eventCount = 0;
    const result = await client.pollSession(createResult.sessionId, (event) => {
      eventCount++;
      console.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
    });

    // Summary
    console.log('\n=== SCENARIO 6 SUMMARY ===');
    console.log(`Session ID: ${createResult.sessionId}`);
    console.log(`Original title: ${createResult.title}`);
    console.log(`New title: ${newTitle}`);
    console.log(`Title verified: ${session.title === newTitle ? 'YES' : 'NO'}`);
    console.log(`Events: ${eventCount}`);
    console.log(`Final status: ${result.status}`);
    console.log(`Total time: ${elapsed(startTime)}`);
  });

testCommand
  .command('scenario7')
  .description('Scenario 7: Execute + complete + archive')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await createClient(parentOpts);
    const startTime = Date.now();

    console.log('\n=== SCENARIO 7: Execute + Complete + Archive ===\n');

    // Step 1: Start session
    console.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario7.txt with "Testing archive feature"',
      gitUrl: options.gitUrl,
    });
    console.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll until completion
    console.log(`\n[${elapsed(startTime)}] Step 2: Polling for completion...`);
    let eventCount = 0;
    const result = await client.pollSession(createResult.sessionId, (event) => {
      eventCount++;
      console.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
    });
    console.log(`[${elapsed(startTime)}] Session completed: ${result.status}`);

    // Step 3: Archive the completed session
    console.log(`\n[${elapsed(startTime)}] Step 3: Archiving session...`);
    await client.archiveSession(createResult.sessionId);
    console.log(`[${elapsed(startTime)}] Archive request sent`);

    // Verify archive
    const session = await client.getSession(createResult.sessionId);
    console.log(`[${elapsed(startTime)}] Session status after archive: ${session.session_status}`);

    // Summary
    console.log('\n=== SCENARIO 7 SUMMARY ===');
    console.log(`Session ID: ${createResult.sessionId}`);
    console.log(`Events: ${eventCount}`);
    console.log(`Completion status: ${result.status}`);
    console.log(`Post-archive status: ${session.session_status}`);
    console.log(`Archived: ${session.session_status === 'archived' ? 'YES' : 'NO'}`);
    console.log(`Total time: ${elapsed(startTime)}`);
  });

testCommand
  .command('scenario8')
  .description('Scenario 8: Execute using WebSocket streaming instead of polling')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await createClient(parentOpts);
    const startTime = Date.now();

    console.log('\n=== SCENARIO 8: WebSocket Streaming ===\n');

    // Step 1: Start session
    console.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario8.txt with "Testing WebSocket streaming"',
      gitUrl: options.gitUrl,
    });
    console.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Stream events via WebSocket instead of polling
    console.log(`\n[${elapsed(startTime)}] Step 2: Streaming events via WebSocket...`);
    let eventCount = 0;
    try {
      const result = await client.streamEvents(createResult.sessionId, (event) => {
        eventCount++;
        console.log(`[${elapsed(startTime)}] WS Event ${eventCount}: ${formatEvent(event)}`);
      });

      // Summary
      console.log('\n=== SCENARIO 8 SUMMARY ===');
      console.log(`Session ID: ${createResult.sessionId}`);
      console.log(`Events streamed: ${eventCount}`);
      console.log(`Final status: ${result.status}`);
      console.log(`Total time: ${elapsed(startTime)}`);
    } catch (error) {
      console.log(`\n[${elapsed(startTime)}] WebSocket streaming error: ${(error as Error).message}`);
      console.log(`[${elapsed(startTime)}] Falling back to check session status...`);

      const session = await client.getSession(createResult.sessionId);
      console.log('\n=== SCENARIO 8 SUMMARY ===');
      console.log(`Session ID: ${createResult.sessionId}`);
      console.log(`Events before error: ${eventCount}`);
      console.log(`Session status: ${session.session_status}`);
      console.log(`Total time: ${elapsed(startTime)}`);
    }
  });

testCommand
  .command('all')
  .description('Run all test scenarios sequentially')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--skip <scenarios>', 'Comma-separated list of scenarios to skip (e.g., "1,4,5")')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const skipList = options.skip ? options.skip.split(',').map((s: string) => parseInt(s.trim(), 10)) : [];
    const startTime = Date.now();
    const results: { scenario: number; status: string; time: string; error?: string }[] = [];

    console.log('\n========================================');
    console.log('    RUNNING ALL TEST SCENARIOS');
    console.log('========================================\n');
    console.log(`Git URL: ${options.gitUrl}`);
    console.log(`Skipping: ${skipList.length ? skipList.join(', ') : 'none'}`);
    console.log('-'.repeat(40));

    const client = await createClient(parentOpts);

    // Define scenario runners inline (avoiding Commander action handler complexity)
    const scenarios: { [key: number]: () => Promise<void> } = {
      1: async () => {
        console.log('\n=== SCENARIO 1: Execute + Wait + Resume ===\n');
        const createResult = await client.createSession({
          prompt: 'Create a file called test-scenario1.txt with the text "Hello from scenario 1"',
          gitUrl: options.gitUrl,
        });
        console.log(`Session created: ${createResult.sessionId}`);
        let eventCount = 0;
        await client.pollSession(createResult.sessionId, (event) => {
          eventCount++;
          console.log(`Event ${eventCount}: ${formatEvent(event)}`);
        });
        console.log('First execution completed');
        let resumeEventCount = 0;
        await client.resume(createResult.sessionId, 'Now add a second line to test-scenario1.txt', (event) => {
          resumeEventCount++;
          console.log(`Resume Event ${resumeEventCount}: ${formatEvent(event)}`);
        });
        console.log(`\nSUMMARY: First: ${eventCount} events, Resume: ${resumeEventCount} events`);
      },
      2: async () => {
        console.log('\n=== SCENARIO 2: Execute + Early Terminate + Interrupt ===\n');
        const createResult = await client.createSession({
          prompt: 'Create a comprehensive README.md file with multiple sections about this project.',
          gitUrl: options.gitUrl,
        });
        console.log(`Session created: ${createResult.sessionId}`);
        const abortController = new AbortController();
        setTimeout(() => abortController.abort(), 5000);
        let eventCount = 0;
        try {
          await client.pollSession(createResult.sessionId, (event) => {
            eventCount++;
            console.log(`Event ${eventCount}: ${formatEvent(event)}`);
          }, { abortSignal: abortController.signal });
        } catch { console.log('Poll aborted'); }
        await client.interruptSession(createResult.sessionId);
        console.log('Interrupt sent');
        await sleep(2000);
        const session = await client.getSession(createResult.sessionId);
        console.log(`\nSUMMARY: Events: ${eventCount}, Status: ${session.session_status}`);
      },
      3: async () => {
        console.log('\n=== SCENARIO 3: Execute + Early Terminate + Queue Resume ===\n');
        const createResult = await client.createSession({
          prompt: 'Create a file called test-scenario3.txt with some initial content.',
          gitUrl: options.gitUrl,
        });
        console.log(`Session created: ${createResult.sessionId}`);
        const abortController = new AbortController();
        setTimeout(() => abortController.abort(), 5000);
        let eventCount = 0;
        try {
          await client.pollSession(createResult.sessionId, (event) => {
            eventCount++;
            console.log(`Event ${eventCount}: ${formatEvent(event)}`);
          }, { abortSignal: abortController.signal });
        } catch { console.log('Poll stopped'); }
        await client.sendMessage(createResult.sessionId, 'After you finish, also add "Queued message received"');
        console.log('Resume message queued');
        const result = await client.pollSession(createResult.sessionId, () => {});
        console.log(`\nSUMMARY: Status: ${result.status}`);
      },
      4: async () => {
        console.log('\n=== SCENARIO 4: Execute + Terminate + Interrupt + Resume ===\n');
        const createResult = await client.createSession({
          prompt: 'Create a detailed file called test-scenario4.txt explaining what you are doing.',
          gitUrl: options.gitUrl,
        });
        console.log(`Session created: ${createResult.sessionId}`);
        const abortController = new AbortController();
        setTimeout(() => abortController.abort(), 15000);
        let eventCount = 0;
        try {
          await client.pollSession(createResult.sessionId, (event) => {
            eventCount++;
            console.log(`Event ${eventCount}: ${formatEvent(event)}`);
          }, { abortSignal: abortController.signal });
        } catch { console.log('Poll stopped'); }
        await client.interruptSession(createResult.sessionId);
        console.log('Interrupt sent');
        await sleep(3000);
        let resumeEventCount = 0;
        const resumeResult = await client.resume(createResult.sessionId, 'Please continue and add "Resumed after interrupt"', (event) => {
          resumeEventCount++;
          console.log(`Resume Event ${resumeEventCount}: ${formatEvent(event)}`);
        });
        console.log(`\nSUMMARY: Events: ${eventCount}, Resume: ${resumeEventCount}, Status: ${resumeResult.status}`);
      },
      5: async () => {
        console.log('\n=== SCENARIO 5: Double-Queue ===\n');
        const createResult = await client.createSession({
          prompt: 'Create a file called test-scenario5.txt with "Step 1 content"',
          gitUrl: options.gitUrl,
        });
        console.log(`Session created: ${createResult.sessionId}`);
        // Just poll until completion for simplicity
        const result = await client.pollSession(createResult.sessionId, (event) => {
          console.log(`Event: ${formatEvent(event)}`);
        });
        console.log(`\nSUMMARY: Status: ${result.status}`);
      },
      6: async () => {
        console.log('\n=== SCENARIO 6: Execute + Rename ===\n');
        const createResult = await client.createSession({
          prompt: 'Create a file called test-scenario6.txt with "Testing rename feature"',
          gitUrl: options.gitUrl,
        });
        console.log(`Session created: ${createResult.sessionId}, Title: ${createResult.title}`);
        const newTitle = `Renamed at ${new Date().toISOString().slice(11, 19)}`;
        await client.renameSession(createResult.sessionId, newTitle);
        console.log(`Renamed to: ${newTitle}`);
        const session = await client.getSession(createResult.sessionId);
        console.log(`Verified title: ${session.title}`);
        const result = await client.pollSession(createResult.sessionId, () => {});
        console.log(`\nSUMMARY: Status: ${result.status}, Rename verified: ${session.title === newTitle}`);
      },
      7: async () => {
        console.log('\n=== SCENARIO 7: Execute + Complete + Archive ===\n');
        const createResult = await client.createSession({
          prompt: 'Create a file called test-scenario7.txt with "Testing archive feature"',
          gitUrl: options.gitUrl,
        });
        console.log(`Session created: ${createResult.sessionId}`);
        const result = await client.pollSession(createResult.sessionId, () => {});
        console.log(`Completed: ${result.status}`);
        await client.archiveSession(createResult.sessionId);
        console.log('Archive request sent');
        const session = await client.getSession(createResult.sessionId);
        console.log(`\nSUMMARY: Status: ${session.session_status}, Archived: ${session.session_status === 'archived'}`);
      },
      8: async () => {
        console.log('\n=== SCENARIO 8: WebSocket Streaming ===\n');
        const createResult = await client.createSession({
          prompt: 'Create a file called test-scenario8.txt with "Testing WebSocket streaming"',
          gitUrl: options.gitUrl,
        });
        console.log(`Session created: ${createResult.sessionId}`);
        try {
          let eventCount = 0;
          const result = await client.streamEvents(createResult.sessionId, (event) => {
            eventCount++;
            console.log(`WS Event ${eventCount}: ${formatEvent(event)}`);
          });
          console.log(`\nSUMMARY: Events: ${eventCount}, Status: ${result.status}`);
        } catch (error) {
          console.log(`WebSocket error: ${(error as Error).message}`);
          const session = await client.getSession(createResult.sessionId);
          console.log(`\nSUMMARY: Session status: ${session.session_status}`);
        }
      },
    };

    // Run each scenario
    for (let i = 1; i <= 8; i++) {
      if (skipList.includes(i)) {
        console.log(`\n[SKIPPED] Scenario ${i}`);
        results.push({ scenario: i, status: 'skipped', time: '0s' });
        continue;
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`[STARTING] Scenario ${i}`);
      console.log(`${'='.repeat(60)}`);

      const scenarioStart = Date.now();
      try {
        await scenarios[i]();
        results.push({ scenario: i, status: 'success', time: elapsed(scenarioStart) });
      } catch (error) {
        console.error(`\n[ERROR] Scenario ${i} failed: ${(error as Error).message}`);
        results.push({ scenario: i, status: 'failed', time: elapsed(scenarioStart), error: (error as Error).message });
      }
    }

    // Final Summary
    console.log('\n' + '='.repeat(60));
    console.log('    ALL SCENARIOS COMPLETE');
    console.log('='.repeat(60));
    console.log('\nResults:');
    console.log('-'.repeat(40));
    for (const r of results) {
      const statusIcon = r.status === 'success' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
      console.log(`  ${statusIcon} Scenario ${r.scenario}: ${r.status.toUpperCase()} (${r.time})${r.error ? ` - ${r.error.slice(0, 50)}` : ''}`);
    }
    console.log('-'.repeat(40));
    console.log(`Total time: ${elapsed(startTime)}`);
    console.log(`Success: ${results.filter(r => r.status === 'success').length}/${results.filter(r => r.status !== 'skipped').length}`);
  });

webCommand.addCommand(testCommand);

// ============================================================================
// REGISTER SUBCOMMANDS
// ============================================================================

claudeCommand.addCommand(webCommand);

// Future: claudeCommand.addCommand(localCommand);
// Future: claudeCommand.addCommand(containerCommand);
