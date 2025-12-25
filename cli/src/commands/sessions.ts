import { Command } from 'commander';
import { db, chatSessions, events, messages, users, ServiceProvider, ASession, ATokenRefreshService } from '@webedt/shared';
import type { ClaudeAuth, ExecutionEvent } from '@webedt/shared';
import { eq, desc, and, lt, sql, count } from 'drizzle-orm';

export const sessionsCommand = new Command('sessions')
  .description('Session lifecycle operations');

sessionsCommand
  .command('list')
  .description('List all sessions')
  .option('-l, --limit <number>', 'Limit number of results', '20')
  .option('-u, --user <userId>', 'Filter by user ID')
  .option('-s, --status <status>', 'Filter by status (pending, running, completed, error)')
  .action(async (options) => {
    try {
      const limit = parseInt(options.limit, 10);

      const sessions = await db
        .select({
          id: chatSessions.id,
          userRequest: chatSessions.userRequest,
          status: chatSessions.status,
          userId: chatSessions.userId,
          sessionPath: chatSessions.sessionPath,
          provider: chatSessions.provider,
          createdAt: chatSessions.createdAt,
          completedAt: chatSessions.completedAt,
        })
        .from(chatSessions)
        .orderBy(desc(chatSessions.createdAt))
        .limit(limit);

      if (sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }

      console.log('\nSessions:');
      console.log('-'.repeat(120));
      console.log(
        'ID'.padEnd(38) +
        'Request'.padEnd(40) +
        'Status'.padEnd(12) +
        'Provider'.padEnd(12) +
        'Created'.padEnd(20)
      );
      console.log('-'.repeat(120));

      for (const session of sessions) {
        const created = session.createdAt ? new Date(session.createdAt).toISOString().slice(0, 19) : 'N/A';
        const request = (session.userRequest || '').slice(0, 38);
        console.log(
          (session.id || '').padEnd(38) +
          request.padEnd(40) +
          (session.status || 'unknown').padEnd(12) +
          (session.provider || 'claude').padEnd(12) +
          created.padEnd(20)
        );
      }
      console.log('-'.repeat(120));
      console.log(`Total: ${sessions.length} session(s)`);
    } catch (error) {
      console.error('Error listing sessions:', error);
      process.exit(1);
    }
  });

sessionsCommand
  .command('get <sessionId>')
  .description('Get details of a specific session')
  .action(async (sessionId) => {
    try {
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId))
        .limit(1);

      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }

      console.log('\nSession Details:');
      console.log('-'.repeat(60));
      console.log(`ID:           ${session.id}`);
      console.log(`User Request: ${session.userRequest?.slice(0, 100)}...`);
      console.log(`Status:       ${session.status}`);
      console.log(`User ID:      ${session.userId}`);
      console.log(`Provider:     ${session.provider || 'claude'}`);
      console.log(`Created:      ${session.createdAt}`);
      console.log(`Completed:    ${session.completedAt || 'N/A'}`);
      console.log(`Session Path: ${session.sessionPath || 'N/A'}`);
      console.log(`Repository:   ${session.repositoryOwner}/${session.repositoryName}`);
      console.log(`Branch:       ${session.branch || 'N/A'}`);
      console.log('-'.repeat(60));

      // Get event count
      const eventCountResult = await db
        .select({ count: count() })
        .from(events)
        .where(eq(events.chatSessionId, sessionId));

      console.log(`Events:       ${eventCountResult[0]?.count || 0}`);
    } catch (error) {
      console.error('Error getting session:', error);
      process.exit(1);
    }
  });

sessionsCommand
  .command('delete <sessionId>')
  .description('Delete a session and its events')
  .option('-f, --force', 'Skip confirmation')
  .action(async (sessionId, options) => {
    try {
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId))
        .limit(1);

      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }

      if (!options.force) {
        console.log(`\nAbout to delete session: ${sessionId}`);
        console.log(`Request: ${session.userRequest?.slice(0, 50)}...`);
        console.log('Use --force to confirm deletion.');
        process.exit(0);
      }

      // Delete events first
      await db.delete(events).where(eq(events.chatSessionId, sessionId));

      // Delete messages
      await db.delete(messages).where(eq(messages.chatSessionId, sessionId));

      // Delete session
      await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));

      console.log(`Session ${sessionId} deleted successfully.`);
    } catch (error) {
      console.error('Error deleting session:', error);
      process.exit(1);
    }
  });

