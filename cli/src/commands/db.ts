import { Command } from 'commander';
import { db, chatSessions, events, messages, users, lucia, getDatabaseCredentials, parseDatabaseUrl } from '@webedt/shared';
import { eq, desc, and, lt, sql, count } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import net from 'net';

export const dbCommand = new Command('db')
  .description('Database operations');

// ============================================================================
// CHECK COMMAND
// ============================================================================

dbCommand
  .command('check')
  .description('Check database connection status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const credentials = getDatabaseCredentials();

    if (!credentials) {
      if (options.json) {
        console.log(JSON.stringify({ connected: false, error: 'No DATABASE_URL found' }, null, 2));
      } else {
        console.log('\nDatabase Connection Status:');
        console.log('  Connected: No');
        console.log('  Error: No DATABASE_URL found');
        console.log('');
        console.log('Checked:');
        console.log('  1. DATABASE_URL environment variable');
        console.log('  2. .env file in current directory');
        console.log('  3. .env file in parent directory');
      }
      process.exit(1);
    }

    const parsed = parseDatabaseUrl(credentials.connectionString);

    if (!parsed) {
      if (options.json) {
        console.log(JSON.stringify({ connected: false, error: 'Invalid DATABASE_URL format' }, null, 2));
      } else {
        console.log('\nDatabase Connection Status:');
        console.log('  Connected: No');
        console.log('  Error: Invalid DATABASE_URL format');
      }
      process.exit(1);
    }

    // Check if host is reachable
    const isReachable = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(parsed.port, parsed.host);
    });

    // Try actual DB connection
    let dbConnected = false;
    let dbError: string | null = null;

    if (isReachable) {
      try {
        await db.select({ one: sql`1` }).from(users).limit(1);
        dbConnected = true;
      } catch (error) {
        dbError = (error as Error).message;
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        connected: dbConnected,
        source: credentials.source,
        host: parsed.host,
        port: parsed.port,
        database: parsed.database,
        user: parsed.user,
        hostReachable: isReachable,
        error: dbError,
      }, null, 2));
      return;
    }

    console.log('\nDatabase Connection Status:');
    console.log(`  Source:       ${credentials.source}`);
    console.log(`  Host:         ${parsed.host}:${parsed.port}`);
    console.log(`  Database:     ${parsed.database}`);
    console.log(`  User:         ${parsed.user}`);
    console.log(`  Reachable:    ${isReachable ? 'Yes' : 'No'}`);
    console.log(`  Connected:    ${dbConnected ? 'Yes' : 'No'}`);
    if (dbError) {
      console.log(`  Error:        ${dbError.slice(0, 60)}`);
    }

    if (!dbConnected) {
      process.exit(1);
    }
  });

// ============================================================================
// SESSIONS SUBGROUP
// ============================================================================

const sessionsCommand = new Command('sessions')
  .description('Chat session operations');

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

// ============================================================================
// USERS SUBGROUP
// ============================================================================

const usersCommand = new Command('users')
  .description('User operations');

usersCommand
  .command('list')
  .description('List all users')
  .option('-l, --limit <number>', 'Limit number of results', '50')
  .action(async (options) => {
    try {
      const limit = parseInt(options.limit, 10);

      const userList = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          isAdmin: users.isAdmin,
          preferredProvider: users.preferredProvider,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(limit);

      if (userList.length === 0) {
        console.log('No users found.');
        return;
      }

      console.log('\nUsers:');
      console.log('-'.repeat(110));
      console.log(
        'ID'.padEnd(38) +
        'Email'.padEnd(30) +
        'Display Name'.padEnd(20) +
        'Admin'.padEnd(8) +
        'Provider'.padEnd(12)
      );
      console.log('-'.repeat(110));

      for (const user of userList) {
        console.log(
          (user.id || '').padEnd(38) +
          (user.email || '').slice(0, 28).padEnd(30) +
          (user.displayName || '').slice(0, 18).padEnd(20) +
          (user.isAdmin ? 'Yes' : 'No').padEnd(8) +
          (user.preferredProvider || 'claude').padEnd(12)
        );
      }

      console.log('-'.repeat(110));
      console.log(`Total: ${userList.length} user(s)`);
    } catch (error) {
      console.error('Error listing users:', error);
      process.exit(1);
    }
  });

