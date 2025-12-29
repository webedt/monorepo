import { Command } from 'commander';
import { organizationService, db, users } from '@webedt/shared';
import type { OrganizationRole } from '@webedt/shared';
import { eq } from 'drizzle-orm';

export const organizationsCommand = new Command('organizations')
  .alias('orgs')
  .description('Organization/Studio management operations');

organizationsCommand
  .command('list')
  .description('List all organizations')
  .option('-u, --user <userId>', 'Filter by user membership')
  .action(async (options) => {
    try {
      if (options.user) {
        const orgs = await organizationService.getUserOrganizations(options.user);

        if (orgs.length === 0) {
          console.log('No organizations found for this user.');
          return;
        }

        console.log('\nOrganizations:');
        console.log('-'.repeat(100));
        console.log(
          'ID'.padEnd(38) +
          'Name'.padEnd(25) +
          'Slug'.padEnd(20) +
          'Role'.padEnd(10) +
          'Joined'
        );
        console.log('-'.repeat(100));

        for (const { organization, role, joinedAt } of orgs) {
          console.log(
            organization.id.padEnd(38) +
            (organization.name || '').slice(0, 23).padEnd(25) +
            (organization.slug || '').slice(0, 18).padEnd(20) +
            role.padEnd(10) +
            joinedAt.toISOString().split('T')[0]
          );
        }

        console.log('-'.repeat(100));
        console.log(`Total: ${orgs.length} organization(s)`);
      } else {
        console.log('Please specify a user ID with --user <userId>');
        console.log('Listing all organizations requires database admin access.');
      }
    } catch (error) {
      console.error('Error listing organizations:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('get <orgId>')
  .description('Get details of an organization')
  .action(async (orgId) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
        process.exit(1);
      }

      const members = await organizationService.getMembers(orgId);
      const repos = await organizationService.getRepositories(orgId);

      console.log('\nOrganization Details:');
      console.log('-'.repeat(60));
      console.log(`ID:           ${org.id}`);
      console.log(`Name:         ${org.name}`);
      console.log(`Slug:         ${org.slug}`);
      console.log(`Display Name: ${org.displayName || 'N/A'}`);
      console.log(`Description:  ${org.description || 'N/A'}`);
      console.log(`Website:      ${org.websiteUrl || 'N/A'}`);
      console.log(`GitHub Org:   ${org.githubOrg || 'N/A'}`);
      console.log(`Verified:     ${org.isVerified ? 'Yes' : 'No'}`);
      console.log(`Created:      ${org.createdAt}`);

      if (members.length > 0) {
        console.log('\nMembers:');
        console.log('-'.repeat(60));
        for (const member of members) {
          console.log(`  ${member.user.email} (${member.role}) - joined ${member.joinedAt.toISOString().split('T')[0]}`);
        }
      }

      if (repos.length > 0) {
        console.log('\nRepositories:');
        console.log('-'.repeat(60));
        for (const repo of repos) {
          const defaultMarker = repo.isDefault ? ' [default]' : '';
          console.log(`  ${repo.repositoryOwner}/${repo.repositoryName}${defaultMarker}`);
        }
      }

      console.log('-'.repeat(60));
    } catch (error) {
      console.error('Error getting organization:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('create <name> <slug>')
  .description('Create a new organization')
  .option('-o, --owner <userId>', 'Owner user ID (required)')
  .option('-d, --description <description>', 'Organization description')
  .option('-g, --github <org>', 'Linked GitHub organization')
  .action(async (name, slug, options) => {
    try {
      if (!options.owner) {
        console.error('Owner user ID is required. Use --owner <userId>');
        process.exit(1);
      }

      const [owner] = await db
        .select()
        .from(users)
        .where(eq(users.id, options.owner))
        .limit(1);

      if (!owner) {
        console.error(`User not found: ${options.owner}`);
        process.exit(1);
      }

      const slugAvailable = await organizationService.isSlugAvailable(slug);
      if (!slugAvailable) {
        console.error(`Slug '${slug}' is already taken.`);
        process.exit(1);
      }

      const org = await organizationService.create(
        {
          name,
          slug,
          description: options.description,
          githubOrg: options.github,
        },
        options.owner
      );

      console.log('\nOrganization created successfully:');
      console.log(`  ID:    ${org.id}`);
      console.log(`  Name:  ${org.name}`);
      console.log(`  Slug:  ${org.slug}`);
      console.log(`  Owner: ${owner.email}`);
    } catch (error) {
      console.error('Error creating organization:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('delete <orgId>')
  .description('Delete an organization')
  .option('-f, --force', 'Skip confirmation')
  .action(async (orgId, options) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
        process.exit(1);
      }

      if (!options.force) {
        console.log(`\nAbout to delete organization: ${org.name} (${org.slug})`);
        console.log('This will remove all members and repository associations.');
        console.log('Use --force to confirm deletion.');
        process.exit(0);
      }

      await organizationService.delete(orgId);
      console.log(`Organization '${org.name}' deleted successfully.`);
    } catch (error) {
      console.error('Error deleting organization:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('members <orgId>')
  .description('List organization members')
  .action(async (orgId) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
        process.exit(1);
      }

      const members = await organizationService.getMembers(orgId);

      if (members.length === 0) {
        console.log('No members found.');
        return;
      }

      console.log(`\nMembers of ${org.name}:`);
      console.log('-'.repeat(80));
      console.log(
        'User ID'.padEnd(38) +
        'Email'.padEnd(25) +
        'Role'.padEnd(10) +
        'Joined'
      );
      console.log('-'.repeat(80));

      for (const member of members) {
        console.log(
          member.userId.padEnd(38) +
          (member.user.email || '').slice(0, 23).padEnd(25) +
          member.role.padEnd(10) +
          member.joinedAt.toISOString().split('T')[0]
        );
      }

      console.log('-'.repeat(80));
      console.log(`Total: ${members.length} member(s)`);
    } catch (error) {
      console.error('Error listing members:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('add-member <orgId> <userId>')
  .description('Add a member to an organization')
  .option('-r, --role <role>', 'Member role (owner, admin, member)', 'member')
  .action(async (orgId, userId, options) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
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

      const existingMember = await organizationService.getMember(orgId, userId);
      if (existingMember) {
        console.error(`User is already a member of this organization.`);
        process.exit(1);
      }

      const validRoles = ['owner', 'admin', 'member'];
      if (!validRoles.includes(options.role)) {
        console.error(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
        process.exit(1);
      }

      await organizationService.addMember(orgId, userId, options.role);
      console.log(`Added ${user.email} to ${org.name} as ${options.role}.`);
    } catch (error) {
      console.error('Error adding member:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('remove-member <orgId> <userId>')
  .description('Remove a member from an organization')
  .option('-f, --force', 'Skip confirmation')
  .action(async (orgId, userId, options) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
        process.exit(1);
      }

      const member = await organizationService.getMember(orgId, userId);
      if (!member) {
        console.error(`User is not a member of this organization.`);
        process.exit(1);
      }

      if (member.role === 'owner') {
        const members = await organizationService.getMembers(orgId);
        const otherOwners = members.filter(m => m.role === 'owner' && m.userId !== userId);
        if (otherOwners.length === 0) {
          console.error(`Cannot remove the only owner. Transfer ownership first.`);
          process.exit(1);
        }
      }

      if (!options.force) {
        console.log(`\nAbout to remove user from ${org.name}`);
        console.log('Use --force to confirm.');
        process.exit(0);
      }

      await organizationService.removeMember(orgId, userId);
      console.log(`Member removed from ${org.name}.`);
    } catch (error) {
      console.error('Error removing member:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('set-role <orgId> <userId> <role>')
  .description('Update member role (owner, admin, member)')
  .action(async (orgId, userId, role) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
        process.exit(1);
      }

      const validRoles: OrganizationRole[] = ['owner', 'admin', 'member'];
      if (!validRoles.includes(role as OrganizationRole)) {
        console.error(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
        process.exit(1);
      }

      const member = await organizationService.updateMemberRole(orgId, userId, role as OrganizationRole);
      if (!member) {
        console.error(`Member not found.`);
        process.exit(1);
      }

      console.log(`Updated member role to ${role}.`);
    } catch (error) {
      console.error('Error updating role:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('repos <orgId>')
  .description('List organization repositories')
  .action(async (orgId) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
        process.exit(1);
      }

      const repos = await organizationService.getRepositories(orgId);

      if (repos.length === 0) {
        console.log('No repositories found.');
        return;
      }

      console.log(`\nRepositories of ${org.name}:`);
      console.log('-'.repeat(70));
      console.log(
        'Owner'.padEnd(20) +
        'Repo'.padEnd(30) +
        'Default'.padEnd(10) +
        'Added'
      );
      console.log('-'.repeat(70));

      for (const repo of repos) {
        console.log(
          repo.repositoryOwner.slice(0, 18).padEnd(20) +
          repo.repositoryName.slice(0, 28).padEnd(30) +
          (repo.isDefault ? 'Yes' : 'No').padEnd(10) +
          repo.addedAt.toISOString().split('T')[0]
        );
      }

      console.log('-'.repeat(70));
      console.log(`Total: ${repos.length} repository(ies)`);
    } catch (error) {
      console.error('Error listing repositories:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('add-repo <orgId> <owner> <repo>')
  .description('Add a repository to an organization')
  .option('-u, --added-by <userId>', 'User who added the repo')
  .option('-d, --default', 'Set as default repository')
  .action(async (orgId, owner, repo, options) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
        process.exit(1);
      }

      if (!options.addedBy) {
        console.error('--added-by <userId> is required to track who added the repository');
        process.exit(1);
      }

      await organizationService.addRepository({
        organizationId: orgId,
        repositoryOwner: owner,
        repositoryName: repo,
        isDefault: options.default ?? false,
        addedBy: options.addedBy,
      });

      console.log(`Added ${owner}/${repo} to ${org.name}.`);
    } catch (error) {
      console.error('Error adding repository:', error);
      process.exit(1);
    }
  });

organizationsCommand
  .command('remove-repo <orgId> <owner> <repo>')
  .description('Remove a repository from an organization')
  .action(async (orgId, owner, repo) => {
    try {
      const org = await organizationService.getById(orgId);

      if (!org) {
        console.error(`Organization not found: ${orgId}`);
        process.exit(1);
      }

      const removed = await organizationService.removeRepository(orgId, owner, repo);
      if (!removed) {
        console.error(`Repository not found.`);
        process.exit(1);
      }

      console.log(`Removed ${owner}/${repo} from ${org.name}.`);
    } catch (error) {
      console.error('Error removing repository:', error);
      process.exit(1);
    }
  });
