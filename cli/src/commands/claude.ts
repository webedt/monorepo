import { Command } from 'commander';
import { ClaudeRemoteError, fetchEnvironmentIdFromSessions, ServiceProvider, AClaudeWebClient, AEventFormatter, getClaudeCredentials } from '@webedt/shared';
import { handleCommandError } from '../utils/errorHandler.js';

import type { ClaudeSessionEvent as SessionEvent } from '@webedt/shared';

/**
 * Verbose mode utilities for CLI output
 */
interface VerboseState {
  enabled: boolean;
  startTime: number;
  operationStack: string[];
}

const verboseState: VerboseState = {
  enabled: false,
  startTime: 0,
  operationStack: [],
};

function setVerbose(enabled: boolean): void {
  verboseState.enabled = enabled;
  if (enabled) {
    verboseState.startTime = Date.now();
    console.log('\n[VERBOSE] Verbose mode enabled - showing detailed output');
    console.log(`[VERBOSE] Timestamp: ${new Date().toISOString()}`);
    console.log('[VERBOSE] Process ID:', process.pid);
    console.log('[VERBOSE] Node version:', process.version);
    console.log('');
  }
}

function verboseElapsed(): string {
  return `${((Date.now() - verboseState.startTime) / 1000).toFixed(3)}s`;
}

function verboseLog(...args: unknown[]): void {
  if (verboseState.enabled) {
    console.log(`[${verboseElapsed()}]`, ...args);
  }
}

function verboseError(...args: unknown[]): void {
  if (verboseState.enabled) {
    console.error(`[${verboseElapsed()}] [ERROR]`, ...args);
  }
}

function startOperation(name: string): void {
  if (verboseState.enabled) {
    verboseState.operationStack.push(name);
    console.log(`[${verboseElapsed()}] [START] ${name}`);
  }
}

function endOperation(name: string, success: boolean = true): void {
  if (verboseState.enabled) {
    const status = success ? 'OK' : 'FAIL';
    console.log(`[${verboseElapsed()}] [END] ${name} [${status}]`);
    const idx = verboseState.operationStack.indexOf(name);
    if (idx !== -1) verboseState.operationStack.splice(idx, 1);
  }
}

/**
 * Get Claude client configuration with fallback chain for credentials.
 * Uses shared getClaudeCredentials() for token retrieval.
 */
async function getClientConfig(options: { token?: string; environment?: string; org?: string; silent?: boolean }): Promise<{
  accessToken: string;
  environmentId: string;
  orgUuid?: string;
  source: string;
}> {
  const log = options.silent ? () => {} : console.log.bind(console);

  // Get credentials using shared function
  const credentials = await getClaudeCredentials({
    accessToken: options.token,
    checkDatabase: true,
  });

  if (!credentials) {
    console.error('\nClaude access token not found. Checked:');
    console.error('  1. --token CLI option');
    console.error('  2. CLAUDE_ACCESS_TOKEN environment variable');
    console.error('  3. ~/.claude/.credentials.json');
    console.error('  4. macOS Keychain (Claude Code-credentials)');
    console.error('  5. Database (users with claudeAuth)');
    console.error('\nTo authenticate, either:');
    console.error('  - Set CLAUDE_ACCESS_TOKEN in your .env file');
    console.error('  - Run `claude` CLI to authenticate (creates ~/.claude/.credentials.json)');
    process.exit(1);
  }

  const accessToken = credentials.accessToken;
  const source = credentials.source || 'unknown';

  // Log source for user visibility
  if (source === 'credentials-file') {
    log('Using credentials from ~/.claude/.credentials.json');
  } else if (source === 'keychain') {
    log('Using credentials from macOS Keychain');
  } else if (source === 'database') {
    log('Using credentials from database');
  }

  // Get environment ID from options or env var
  let environmentId = options.environment || process.env.CLAUDE_ENVIRONMENT_ID;

  // If no environment ID, try to discover it
  if (!environmentId) {
    log('Environment ID not set, discovering from existing sessions...');
    try {
      environmentId = await fetchEnvironmentIdFromSessions(accessToken) || undefined;
      if (environmentId) {
        log(`Discovered environment ID: ${environmentId}`);
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

// Helper to get and configure client
async function getClient(options: { token?: string; environment?: string; org?: string; silent?: boolean }): Promise<AClaudeWebClient> {
  const config = await getClientConfig(options);
  const client = ServiceProvider.get(AClaudeWebClient);
  client.configure({
    accessToken: config.accessToken,
    environmentId: config.environmentId,
  });
  return client;
}

// Format event for display using the shared EventFormatter service
function formatEvent(event: SessionEvent): string {
  const formatter = ServiceProvider.get(AEventFormatter);
  return formatter.formatEvent(event as Record<string, unknown>);
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
  .option('-o, --org <uuid>', 'Organization UUID (or set CLAUDE_ORG_UUID env)')
  .option('-v, --verbose', 'Enable verbose output with detailed timing and debugging info')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerbose(true);
    }
  });

webCommand
  .command('list')
  .description('List remote sessions from Anthropic API')
  .option('-l, --limit <number>', 'Limit number of results', '20')
  .option('--today', 'Only show sessions created today')
  .option('--json', 'Output as JSON')
  .action(async (options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};

      startOperation('list-sessions');
      verboseLog('Fetching sessions with limit:', options.limit);

      const client = await getClient({ ...parentOpts, silent: options.json });
      const limit = parseInt(options.limit, 10);

      const fetchStart = Date.now();
      const response = await client.listSessions(limit);
      verboseLog('API response time:', Date.now() - fetchStart, 'ms');
      verboseLog('Sessions returned:', response.data?.length || 0);
      verboseLog('Has more:', response.has_more);

      let sessions = response.data || [];

      // Filter to today's sessions if requested
      if (options.today) {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const beforeFilter = sessions.length;
        sessions = sessions.filter(s => s.created_at?.startsWith(today));
        verboseLog(`Filtered to today's sessions: ${beforeFilter} -> ${sessions.length}`);
      }

      endOperation('list-sessions');

      if (options.json) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }

      if (sessions.length === 0) {
        console.log(options.today ? 'No sessions found for today.' : 'No remote sessions found.');
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
      console.log(`Total: ${sessions.length} session(s)${response.has_more && !options.today ? ' (more available)' : ''}`);

      // Verbose summary
      verboseLog('\n[VERBOSE] Session Statistics:');
      const statusCounts: Record<string, number> = {};
      for (const s of sessions) {
        const status = s.session_status || 'unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        verboseLog(`  ${status}: ${count}`);
      }
    } catch (error) {
      endOperation('list-sessions', false);
      verboseError('Failed to list sessions:', error);
      handleCommandError(error, 'listing sessions', { json: options.json });
    }
  });

