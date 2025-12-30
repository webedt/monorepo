import { Command } from 'commander';
import { db, users, lucia, ROLE_HIERARCHY } from '@webedt/shared';
import type { UserRole } from '@webedt/shared';
import { eq, desc } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const validRoles = ROLE_HIERARCHY;

export const usersCommand = new Command('users')
  .description('User management operations');

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
          role: users.role,
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
      console.log('-'.repeat(122));
      console.log(
        'ID'.padEnd(38) +
        'Email'.padEnd(30) +
        'Display Name'.padEnd(18) +
        'Role'.padEnd(12) +
        'Admin'.padEnd(8) +
        'Provider'.padEnd(12)
      );
      console.log('-'.repeat(122));

      for (const user of userList) {
        console.log(
          (user.id || '').padEnd(38) +
          (user.email || '').slice(0, 28).padEnd(30) +
          (user.displayName || '').slice(0, 16).padEnd(18) +
          (user.role || 'user').padEnd(12) +
          (user.isAdmin ? 'Yes' : 'No').padEnd(8) +
          (user.preferredProvider || 'claude').padEnd(12)
        );
      }

      console.log('-'.repeat(122));
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
      console.log(`Role:              ${user.role || 'user'}`);
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
  .option('-r, --role <role>', `User role (${validRoles.join(', ')})`, 'user')
  .action(async (email, password, options) => {
    try {
      // Validate role
      if (options.role && !validRoles.includes(options.role)) {
        console.error(`Invalid role '${options.role}'. Must be one of: ${validRoles.join(', ')}`);
        process.exit(1);
      }

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

      // Determine role - if --admin is set, role is 'admin'
      const role: UserRole = options.admin ? 'admin' : (options.role || 'user');
      // Sync isAdmin with role
      const isAdmin = options.admin || role === 'admin';

      await db.insert(users).values({
        id: userId,
        email,
        passwordHash,
        displayName: options.displayName || null,
        isAdmin,
        role,
        preferredProvider: 'claude',
      });

      console.log(`\nUser created successfully:`);
      console.log(`  ID:       ${userId}`);
      console.log(`  Email:    ${email}`);
      console.log(`  Role:     ${role}`);
      console.log(`  Admin:    ${isAdmin ? 'Yes' : 'No'}`);
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

      // Sync role with admin status
      const updateData: { isAdmin: boolean; role?: UserRole } = { isAdmin: adminStatus };
      if (adminStatus) {
        updateData.role = 'admin';
      }

      await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId));

      console.log(`User ${user.email} admin status updated to '${adminStatus}'.`);
      if (adminStatus) {
        console.log(`User role updated to 'admin'.`);
      }
    } catch (error) {
      console.error('Error updating admin status:', error);
      process.exit(1);
    }
  });

usersCommand
  .command('set-role <userId> <role>')
  .description(`Set user role (${validRoles.join(', ')})`)
  .action(async (userId, role) => {
    try {
      // Validate role
      if (!validRoles.includes(role)) {
        console.error(`Invalid role '${role}'. Must be one of: ${validRoles.join(', ')}`);
        process.exit(1);
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        console.error(`User not found: ${userId}`);
        process.exit(1);
      }

      // Sync isAdmin with role
      const isAdmin = role === 'admin';

      await db
        .update(users)
        .set({ role: role as UserRole, isAdmin })
        .where(eq(users.id, userId));

      console.log(`User ${user.email} role updated to '${role}'.`);
      console.log(`User admin status updated to '${isAdmin}'.`);
    } catch (error) {
      console.error('Error updating role:', error);
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
