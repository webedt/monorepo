import { Command } from 'commander';
import {
  listAuditLogs,
  getAuditLog,
  getAuditStats,
  isAuditAction,
  isAuditEntityType,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
} from '@webedt/shared';

import type { AuditAction, AuditEntityType } from '@webedt/shared';

export const auditCommand = new Command('audit')
  .description('Admin audit log operations');

auditCommand
  .command('list')
  .description('List audit logs')
  .option('-a, --admin <userId>', 'Filter by admin user ID')
  .option('-t, --action <action>', 'Filter by action type')
  .option('-e, --entity-type <type>', 'Filter by entity type')
  .option('-i, --entity-id <id>', 'Filter by entity ID')
  .option('--start-date <date>', 'Filter by start date (ISO 8601)')
  .option('--end-date <date>', 'Filter by end date (ISO 8601)')
  .option('-l, --limit <number>', 'Limit number of results', '50')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      // Validate action if provided
      let validatedAction: AuditAction | undefined;
      if (options.action) {
        if (!isAuditAction(options.action)) {
          console.error(`Invalid action: ${options.action}`);
          console.error(`Valid actions: ${AUDIT_ACTIONS.join(', ')}`);
          process.exit(1);
        }
        validatedAction = options.action;
      }

      // Validate entity type if provided
      let validatedEntityType: AuditEntityType | undefined;
      if (options.entityType) {
        if (!isAuditEntityType(options.entityType)) {
          console.error(`Invalid entity type: ${options.entityType}`);
          console.error(`Valid entity types: ${AUDIT_ENTITY_TYPES.join(', ')}`);
          process.exit(1);
        }
        validatedEntityType = options.entityType;
      }

      const limit = parseInt(options.limit, 10);
      const offset = parseInt(options.offset, 10);

      const result = await listAuditLogs({
        adminId: options.admin,
        action: validatedAction,
        entityType: validatedEntityType,
        entityId: options.entityId,
        startDate: options.startDate ? new Date(options.startDate) : undefined,
        endDate: options.endDate ? new Date(options.endDate) : undefined,
        limit,
        offset,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.logs.length === 0) {
        console.log('No audit logs found.');
        return;
      }

      console.log('\nAudit Logs:');
      console.log('-'.repeat(140));
      console.log(
        'Timestamp'.padEnd(24) +
        'Admin'.padEnd(30) +
        'Action'.padEnd(28) +
        'Entity Type'.padEnd(16) +
        'Entity ID'.padEnd(38)
      );
      console.log('-'.repeat(140));

      for (const log of result.logs) {
        const timestamp = new Date(log.createdAt).toISOString().slice(0, 19).replace('T', ' ');
        const adminEmail = log.admin?.email || log.adminId.slice(0, 26);
        const entityId = log.entityId || '-';

        console.log(
          timestamp.padEnd(24) +
          adminEmail.slice(0, 28).padEnd(30) +
          log.action.padEnd(28) +
          log.entityType.padEnd(16) +
          entityId.slice(0, 36).padEnd(38)
        );
      }

      console.log('-'.repeat(140));
      console.log(`Showing ${result.logs.length} of ${result.total} log(s)`);
      if (result.hasMore) {
        console.log(`Use --offset ${offset + limit} to see more`);
      }
    } catch (error) {
      console.error('Error listing audit logs:', error);
      process.exit(1);
    }
  });

auditCommand
  .command('get <logId>')
  .description('Get details of a specific audit log')
  .option('--json', 'Output as JSON')
  .action(async (logId, options) => {
    try {
      const log = await getAuditLog(logId);

      if (!log) {
        console.error(`Audit log not found: ${logId}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(log, null, 2));
        return;
      }

      console.log('\nAudit Log Details:');
      console.log('-'.repeat(60));
      console.log(`ID:           ${log.id}`);
      console.log(`Timestamp:    ${new Date(log.createdAt).toISOString()}`);
      console.log(`Admin ID:     ${log.adminId}`);
      if (log.admin) {
        console.log(`Admin Email:  ${log.admin.email}`);
        console.log(`Admin Name:   ${log.admin.displayName || 'N/A'}`);
      }
      console.log(`Action:       ${log.action}`);
      console.log(`Entity Type:  ${log.entityType}`);
      console.log(`Entity ID:    ${log.entityId || 'N/A'}`);
      console.log(`IP Address:   ${log.ipAddress || 'N/A'}`);

      if (log.previousState) {
        console.log('\nPrevious State:');
        console.log(JSON.stringify(log.previousState, null, 2));
      }

      if (log.newState) {
        console.log('\nNew State:');
        console.log(JSON.stringify(log.newState, null, 2));
      }

      if (log.metadata) {
        console.log('\nMetadata:');
        console.log(JSON.stringify(log.metadata, null, 2));
      }

      console.log('-'.repeat(60));
    } catch (error) {
      console.error('Error getting audit log:', error);
      process.exit(1);
    }
  });

auditCommand
  .command('stats')
  .description('Show audit log statistics')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const stats = await getAuditStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log('\nAudit Log Statistics:');
      console.log('-'.repeat(50));
      console.log(`Total Logs:           ${stats.totalLogs}`);
      console.log(`Recent Activity (24h): ${stats.recentActivityCount}`);

      if (Object.keys(stats.logsByAction).length > 0) {
        console.log('\nLogs by Action:');
        for (const [action, count] of Object.entries(stats.logsByAction)) {
          console.log(`  ${action.padEnd(30)} ${count}`);
        }
      }

      if (Object.keys(stats.logsByEntityType).length > 0) {
        console.log('\nLogs by Entity Type:');
        for (const [entityType, count] of Object.entries(stats.logsByEntityType)) {
          console.log(`  ${entityType.padEnd(20)} ${count}`);
        }
      }

      console.log('-'.repeat(50));
    } catch (error) {
      console.error('Error getting audit stats:', error);
      process.exit(1);
    }
  });

auditCommand
  .command('actions')
  .description('List available audit action types')
  .action(() => {
    console.log('\nAvailable Audit Actions:');
    console.log('-'.repeat(40));
    for (const action of AUDIT_ACTIONS) {
      console.log(`  ${action}`);
    }
    console.log('-'.repeat(40));
  });

auditCommand
  .command('entity-types')
  .description('List available entity types')
  .action(() => {
    console.log('\nAvailable Entity Types:');
    console.log('-'.repeat(30));
    for (const entityType of AUDIT_ENTITY_TYPES) {
      console.log(`  ${entityType}`);
    }
    console.log('-'.repeat(30));
  });