webCommand
  .command('get <sessionId>')
  .description('Get details of a remote session')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

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
      handleCommandError(error, 'getting session');
    }
  });

webCommand
  .command('events <sessionId>')
  .description('Get events for a remote session')
  .option('--json', 'Output as JSON')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

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
        const formatted = formatEvent(event);
        if (formatted) console.log(formatted);
      }

      console.log('-'.repeat(100));
      console.log(`Total: ${events.length} event(s)`);
    } catch (error) {
      handleCommandError(error, 'getting events', { json: options.json });
    }
  });

webCommand
  .command('execute <gitUrl> <prompt>')
  .description('Execute a coding task on a GitHub repository')
  .option('-m, --model <model>', 'Model to use', 'claude-sonnet-4-20250514')
  .option('-b, --branch-prefix <prefix>', 'Branch prefix (default: claude/{prompt-words})')
  .option('--title <title>', 'Session title')
  .option('--quiet', 'Only show final result, not streaming events')
  .option('--json', 'Output raw JSON result instead of formatted text')
  .option('--jsonl', 'Stream events as JSON Lines (one JSON object per line)')
  .option('--raw', 'Stream raw WebSocket frames before any processing')
  .action(async (gitUrl, prompt, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const silent = options.json || options.jsonl || options.raw;

      // Suppress console output when --json, --jsonl, or --raw is used
      const log = silent ? () => {} : console.log.bind(console);

      startOperation('get-client');
      verboseLog('Initializing Claude client...');
      verboseLog('Options:', JSON.stringify({ ...parentOpts, token: parentOpts.token ? '***' : undefined }, null, 2));
      const client = await getClient({ ...parentOpts, silent });
      endOperation('get-client');

      log(`\nCreating session for: ${gitUrl}`);
      log(`Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
      log('-'.repeat(80));

      verboseLog('Git URL:', gitUrl);
      verboseLog('Full Prompt Length:', prompt.length, 'characters');
      verboseLog('Model:', options.model);
      verboseLog('Branch Prefix:', options.branchPrefix || 'default');
      verboseLog('Title:', options.title || 'auto-generated');

      // Collect the raw result event for --json output
      let rawResultEvent: SessionEvent | null = null;
      let eventCount = 0;
      const eventStartTime = Date.now();

      startOperation('execute-session');
      const result = await client.execute(
        {
          prompt,
          gitUrl,
          model: options.model,
          branchPrefix: options.branchPrefix,
          title: options.title,
        },
        (event) => {
          eventCount++;
          verboseLog(`Event #${eventCount}:`, event.type, event.type === 'tool_use' ? `(${(event as any).name})` : '');

          if (options.jsonl) {
            console.log(JSON.stringify(event));
          } else if (!options.quiet && !options.json && !options.raw) {
            const formatted = formatEvent(event);
            if (formatted) console.log(formatted);
          }
          // Capture the raw result event
          if (event.type === 'result') {
            rawResultEvent = event;
          }
        },
        {
          onRawMessage: options.raw ? (data: string) => console.log(data) : undefined,
        }
      );
      endOperation('execute-session');

      verboseLog('Total events received:', eventCount);
      verboseLog('Event stream duration:', Date.now() - eventStartTime, 'ms');

      if (options.jsonl || options.raw) {
        return;
      }

      if (options.json) {
        // Output raw result event if available, otherwise fall back to processed result
        console.log(JSON.stringify(rawResultEvent || result, null, 2));
        return;
      }

      console.log('-'.repeat(80));
      console.log('\nResult:');
      console.log(`  Session ID: ${result.sessionId}`);
      console.log(`  Status:     ${result.status}`);
      console.log(`  Title:      ${result.title || 'N/A'}`);
      console.log(`  Branch:     ${result.branch || 'N/A'}`);
      console.log(`  Cost:       $${result.totalCost?.toFixed(4) || 'N/A'}`);
      console.log(`  Duration:   ${result.durationMs ? Math.round(result.durationMs / 1000) + 's' : 'N/A'}`);
      console.log(`  Web URL:    https://claude.ai/code/${result.sessionId}`);

      // Verbose summary
      verboseLog('\n[VERBOSE] Execution Summary:');
      verboseLog('  Input tokens:', (result as any).inputTokens || 'N/A');
      verboseLog('  Output tokens:', (result as any).outputTokens || 'N/A');
      verboseLog('  Total events:', eventCount);
      verboseLog('  Session created at:', (result as any).createdAt || 'N/A');
    } catch (error) {
      verboseError('Execution failed:', error);
      handleCommandError(error, 'executing session', { json: options.json });
    }
  });

