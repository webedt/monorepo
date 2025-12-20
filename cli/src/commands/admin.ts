import { Command } from 'commander';
import { db, users, lucia } from '@webedt/shared';
import { eq, desc } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

export const adminCommand = new Command('admin')
  .description('Admin operations');

adminCommand
  .command('users')
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

adminCommand
  .command('user <userId>')
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

adminCommand
  .command('create-user <email> <password>')
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

adminCommand
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

adminCommand
  .command('delete-user <userId>')
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