sessionsCommand
  .command('delete-bulk')
  .description('Delete multiple sessions at once')
  .option('--today', 'Delete all sessions created today')
  .option('--date <date>', 'Delete all sessions created on a specific date (YYYY-MM-DD)')
  .option('-f, --force', 'Skip confirmation')
  .option('--dry-run', 'Show what would be deleted without making changes')
  .action(async (options) => {
    try {
      let targetDate: string;

      if (options.today) {
        targetDate = new Date().toISOString().slice(0, 10);
      } else if (options.date) {
        targetDate = options.date;
      } else {
        console.error('Must specify --today or --date <YYYY-MM-DD>');
        process.exit(1);
      }

      // Find sessions created on target date
      const startOfDay = new Date(`${targetDate}T00:00:00.000Z`);
      const endOfDay = new Date(`${targetDate}T23:59:59.999Z`);

      const sessionsToDelete = await db
        .select({
          id: chatSessions.id,
          userRequest: chatSessions.userRequest,
          status: chatSessions.status,
          createdAt: chatSessions.createdAt,
        })
        .from(chatSessions)
        .where(
          and(
            sql`${chatSessions.createdAt} >= ${startOfDay}`,
            sql`${chatSessions.createdAt} <= ${endOfDay}`
          )
        );

      if (sessionsToDelete.length === 0) {
        console.log(`No sessions found for ${targetDate}.`);
        return;
      }

      console.log(`\nFound ${sessionsToDelete.length} session(s) for ${targetDate}:`);
      console.log('-'.repeat(100));

      for (const session of sessionsToDelete) {
        const created = session.createdAt ? new Date(session.createdAt).toISOString().slice(11, 19) : 'N/A';
        console.log(`  ${session.id} - ${(session.userRequest || '').slice(0, 40)}... (${session.status}, ${created})`);
      }

      if (options.dryRun) {
        console.log('\nDry run - no changes made.');
        return;
      }

      if (!options.force) {
        console.log('\nUse --force to confirm deletion.');
        return;
      }

      console.log('\nDeleting...');
      let deleted = 0;

      for (const session of sessionsToDelete) {
        // Delete events first
        await db.delete(events).where(eq(events.chatSessionId, session.id));
        // Delete messages
        await db.delete(messages).where(eq(messages.chatSessionId, session.id));
        // Delete session
        await db.delete(chatSessions).where(eq(chatSessions.id, session.id));
        deleted++;
      }

      console.log(`\nDeleted ${deleted} session(s).`);
    } catch (error) {
      console.error('Error deleting sessions:', error);
      process.exit(1);
    }
  });

sessionsCommand
  .command('cleanup')
  .description('Clean up orphaned sessions stuck in running/pending status')
  .option('-t, --timeout <minutes>', 'Timeout threshold in minutes', '30')
  .option('-d, --dry-run', 'Show what would be cleaned without making changes')
  .action(async (options) => {
    try {
      const timeoutMinutes = parseInt(options.timeout, 10);
      const timeoutThreshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);

      const stuckSessions = await db
        .select()
        .from(chatSessions)
        .where(
          and(
            sql`${chatSessions.status} IN ('running', 'pending')`,
            lt(chatSessions.createdAt, timeoutThreshold)
          )
        );

      if (stuckSessions.length === 0) {
        console.log('No orphaned sessions found.');
        return;
      }

      console.log(`\nFound ${stuckSessions.length} orphaned session(s):`);
      console.log('-'.repeat(80));

      for (const session of stuckSessions) {
        const created = session.createdAt ? new Date(session.createdAt).toISOString() : 'N/A';
        console.log(`  ${session.id} - ${session.userRequest?.slice(0, 40)}... (${session.status}, created: ${created})`);
      }

      if (options.dryRun) {
        console.log('\nDry run - no changes made.');
        return;
      }

      console.log('\nCleaning up...');
      let cleaned = 0;

      for (const session of stuckSessions) {
        // Check if session has a completed event (eventType is inside eventData JSON)
        const sessionEvents = await db
          .select()
          .from(events)
          .where(eq(events.chatSessionId, session.id));

        // Check for completed event in the eventData JSON
        const hasCompletedEvent = sessionEvents.some(e => {
          const data = e.eventData as { type?: string } | null;
          return data?.type === 'completed';
        });

        const newStatus = hasCompletedEvent ? 'completed' : 'error';

        await db
          .update(chatSessions)
          .set({
            status: newStatus,
            completedAt: new Date()
          })
          .where(eq(chatSessions.id, session.id));

        console.log(`  Updated ${session.id} to '${newStatus}'`);
        cleaned++;
      }

      console.log(`\nCleaned up ${cleaned} session(s).`);
    } catch (error) {
      console.error('Error cleaning up sessions:', error);
      process.exit(1);
    }
  });