webCommand
  .command('resume <sessionId> <message>')
  .description('Send a follow-up message to an existing session')
  .option('--quiet', 'Only show final result, not streaming events')
  .action(async (sessionId, message, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

      console.log(`\nResuming session: ${sessionId}`);
      console.log(`Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);
      console.log('-'.repeat(80));

      const result = await client.resume(
        sessionId,
        message,
        (event) => {
          if (!options.quiet) {
            const formatted = formatEvent(event);
            if (formatted) console.log(formatted);
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
      handleCommandError(error, 'resuming session');
    }
  });

webCommand
  .command('archive [sessionIds...]')
  .description('Archive one or more remote sessions')
  .option('--today', 'Archive all sessions created today')
  .option('--all', 'Archive all sessions (use with caution)')
  .option('-l, --limit <number>', 'Limit for --today/--all', '100')
  .action(async (sessionIds, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

      let idsToArchive: string[] = sessionIds || [];

      // If --today or --all, fetch sessions and get their IDs
      if (options.today || options.all) {
        const limit = parseInt(options.limit, 10);
        const response = await client.listSessions(limit);
        let sessions = response.data || [];

        if (options.today) {
          const today = new Date().toISOString().slice(0, 10);
          sessions = sessions.filter(s => s.created_at?.startsWith(today));
        }

        // Filter out already archived sessions
        sessions = sessions.filter(s => s.session_status !== 'archived');
        idsToArchive = sessions.map(s => s.id).filter((id): id is string => !!id);

        if (idsToArchive.length === 0) {
          console.log(options.today ? 'No unarchived sessions found for today.' : 'No unarchived sessions found.');
          return;
        }

        console.log(`Found ${idsToArchive.length} session(s) to archive.`);
      }

      if (idsToArchive.length === 0) {
        console.error('No session IDs provided. Use session IDs, --today, or --all.');
        process.exit(1);
      }

      let archived = 0;
      let failed = 0;

      for (const id of idsToArchive) {
        try {
          await client.archiveSession(id);
          console.log(`Archived: ${id}`);
          archived++;
        } catch (error) {
          const msg = error instanceof ClaudeRemoteError ? error.message : String(error);
          console.error(`Failed to archive ${id}: ${msg}`);
          failed++;
        }
      }

      console.log(`\nDone. Archived: ${archived}, Failed: ${failed}`);
    } catch (error) {
      handleCommandError(error, 'archiving sessions');
    }
  });

webCommand
  .command('rename <sessionId> <newTitle>')
  .description('Rename a remote session')
  .action(async (sessionId, newTitle, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

      await client.renameSession(sessionId, newTitle);
      console.log(`Session ${sessionId} renamed to "${newTitle}".`);
    } catch (error) {
      handleCommandError(error, 'renaming session');
    }
  });

webCommand
  .command('interrupt <sessionId>')
  .description('Interrupt a running session')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

      await client.interruptSession(sessionId);
      console.log(`Interrupt signal sent to session ${sessionId}.`);
    } catch (error) {
      handleCommandError(error, 'interrupting session');
    }
  });

webCommand
  .command('can-resume <sessionId>')
  .description('Check if a session can be resumed')
  .option('--check-events', 'Also check if session has a completed event')
  .option('--json', 'Output as JSON')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

      const result = await client.canResume(sessionId, options.checkEvents);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`\nSession ${sessionId}:`);
      console.log(`  Can Resume: ${result.canResume ? 'Yes' : 'No'}`);
      console.log(`  Status:     ${result.status || 'unknown'}`);
      if (result.reason) {
        console.log(`  Reason:     ${result.reason}`);
      }
      if (result.hasCompletedEvent !== undefined) {
        console.log(`  Completed:  ${result.hasCompletedEvent ? 'Yes' : 'No'}`);
      }
    } catch (error) {
      handleCommandError(error, 'checking session', { json: options.json });
    }
  });

webCommand
  .command('is-complete <sessionId>')
  .description('Check if a session is complete (single API call by default)')
  .option('--check-events', 'Also check for result event (makes additional API call)')
  .option('--json', 'Output as JSON')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

      const result = await client.isComplete(sessionId, options.checkEvents);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`\nSession ${sessionId}:`);
      console.log(`  Complete:     ${result.isComplete ? 'Yes' : 'No'}`);
      console.log(`  Status:       ${result.status}`);
      if (result.hasResultEvent !== undefined) {
        console.log(`  Has Result:   ${result.hasResultEvent ? 'Yes' : 'No'}`);
      }
    } catch (error) {
      handleCommandError(error, 'checking session', { json: options.json });
    }
  });

webCommand
  .command('send <sessionId> <message>')
  .description('Send a message to a session (fire-and-forget, does not wait for response)')
  .action(async (sessionId, message, _options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

      await client.sendMessage(sessionId, message);
      console.log(`Message sent to session ${sessionId}.`);
    } catch (error) {
      handleCommandError(error, 'sending message');
    }
  });

webCommand
  .command('set-permission <sessionId>')
  .description('Set permission mode for a session')
  .option('--mode <mode>', 'Permission mode: acceptEdits or requireApproval', 'acceptEdits')
  .action(async (sessionId, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.opts() || {};
      const client = await getClient(parentOpts);

      const mode = options.mode as 'acceptEdits' | 'requireApproval';
      if (mode !== 'acceptEdits' && mode !== 'requireApproval') {
        console.error('Invalid mode. Use: acceptEdits or requireApproval');
        process.exit(1);
      }

      await client.setPermissionMode(sessionId, mode);
      console.log(`Permission mode set to '${mode}' for session ${sessionId}.`);
    } catch (error) {
      handleCommandError(error, 'setting permission mode');
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

// Helper type for test output options
interface TestOutputOptions {
  json?: boolean;
  jsonl?: boolean;
}

// Helper to create a logger based on output options
function createTestLogger(options: TestOutputOptions) {
  const silent = options.json || options.jsonl;
  return {
    log: silent ? () => {} : console.log.bind(console),
    event: (event: SessionEvent) => {
      if (options.jsonl) {
        console.log(JSON.stringify(event));
      }
    },
    json: (data: unknown) => {
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      }
    },
    silent,
  };
}

testCommand
  .command('scenario1')
  .description('Scenario 1: Execute + wait + resume')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await getClient(parentOpts);
    const startTime = Date.now();
    const logger = createTestLogger(options);

    logger.log('\n=== SCENARIO 1: Execute + Wait + Resume ===\n');

    // Step 1: Start session
    logger.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario1.txt with the text "Hello from scenario 1"',
      gitUrl: options.gitUrl,
    });
    logger.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);
    logger.log(`[${elapsed(startTime)}] Web URL: ${createResult.webUrl}`);

    // Step 2: Poll until completion
    logger.log(`\n[${elapsed(startTime)}] Step 2: Polling for events...`);
    let eventCount = 0;
    const result1 = await client.pollSession(createResult.sessionId, (event) => {
      eventCount++;
      logger.event(event);
      logger.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
    });
    logger.log(`[${elapsed(startTime)}] First execution completed: ${result1.status}`);
    logger.log(`[${elapsed(startTime)}] Total events from first execution: ${eventCount}`);

    // Step 3: Resume with new prompt
    logger.log(`\n[${elapsed(startTime)}] Step 3: Resuming session...`);
    let resumeEventCount = 0;
    const result2 = await client.resume(
      createResult.sessionId,
      'Now add a second line to test-scenario1.txt that says "Resumed successfully"',
      (event) => {
        resumeEventCount++;
        logger.event(event);
        logger.log(`[${elapsed(startTime)}] Resume Event ${resumeEventCount}: ${formatEvent(event)}`);
      }
    );
    logger.log(`[${elapsed(startTime)}] Resume completed: ${result2.status}`);
    logger.log(`[${elapsed(startTime)}] Total events from resume: ${resumeEventCount}`);

    // Summary
    logger.log('\n=== SCENARIO 1 SUMMARY ===');
    logger.log(`Session ID: ${createResult.sessionId}`);
    logger.log(`First execution events: ${eventCount}`);
    logger.log(`Resume events: ${resumeEventCount}`);
    logger.log(`Total time: ${elapsed(startTime)}`);
    logger.log(`Final status: ${result2.status}`);

    // JSON output
    logger.json({
      scenario: 1,
      sessionId: createResult.sessionId,
      webUrl: createResult.webUrl,
      firstExecutionEvents: eventCount,
      resumeEvents: resumeEventCount,
      totalTimeMs: Date.now() - startTime,
      finalStatus: result2.status,
    });
  });

testCommand
  .command('scenario2')
  .description('Scenario 2: Execute + early terminate + interrupt')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--wait-ms <ms>', 'How long to wait before interrupting', '5000')
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await getClient(parentOpts);
    const startTime = Date.now();
    const waitMs = parseInt(options.waitMs, 10);
    const logger = createTestLogger(options);

    logger.log('\n=== SCENARIO 2: Execute + Early Terminate + Interrupt ===\n');

    // Step 1: Start session
    logger.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a comprehensive README.md file with multiple sections about this project. Make it detailed with at least 500 words.',
      gitUrl: options.gitUrl,
    });
    logger.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll for a short time then abort
    logger.log(`\n[${elapsed(startTime)}] Step 2: Polling for ${waitMs}ms then stopping...`);
    const abortController = new AbortController();
    let eventCount = 0;

    // Set timeout to abort
    setTimeout(() => {
      logger.log(`\n[${elapsed(startTime)}] Aborting poll after ${waitMs}ms...`);
      abortController.abort();
    }, waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount++;
        logger.event(event);
        logger.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
      }, { abortSignal: abortController.signal });
    } catch (error) {
      if ((error as Error).message?.includes('aborted')) {
        logger.log(`[${elapsed(startTime)}] Poll aborted as expected`);
      } else {
        throw error;
      }
    }
    logger.log(`[${elapsed(startTime)}] Events received before abort: ${eventCount}`);

    // Step 3: Send interrupt
    logger.log(`\n[${elapsed(startTime)}] Step 3: Sending interrupt signal...`);
    await client.interruptSession(createResult.sessionId);
    logger.log(`[${elapsed(startTime)}] Interrupt sent`);

    // Wait a moment and check status
    await sleep(2000);
    const session = await client.getSession(createResult.sessionId);
    logger.log(`[${elapsed(startTime)}] Session status after interrupt: ${session.session_status}`);

    // Summary
    logger.log('\n=== SCENARIO 2 SUMMARY ===');
    logger.log(`Session ID: ${createResult.sessionId}`);
    logger.log(`Events before abort: ${eventCount}`);
    logger.log(`Final status: ${session.session_status}`);
    logger.log(`Total time: ${elapsed(startTime)}`);

    // JSON output
    logger.json({
      scenario: 2,
      sessionId: createResult.sessionId,
      eventsBeforeAbort: eventCount,
      finalStatus: session.session_status,
      totalTimeMs: Date.now() - startTime,
    });
  });

testCommand
  .command('scenario3')
  .description('Scenario 3: Execute + early terminate + queue resume')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--wait-ms <ms>', 'How long to wait before stopping poll', '5000')
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await getClient(parentOpts);
    const startTime = Date.now();
    const waitMs = parseInt(options.waitMs, 10);
    const logger = createTestLogger(options);

    logger.log('\n=== SCENARIO 3: Execute + Early Terminate + Queue Resume ===\n');

    // Step 1: Start session
    logger.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario3.txt with some initial content.',
      gitUrl: options.gitUrl,
    });
    logger.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll for a short time then stop (without interrupting)
    logger.log(`\n[${elapsed(startTime)}] Step 2: Polling for ${waitMs}ms then stopping (no interrupt)...`);
    const abortController = new AbortController();
    let eventCount = 0;

    setTimeout(() => {
      logger.log(`\n[${elapsed(startTime)}] Stopping poll...`);
      abortController.abort();
    }, waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount++;
        logger.event(event);
        logger.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
      }, { abortSignal: abortController.signal });
    } catch (error) {
      if ((error as Error).message?.includes('aborted')) {
        logger.log(`[${elapsed(startTime)}] Poll stopped`);
      } else {
        throw error;
      }
    }

    // Step 3: Queue a resume message (session might still be running)
    logger.log(`\n[${elapsed(startTime)}] Step 3: Sending resume message (queuing)...`);
    await client.sendMessage(createResult.sessionId, 'After you finish, also add a second line saying "Queued message received"');
    logger.log(`[${elapsed(startTime)}] Resume message sent/queued`);

    // Step 4: Now poll to see all remaining events
    logger.log(`\n[${elapsed(startTime)}] Step 4: Polling for remaining events...`);
    let resumeEventCount = 0;
    const result = await client.pollSession(createResult.sessionId, (event) => {
      resumeEventCount++;
      logger.event(event);
      logger.log(`[${elapsed(startTime)}] Resume Event ${resumeEventCount}: ${formatEvent(event)}`);
    }, { skipExistingEvents: false }); // Get all events to see the full picture

    // Summary
    logger.log('\n=== SCENARIO 3 SUMMARY ===');
    logger.log(`Session ID: ${createResult.sessionId}`);
    logger.log(`Events in first poll: ${eventCount}`);
    logger.log(`Events in second poll: ${resumeEventCount}`);
    logger.log(`Final status: ${result.status}`);
    logger.log(`Total time: ${elapsed(startTime)}`);

    // JSON output
    logger.json({
      scenario: 3,
      sessionId: createResult.sessionId,
      eventsInFirstPoll: eventCount,
      eventsInSecondPoll: resumeEventCount,
      finalStatus: result.status,
      totalTimeMs: Date.now() - startTime,
    });
  });

testCommand
  .command('scenario4')
  .description('Scenario 4: Execute + terminate + interrupt + resume')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--wait-ms <ms>', 'How long to wait before interrupting (needs 15s+ for Claude to start)', '15000')
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await getClient(parentOpts);
    const startTime = Date.now();
    const waitMs = parseInt(options.waitMs, 10);
    const logger = createTestLogger(options);

    logger.log('\n=== SCENARIO 4: Execute + Terminate + Interrupt + Resume ===\n');

    // Step 1: Start session
    logger.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a detailed file called test-scenario4.txt explaining what you are doing step by step.',
      gitUrl: options.gitUrl,
    });
    logger.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll briefly
    logger.log(`\n[${elapsed(startTime)}] Step 2: Polling for ${waitMs}ms...`);
    const abortController = new AbortController();
    let eventCount = 0;

    setTimeout(() => abortController.abort(), waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount++;
        logger.event(event);
        logger.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
      }, { abortSignal: abortController.signal });
    } catch {
      logger.log(`[${elapsed(startTime)}] Poll stopped`);
    }

    // Step 3: Interrupt
    logger.log(`\n[${elapsed(startTime)}] Step 3: Sending interrupt...`);
    await client.interruptSession(createResult.sessionId);
    logger.log(`[${elapsed(startTime)}] Interrupt sent`);

    // Wait for interrupt to take effect
    await sleep(3000);
    const session = await client.getSession(createResult.sessionId);
    logger.log(`[${elapsed(startTime)}] Status after interrupt: ${session.session_status}`);

    // Step 4: Resume
    logger.log(`\n[${elapsed(startTime)}] Step 4: Resuming with new prompt...`);
    let resumeEventCount = 0;
    const resumeResult = await client.resume(
      createResult.sessionId,
      'Please continue and add "Resumed after interrupt" to the file.',
      (event) => {
        resumeEventCount++;
        logger.event(event);
        logger.log(`[${elapsed(startTime)}] Resume Event ${resumeEventCount}: ${formatEvent(event)}`);
      }
    );

    // Summary
    logger.log('\n=== SCENARIO 4 SUMMARY ===');
    logger.log(`Session ID: ${createResult.sessionId}`);
    logger.log(`Events before interrupt: ${eventCount}`);
    logger.log(`Events after resume: ${resumeEventCount}`);
    logger.log(`Final status: ${resumeResult.status}`);
    logger.log(`Total time: ${elapsed(startTime)}`);

    // JSON output
    logger.json({
      scenario: 4,
      sessionId: createResult.sessionId,
      eventsBeforeInterrupt: eventCount,
      eventsAfterResume: resumeEventCount,
      finalStatus: resumeResult.status,
      totalTimeMs: Date.now() - startTime,
    });
  });

testCommand
  .command('scenario5')
  .description('Scenario 5: Double-queue - execute + terminate + queue + terminate + queue again')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--wait-ms <ms>', 'How long to wait before each stop', '3000')
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await getClient(parentOpts);
    const startTime = Date.now();
    const waitMs = parseInt(options.waitMs, 10);
    const logger = createTestLogger(options);

    logger.log('\n=== SCENARIO 5: Double-Queue ===\n');

    // Step 1: Start session
    logger.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario5.txt with "Step 1 content"',
      gitUrl: options.gitUrl,
    });
    logger.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll briefly then stop
    logger.log(`\n[${elapsed(startTime)}] Step 2: Polling for ${waitMs}ms...`);
    const abort1 = new AbortController();
    let eventCount1 = 0;
    setTimeout(() => abort1.abort(), waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount1++;
        logger.event(event);
        logger.log(`[${elapsed(startTime)}] Poll1 Event ${eventCount1}: ${formatEvent(event)}`);
      }, { abortSignal: abort1.signal });
    } catch {
      logger.log(`[${elapsed(startTime)}] Poll 1 stopped`);
    }

    // Step 3: Queue first resume
    logger.log(`\n[${elapsed(startTime)}] Step 3: Queuing first resume message...`);
    await client.sendMessage(createResult.sessionId, 'Add "Step 2 - first queued message" to the file');
    logger.log(`[${elapsed(startTime)}] First resume queued`);

    // Step 4: Poll briefly again
    logger.log(`\n[${elapsed(startTime)}] Step 4: Polling for another ${waitMs}ms...`);
    const abort2 = new AbortController();
    let eventCount2 = 0;
    setTimeout(() => abort2.abort(), waitMs);

    try {
      await client.pollSession(createResult.sessionId, (event) => {
        eventCount2++;
        logger.event(event);
        logger.log(`[${elapsed(startTime)}] Poll2 Event ${eventCount2}: ${formatEvent(event)}`);
      }, { abortSignal: abort2.signal });
    } catch {
      logger.log(`[${elapsed(startTime)}] Poll 2 stopped`);
    }

    // Step 5: Queue second resume
    logger.log(`\n[${elapsed(startTime)}] Step 5: Queuing second resume message...`);
    await client.sendMessage(createResult.sessionId, 'Add "Step 3 - second queued message" to the file');
    logger.log(`[${elapsed(startTime)}] Second resume queued`);

    // Step 6: Poll until completion
    logger.log(`\n[${elapsed(startTime)}] Step 6: Polling until completion...`);
    let finalEventCount = 0;
    const result = await client.pollSession(createResult.sessionId, (event) => {
      finalEventCount++;
      logger.event(event);
      logger.log(`[${elapsed(startTime)}] Final Event ${finalEventCount}: ${formatEvent(event)}`);
    });

    // Get final events for analysis
    logger.log(`\n[${elapsed(startTime)}] Fetching all events for analysis...`);
    const allEvents = await client.getEvents(createResult.sessionId);

    // Summary
    logger.log('\n=== SCENARIO 5 SUMMARY ===');
    logger.log(`Session ID: ${createResult.sessionId}`);
    logger.log(`Events in poll 1: ${eventCount1}`);
    logger.log(`Events in poll 2: ${eventCount2}`);
    logger.log(`Events in final poll: ${finalEventCount}`);
    logger.log(`Total events in session: ${allEvents.data?.length || 0}`);
    logger.log(`Final status: ${result.status}`);
    logger.log(`Total time: ${elapsed(startTime)}`);

    // JSON output
    logger.json({
      scenario: 5,
      sessionId: createResult.sessionId,
      eventsInPoll1: eventCount1,
      eventsInPoll2: eventCount2,
      eventsInFinalPoll: finalEventCount,
      totalEventsInSession: allEvents.data?.length || 0,
      finalStatus: result.status,
      totalTimeMs: Date.now() - startTime,
    });
  });

testCommand
  .command('scenario6')
  .description('Scenario 6: Execute + rename session')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await getClient(parentOpts);
    const startTime = Date.now();
    const logger = createTestLogger(options);

    logger.log('\n=== SCENARIO 6: Execute + Rename ===\n');

    // Step 1: Start session with default title
    logger.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario6.txt with "Testing rename feature"',
      gitUrl: options.gitUrl,
    });
    logger.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);
    logger.log(`[${elapsed(startTime)}] Initial title: ${createResult.title}`);

    // Step 2: Rename the session while it's running
    logger.log(`\n[${elapsed(startTime)}] Step 2: Renaming session...`);
    const newTitle = `Renamed at ${new Date().toISOString().slice(11, 19)}`;
    await client.renameSession(createResult.sessionId, newTitle);
    logger.log(`[${elapsed(startTime)}] Session renamed to: ${newTitle}`);

    // Verify rename
    const session = await client.getSession(createResult.sessionId);
    logger.log(`[${elapsed(startTime)}] Verified title: ${session.title}`);

    // Step 3: Poll until completion
    logger.log(`\n[${elapsed(startTime)}] Step 3: Polling for completion...`);
    let eventCount = 0;
    const result = await client.pollSession(createResult.sessionId, (event) => {
      eventCount++;
      logger.event(event);
      logger.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
    });

    // Summary
    logger.log('\n=== SCENARIO 6 SUMMARY ===');
    logger.log(`Session ID: ${createResult.sessionId}`);
    logger.log(`Original title: ${createResult.title}`);
    logger.log(`New title: ${newTitle}`);
    logger.log(`Title verified: ${session.title === newTitle ? 'YES' : 'NO'}`);
    logger.log(`Events: ${eventCount}`);
    logger.log(`Final status: ${result.status}`);
    logger.log(`Total time: ${elapsed(startTime)}`);

    // JSON output
    logger.json({
      scenario: 6,
      sessionId: createResult.sessionId,
      originalTitle: createResult.title,
      newTitle,
      titleVerified: session.title === newTitle,
      events: eventCount,
      finalStatus: result.status,
      totalTimeMs: Date.now() - startTime,
    });
  });

testCommand
  .command('scenario7')
  .description('Scenario 7: Execute + complete + archive')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await getClient(parentOpts);
    const startTime = Date.now();
    const logger = createTestLogger(options);

    logger.log('\n=== SCENARIO 7: Execute + Complete + Archive ===\n');

    // Step 1: Start session
    logger.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario7.txt with "Testing archive feature"',
      gitUrl: options.gitUrl,
    });
    logger.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Poll until completion
    logger.log(`\n[${elapsed(startTime)}] Step 2: Polling for completion...`);
    let eventCount = 0;
    const result = await client.pollSession(createResult.sessionId, (event) => {
      eventCount++;
      logger.event(event);
      logger.log(`[${elapsed(startTime)}] Event ${eventCount}: ${formatEvent(event)}`);
    });
    logger.log(`[${elapsed(startTime)}] Session completed: ${result.status}`);

    // Step 3: Archive the completed session
    logger.log(`\n[${elapsed(startTime)}] Step 3: Archiving session...`);
    await client.archiveSession(createResult.sessionId);
    logger.log(`[${elapsed(startTime)}] Archive request sent`);

    // Verify archive
    const session = await client.getSession(createResult.sessionId);
    logger.log(`[${elapsed(startTime)}] Session status after archive: ${session.session_status}`);

    // Summary
    logger.log('\n=== SCENARIO 7 SUMMARY ===');
    logger.log(`Session ID: ${createResult.sessionId}`);
    logger.log(`Events: ${eventCount}`);
    logger.log(`Completion status: ${result.status}`);
    logger.log(`Post-archive status: ${session.session_status}`);
    logger.log(`Archived: ${session.session_status === 'archived' ? 'YES' : 'NO'}`);
    logger.log(`Total time: ${elapsed(startTime)}`);

    // JSON output
    logger.json({
      scenario: 7,
      sessionId: createResult.sessionId,
      events: eventCount,
      completionStatus: result.status,
      postArchiveStatus: session.session_status,
      archived: session.session_status === 'archived',
      totalTimeMs: Date.now() - startTime,
    });
  });

testCommand
  .command('scenario8')
  .description('Scenario 8: Execute using WebSocket streaming instead of polling')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const client = await getClient(parentOpts);
    const startTime = Date.now();
    const logger = createTestLogger(options);

    logger.log('\n=== SCENARIO 8: WebSocket Streaming ===\n');

    // Step 1: Start session
    logger.log(`[${elapsed(startTime)}] Step 1: Creating session...`);
    const createResult = await client.createSession({
      prompt: 'Create a file called test-scenario8.txt with "Testing WebSocket streaming"',
      gitUrl: options.gitUrl,
    });
    logger.log(`[${elapsed(startTime)}] Session created: ${createResult.sessionId}`);

    // Step 2: Stream events via WebSocket instead of polling
    logger.log(`\n[${elapsed(startTime)}] Step 2: Streaming events via WebSocket...`);
    let eventCount = 0;
    try {
      const result = await client.streamEvents(createResult.sessionId, (event) => {
        eventCount++;
        logger.event(event);
        logger.log(`[${elapsed(startTime)}] WS Event ${eventCount}: ${formatEvent(event)}`);
      });

      // Summary
      logger.log('\n=== SCENARIO 8 SUMMARY ===');
      logger.log(`Session ID: ${createResult.sessionId}`);
      logger.log(`Events streamed: ${eventCount}`);
      logger.log(`Final status: ${result.status}`);
      logger.log(`Total time: ${elapsed(startTime)}`);

      // JSON output
      logger.json({
        scenario: 8,
        sessionId: createResult.sessionId,
        eventsStreamed: eventCount,
        finalStatus: result.status,
        totalTimeMs: Date.now() - startTime,
      });
    } catch (error) {
      logger.log(`\n[${elapsed(startTime)}] WebSocket streaming error: ${(error as Error).message}`);
      logger.log(`[${elapsed(startTime)}] Falling back to check session status...`);

      const session = await client.getSession(createResult.sessionId);
      logger.log('\n=== SCENARIO 8 SUMMARY ===');
      logger.log(`Session ID: ${createResult.sessionId}`);
      logger.log(`Events before error: ${eventCount}`);
      logger.log(`Session status: ${session.session_status}`);
      logger.log(`Total time: ${elapsed(startTime)}`);

      // JSON output for error case
      logger.json({
        scenario: 8,
        sessionId: createResult.sessionId,
        eventsBeforeError: eventCount,
        sessionStatus: session.session_status,
        error: (error as Error).message,
        totalTimeMs: Date.now() - startTime,
      });
    }
  });

testCommand
  .command('all')
  .description('Run all test scenarios sequentially')
  .option('--git-url <url>', 'Git URL to use', TEST_GIT_URL)
  .option('--skip <scenarios>', 'Comma-separated list of scenarios to skip (e.g., "1,4,5")')
  .option('--json', 'Output results as JSON')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (options, cmd) => {
    const parentOpts = cmd.parent?.parent?.opts() || {};
    const skipList = options.skip ? options.skip.split(',').map((s: string) => parseInt(s.trim(), 10)) : [];
    const startTime = Date.now();
    const results: { scenario: number; status: string; time: string; timeMs: number; error?: string }[] = [];
    const logger = createTestLogger(options);

    logger.log('\n========================================');
    logger.log('    RUNNING ALL TEST SCENARIOS');
    logger.log('========================================\n');
    logger.log(`Git URL: ${options.gitUrl}`);
    logger.log(`Skipping: ${skipList.length ? skipList.join(', ') : 'none'}`);
    logger.log('-'.repeat(40));

    const client = await getClient(parentOpts);

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
        logger.log(`\n[SKIPPED] Scenario ${i}`);
        results.push({ scenario: i, status: 'skipped', time: '0s', timeMs: 0 });
        continue;
      }

      logger.log(`\n${'='.repeat(60)}`);
      logger.log(`[STARTING] Scenario ${i}`);
      logger.log(`${'='.repeat(60)}`);

      const scenarioStart = Date.now();
      try {
        await scenarios[i]();
        results.push({ scenario: i, status: 'success', time: elapsed(scenarioStart), timeMs: Date.now() - scenarioStart });
      } catch (error) {
        logger.log(`\n[ERROR] Scenario ${i} failed: ${(error as Error).message}`);
        results.push({ scenario: i, status: 'failed', time: elapsed(scenarioStart), timeMs: Date.now() - scenarioStart, error: (error as Error).message });
      }
    }

    // Final Summary
    logger.log('\n' + '='.repeat(60));
    logger.log('    ALL SCENARIOS COMPLETE');
    logger.log('='.repeat(60));
    logger.log('\nResults:');
    logger.log('-'.repeat(40));
    for (const r of results) {
      const statusIcon = r.status === 'success' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
      logger.log(`  ${statusIcon} Scenario ${r.scenario}: ${r.status.toUpperCase()} (${r.time})${r.error ? ` - ${r.error.slice(0, 50)}` : ''}`);
    }
    logger.log('-'.repeat(40));
    logger.log(`Total time: ${elapsed(startTime)}`);
    logger.log(`Success: ${results.filter(r => r.status === 'success').length}/${results.filter(r => r.status !== 'skipped').length}`);

    // JSON output
    logger.json({
      scenarios: results,
      totalTimeMs: Date.now() - startTime,
      success: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      skipped: results.filter(r => r.status === 'skipped').length,
    });
  });

webCommand.addCommand(testCommand);

// ============================================================================
// REGISTER SUBCOMMANDS
// ============================================================================

claudeCommand.addCommand(webCommand);

// Future: claudeCommand.addCommand(localCommand);
// Future: claudeCommand.addCommand(containerCommand);