usersCommand
  .command('get <userId>')
  .description('Get details of a specific user')
  .action(async (userId) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        console.error(`User not found: ${userId}`);
        process.exit(1);
      }

      console.log('\nUser Details:');
      console.log('-'.repeat(60));
      console.log(`ID:                ${user.id}`);
      console.log(`Email:             ${user.email}`);
      console.log(`Display Name:      ${user.displayName || 'N/A'}`);
      console.log(`Is Admin:          ${user.isAdmin ? 'Yes' : 'No'}`);
      console.log(`Preferred Provider:${user.preferredProvider}`);
      console.log(`GitHub Connected:  ${user.githubId ? 'Yes' : 'No'}`);
      console.log(`Claude Auth:       ${user.claudeAuth ? 'Yes' : 'No'}`);
      console.log(`Codex Auth:        ${user.codexAuth ? 'Yes' : 'No'}`);
      console.log(`Gemini Auth:       ${user.geminiAuth ? 'Yes' : 'No'}`);
      console.log(`Created:           ${user.createdAt}`);
      console.log('-'.repeat(60));
    } catch (error) {
      console.error('Error getting user:', error);
      process.exit(1);
    }
  });

usersCommand
  .command('create <email> <password>')
  .description('Create a new user')
  .option('-d, --display-name <name>', 'User display name')
  .option('-a, --admin', 'Make user an admin')
  .action(async (email, password, options) => {
    try {
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser.length > 0) {
        console.error(`User with email '${email}' already exists.`);
        process.exit(1);
      }

      const userId = randomUUID();
      const passwordHash = await bcrypt.hash(password, 10);

      await db.insert(users).values({
        id: userId,
        email,
        passwordHash,
        displayName: options.displayName || null,
        isAdmin: options.admin || false,
        preferredProvider: 'claude',
      });

      console.log(`\nUser created successfully:`);
      console.log(`  ID:       ${userId}`);
      console.log(`  Email:    ${email}`);
      console.log(`  Admin:    ${options.admin ? 'Yes' : 'No'}`);
    } catch (error) {
      console.error('Error creating user:', error);
      process.exit(1);
    }
  });

usersCommand
  .command('set-admin <userId> <isAdmin>')
  .description('Set user admin status (true or false)')
  .action(async (userId, isAdmin) => {
    try {
      const adminStatus = isAdmin === 'true';

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        console.error(`User not found: ${userId}`);
        process.exit(1);
      }

      await db
        .update(users)
        .set({ isAdmin: adminStatus })
        .where(eq(users.id, userId));

      console.log(`User ${user.email} admin status updated to '${adminStatus}'.`);
    } catch (error) {
      console.error('Error updating admin status:', error);
      process.exit(1);
    }
  });

usersCommand
  .command('delete <userId>')
  .description('Delete a user')
  .option('-f, --force', 'Skip confirmation')
  .action(async (userId, options) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        console.error(`User not found: ${userId}`);
        process.exit(1);
      }

      if (!options.force) {
        console.log(`\nAbout to delete user: ${user.email}`);
        console.log('Use --force to confirm deletion.');
        process.exit(0);
      }

      // Invalidate all sessions
      await lucia.invalidateUserSessions(userId);

      // Delete user (cascades to chat_sessions, etc.)
      await db.delete(users).where(eq(users.id, userId));

      console.log(`User '${user.email}' deleted successfully.`);
    } catch (error) {
      console.error('Error deleting user:', error);
      process.exit(1);
    }
  });

// ============================================================================
// REGISTER SUBCOMMANDS
// ============================================================================

dbCommand.addCommand(sessionsCommand);
dbCommand.addCommand(usersCommand);