sessionsCommand
  .command('events <sessionId>')
  .description('List events for a session')
  .option('-l, --limit <number>', 'Limit number of results', '50')
  .option('--json', 'Output as JSON')
  .action(async (sessionId, options) => {
    try {
      const limit = parseInt(options.limit, 10);

      const eventList = await db
        .select({
          id: events.id,
          eventData: events.eventData,
          timestamp: events.timestamp,
        })
        .from(events)
        .where(eq(events.chatSessionId, sessionId))
        .orderBy(desc(events.timestamp))
        .limit(limit);

      if (options.json) {
        console.log(JSON.stringify(eventList, null, 2));
        return;
      }

      if (eventList.length === 0) {
        console.log('No events found for this session.');
        return;
      }

      console.log(`\nEvents for session ${sessionId}:`);
      console.log('-'.repeat(100));

      for (const event of eventList) {
        const data = event.eventData as { type?: string } | null;
        const type = data?.type || 'unknown';
        const created = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 19) : 'N/A';
        console.log(`  [${event.id}] ${type.padEnd(20)} ${created}`);
      }

      console.log('-'.repeat(100));
      console.log(`Total: ${eventList.length} event(s)`);
    } catch (error) {
      console.error('Error listing events:', error);
      process.exit(1);
    }
  });

