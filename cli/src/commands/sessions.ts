import { Command } from 'commander';
import { db, chatSessions, events, messages, users, getExecutionProvider, ensureValidToken, normalizeRepoUrl, generateSessionPath } from '@webedt/shared';
import type { ClaudeAuth, ExecutionEvent } from '@webedt/shared';
import { eq, desc, and, lt, sql, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';

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
        console.error('Run `npm run cli -- db users list` to see available users.');
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

      // Get credentials - try user's claudeAuth first, then fallback to CLI credentials
      let claudeAuth = userData.claudeAuth as ClaudeAuth;

      // Refresh token if needed
      try {
        const refreshedAuth = await ensureValidToken(claudeAuth);
        if (refreshedAuth.accessToken !== claudeAuth.accessToken) {
          // Token was refreshed, save it - cast to any to satisfy drizzle's strict typing
          await db.update(users)
            .set({ claudeAuth: refreshedAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
            .where(eq(users.id, options.user));
          claudeAuth = refreshedAuth;
          log('Token refreshed and saved to database');
        }
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

      // Normalize repo URL
      const repoUrl = normalizeRepoUrl(gitUrl);
      const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(\.git)?$/);
      const repositoryOwner = repoMatch ? repoMatch[1] : null;
      const repositoryName = repoMatch ? repoMatch[2] : null;

      // Create database session (mirrors executeRemote.ts)
      const chatSessionId = randomUUID();

      log(`\nCreating database session: ${chatSessionId}`);
      log(`User: ${userData.email}`);
      log(`Git URL: ${repoUrl}`);
      log(`Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
      log('-'.repeat(80));

      const [newSession] = await db.insert(chatSessions).values({
        id: chatSessionId,
        userId: userData.id,
        userRequest: prompt.slice(0, 200),
        status: 'running',
        provider: 'claude',
        repositoryUrl: repoUrl,
        repositoryOwner,
        repositoryName,
        baseBranch: 'main',
      }).returning();

      log(`Session created in database: ${newSession.id}`);

      // Track stored event UUIDs to prevent duplicates
      const storedEventUuids = new Set<string>();

      // Store user message
      await db.insert(messages).values({
        chatSessionId,
        type: 'user',
        content: prompt,
      });

      // Get execution provider
      const provider = getExecutionProvider();

      // Event handler that stores to database (mirrors executeRemote.ts)
      const handleEvent = async (event: ExecutionEvent) => {
        // Log event
        if (options.jsonl) {
          console.log(JSON.stringify(event));
        } else if (!options.quiet && !options.json) {
          const timestamp = new Date().toISOString().slice(11, 19);
          console.log(`[${timestamp}] ${event.type}: ${JSON.stringify(event).slice(0, 100)}...`);
        }

        // Store event in database - deduplicate by UUID
        const eventUuid = (event as { uuid?: string }).uuid;
        if (eventUuid && storedEventUuids.has(eventUuid)) {
          return; // Skip duplicate
        }

        try {
          await db.insert(events).values({
            chatSessionId,
            eventData: event,
          });
          if (eventUuid) {
            storedEventUuids.add(eventUuid);
          }
        } catch (err) {
          // Ignore storage errors
        }

        // Update session with title from title_generation event
        if (event.type === 'title_generation' && (event as { status?: string }).status === 'success') {
          const titleEvent = event as { title?: string; branch_name?: string };
          const newTitle = titleEvent.title;
          const newBranch = titleEvent.branch_name;

          let newSessionPath: string | undefined;
          if (newBranch && repositoryOwner && repositoryName) {
            newSessionPath = generateSessionPath(repositoryOwner, repositoryName, newBranch);
          }

          try {
            await db.update(chatSessions)
              .set({
                userRequest: newTitle,
                ...(newBranch ? { branch: newBranch } : {}),
                ...(newSessionPath ? { sessionPath: newSessionPath } : {})
              })
              .where(eq(chatSessions.id, chatSessionId));
            log(`Session title updated: ${newTitle}`);
          } catch (err) {
            // Ignore update errors
          }
        }

        // Save remoteSessionId immediately when session_created
        if (event.type === 'session_created') {
          const sessionEvent = event as { remoteSessionId?: string; remoteWebUrl?: string };
          try {
            await db.update(chatSessions)
              .set({
                remoteSessionId: sessionEvent.remoteSessionId,
                remoteWebUrl: sessionEvent.remoteWebUrl,
              })
              .where(eq(chatSessions.id, chatSessionId));
            log(`Remote session linked: ${sessionEvent.remoteSessionId}`);
          } catch (err) {
            // Ignore update errors
          }
        }
      };

      // Execute
      log('\nStarting execution...\n');

      const result = await provider.execute(
        {
          userId: userData.id,
          chatSessionId,
          prompt,
          gitUrl: repoUrl,
          claudeAuth,
          environmentId,
        },
        handleEvent
      );

      // Update session with final result
      const finalStatus = result.status === 'completed' ? 'completed' : 'error';

      let finalSessionPath: string | undefined;
      if (result.branch && repositoryOwner && repositoryName) {
        finalSessionPath = generateSessionPath(repositoryOwner, repositoryName, result.branch);
      }

      await db.update(chatSessions)
        .set({
          status: finalStatus,
          branch: result.branch,
          remoteSessionId: result.remoteSessionId,
          remoteWebUrl: result.remoteWebUrl,
          totalCost: result.totalCost?.toString(),
          completedAt: new Date(),
          ...(finalSessionPath ? { sessionPath: finalSessionPath } : {}),
        })
        .where(eq(chatSessions.id, chatSessionId));

      // Output result
      if (options.json) {
        console.log(JSON.stringify({
          chatSessionId,
          ...result,
        }, null, 2));
        return;
      }

      if (options.jsonl) {
        return;
      }

      console.log('-'.repeat(80));
      console.log('\nResult:');
      console.log(`  Website Session ID: ${chatSessionId}`);
      console.log(`  Remote Session ID:  ${result.remoteSessionId}`);
      console.log(`  Status:             ${result.status}`);
      console.log(`  Branch:             ${result.branch || 'N/A'}`);
      console.log(`  Cost:               $${result.totalCost?.toFixed(4) || 'N/A'}`);
      console.log(`  Duration:           ${result.durationMs ? Math.round(result.durationMs / 1000) + 's' : 'N/A'}`);
      console.log(`  Web URL:            ${result.remoteWebUrl || 'N/A'}`);
      console.log(`\nView in website:      http://localhost:3000/#/chat/${chatSessionId}`);
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

      // Get session from database
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId))
        .limit(1);

      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }

      if (!session.remoteSessionId) {
        console.error('Session does not have a remote session ID. Cannot resume.');
        process.exit(1);
      }

      // Get user's Claude auth
      const [userData] = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);

      if (!userData?.claudeAuth) {
        console.error('User does not have Claude authentication configured.');
        process.exit(1);
      }

      let claudeAuth = userData.claudeAuth as ClaudeAuth;

      // Refresh token if needed
      try {
        const refreshedAuth = await ensureValidToken(claudeAuth);
        if (refreshedAuth.accessToken !== claudeAuth.accessToken) {
          await db.update(users)
            .set({ claudeAuth: refreshedAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
            .where(eq(users.id, session.userId));
          claudeAuth = refreshedAuth;
          log('Token refreshed and saved to database');
        }
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
      log(`Remote Session: ${session.remoteSessionId}`);
      log(`Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);
      log('-'.repeat(80));

      // Update session status
      await db.update(chatSessions)
        .set({ status: 'running' })
        .where(eq(chatSessions.id, sessionId));

      // Store user message
      await db.insert(messages).values({
        chatSessionId: sessionId,
        type: 'user',
        content: message,
      });

      // Track stored event UUIDs
      const storedEventUuids = new Set<string>();

      // Get execution provider
      const provider = getExecutionProvider();

      // Event handler
      const handleEvent = async (event: ExecutionEvent) => {
        if (options.jsonl) {
          console.log(JSON.stringify(event));
        } else if (!options.quiet && !options.json) {
          const timestamp = new Date().toISOString().slice(11, 19);
          console.log(`[${timestamp}] ${event.type}: ${JSON.stringify(event).slice(0, 100)}...`);
        }

        const eventUuid = (event as { uuid?: string }).uuid;
        if (eventUuid && storedEventUuids.has(eventUuid)) {
          return;
        }

        try {
          await db.insert(events).values({
            chatSessionId: sessionId,
            eventData: event,
          });
          if (eventUuid) {
            storedEventUuids.add(eventUuid);
          }
        } catch (err) {
          // Ignore storage errors
        }
      };

      // Resume
      log('\nStarting resume...\n');

      const result = await provider.resume(
        {
          userId: session.userId,
          chatSessionId: sessionId,
          remoteSessionId: session.remoteSessionId,
          prompt: message,
          claudeAuth,
          environmentId,
        },
        handleEvent
      );

      // Update session with final result
      const finalStatus = result.status === 'completed' ? 'completed' : 'error';

      await db.update(chatSessions)
        .set({
          status: finalStatus,
          totalCost: result.totalCost?.toString(),
          completedAt: new Date(),
        })
        .where(eq(chatSessions.id, sessionId));

      // Output result
      if (options.json) {
        console.log(JSON.stringify({
          chatSessionId: sessionId,
          ...result,
        }, null, 2));
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
