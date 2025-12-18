import { Command } from 'commander';
import { db, chatSessions, events, messages } from '../../logic/db/index.js';
import { eq, desc, and, lt, sql, count } from 'drizzle-orm';

export const sessionCommand = new Command('session')
  .description('Session management commands');

sessionCommand
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

sessionCommand
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

sessionCommand
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

sessionCommand
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
        // Check if session has a completed event
        const completedEvents = await db
          .select()
          .from(events)
          .where(
            and(
              eq(events.chatSessionId, session.id),
              eq(events.eventType, 'completed')
            )
          )
          .limit(1);

        const newStatus = completedEvents.length > 0 ? 'completed' : 'error';

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