sessionsCommand
  .command('execute <gitUrl> <prompt>')
  .description('Execute a task (creates session in database, calls Claude Remote)')
  .option('-u, --user <userId>', 'User ID to create session for (required)')
  .option('-m, --model <model>', 'Model to use (e.g., claude-sonnet-4-20250514)')
  .option('--quiet', 'Only show final result, not streaming events')
  .option('--json', 'Output raw JSON result')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (gitUrl, prompt, options) => {
    try {
      const silent = options.json || options.jsonl;
      const log = silent ? () => {} : console.log.bind(console);

      // Require user ID
      if (!options.user) {
        console.error('User ID is required. Use --user <userId> to specify.');
        console.error('Run `npm run cli -- users list` to see available users.');
        process.exit(1);
      }

      // Get user from database
      const [userData] = await db
        .select()
        .from(users)
        .where(eq(users.id, options.user))
        .limit(1);

      if (!userData) {
        console.error(`User not found: ${options.user}`);
        process.exit(1);
      }

      if (!userData.claudeAuth) {
        console.error('User does not have Claude authentication configured.');
        console.error('The user needs to connect their Claude account via the website settings.');
        process.exit(1);
      }

      // Get credentials and refresh if needed using TokenRefreshService
      let claudeAuth = userData.claudeAuth as ClaudeAuth;

      try {
        const tokenService = ServiceProvider.get(ATokenRefreshService);
        claudeAuth = await tokenService.ensureValidTokenForUser(options.user, claudeAuth);
        log('Token validated (refreshed if needed)');
      } catch (error) {
        console.error('Failed to refresh Claude token:', (error as Error).message);
        process.exit(1);
      }

      // Get environment ID from env var
      const environmentId = process.env.CLAUDE_ENVIRONMENT_ID;

      if (!environmentId) {
        console.error('CLAUDE_ENVIRONMENT_ID not found.');
        console.error('Set CLAUDE_ENVIRONMENT_ID in your .env file.');
        process.exit(1);
      }

      log(`\nExecuting session for user: ${userData.email}`);
      log(`Git URL: ${gitUrl}`);
      log(`Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
      log('-'.repeat(80));

      // Get session service
      const session = ServiceProvider.get(ASession);

      // Event handler for logging
      const handleEvent = async (event: ExecutionEvent) => {
        if (options.jsonl) {
          console.log(JSON.stringify(event));
        } else if (!options.quiet && !options.json) {
          const timestamp = new Date().toISOString().slice(11, 19);
          console.log(`[${timestamp}] ${event.type}: ${JSON.stringify(event).slice(0, 100)}...`);
        }
      };

      // Execute via ASession (handles DB + Claude Remote)
      log('\nStarting execution...\n');

      const result = await session.execute(
        {
          userId: userData.id,
          prompt,
          gitUrl,
          claudeAuth,
          environmentId,
          model: options.model,
        },
        handleEvent
      );

      // Output result
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.jsonl) {
        return;
      }

      console.log('-'.repeat(80));
      console.log('\nResult:');
      console.log(`  Remote Session ID:  ${result.remoteSessionId}`);
      console.log(`  Status:             ${result.status}`);
      console.log(`  Branch:             ${result.branch || 'N/A'}`);
      console.log(`  Cost:               $${result.totalCost?.toFixed(4) || 'N/A'}`);
      console.log(`  Duration:           ${result.durationMs ? Math.round(result.durationMs / 1000) + 's' : 'N/A'}`);
      console.log(`  Web URL:            ${result.remoteWebUrl || 'N/A'}`);
    } catch (error) {
      console.error('Error executing session:', error);
      process.exit(1);
    }
  });

sessionsCommand
  .command('resume <sessionId> <message>')
  .description('Resume a session with a follow-up message')
  .option('--quiet', 'Only show final result, not streaming events')
  .option('--json', 'Output raw JSON result')
  .option('--jsonl', 'Stream events as JSON Lines')
  .action(async (sessionId, message, options) => {
    try {
      const silent = options.json || options.jsonl;
      const log = silent ? () => {} : console.log.bind(console);

      // Get session from database to get user's auth
      const [dbSession] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId))
        .limit(1);

      if (!dbSession) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }

      // Get user's Claude auth
      const [userData] = await db
        .select()
        .from(users)
        .where(eq(users.id, dbSession.userId))
        .limit(1);

      if (!userData?.claudeAuth) {
        console.error('User does not have Claude authentication configured.');
        process.exit(1);
      }

      let claudeAuth = userData.claudeAuth as ClaudeAuth;

      // Refresh token if needed using TokenRefreshService
      try {
        const tokenService = ServiceProvider.get(ATokenRefreshService);
        claudeAuth = await tokenService.ensureValidTokenForUser(dbSession.userId, claudeAuth);
        log('Token validated (refreshed if needed)');
      } catch (error) {
        console.error('Failed to refresh Claude token:', (error as Error).message);
        process.exit(1);
      }

      const environmentId = process.env.CLAUDE_ENVIRONMENT_ID;
      if (!environmentId) {
        console.error('CLAUDE_ENVIRONMENT_ID not found.');
        process.exit(1);
      }

      log(`\nResuming session: ${sessionId}`);
      log(`Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);
      log('-'.repeat(80));

      // Get session service
      const session = ServiceProvider.get(ASession);

      // Event handler for logging
      const handleEvent = async (event: ExecutionEvent) => {
        if (options.jsonl) {
          console.log(JSON.stringify(event));
        } else if (!options.quiet && !options.json) {
          const timestamp = new Date().toISOString().slice(11, 19);
          console.log(`[${timestamp}] ${event.type}: ${JSON.stringify(event).slice(0, 100)}...`);
        }
      };

      // Resume via ASession (handles DB + Claude Remote)
      log('\nStarting resume...\n');

      const result = await session.resume(
        sessionId,
        {
          prompt: message,
          claudeAuth,
          environmentId,
        },
        handleEvent
      );

      // Output result
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.jsonl) {
        return;
      }

      console.log('-'.repeat(80));
      console.log('\nResult:');
      console.log(`  Status:     ${result.status}`);
      console.log(`  Cost:       $${result.totalCost?.toFixed(4) || 'N/A'}`);
      console.log(`  Duration:   ${result.durationMs ? Math.round(result.durationMs / 1000) + 's' : 'N/A'}`);
    } catch (error) {
      console.error('Error resuming session:', error);
      process.exit(1);
    }
  });
