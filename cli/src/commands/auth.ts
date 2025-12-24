import { Command } from 'commander';
import {
  getClaudeCredentials,
  shouldRefreshClaudeToken,
  refreshClaudeToken,
  ensureValidToken,
} from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';

export const authCommand = new Command('auth')
  .description('Authentication utilities');

authCommand
  .command('check')
  .description('Check Claude authentication status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const auth = await getClaudeCredentials();

      if (!auth) {
        if (options.json) {
          console.log(JSON.stringify({ authenticated: false, source: null, error: 'No credentials found' }, null, 2));
        } else {
          console.log('\nClaude Authentication Status:');
          console.log('  Authenticated: No');
          console.log('  Error: No credentials found');
          console.log('');
          console.log('To authenticate, set CLAUDE_ACCESS_TOKEN environment variable');
          console.log('or configure credentials in macOS Keychain.');
        }
        process.exit(1);
      }

      const needsRefresh = shouldRefreshClaudeToken(auth);
      const expiresAt = auth.expiresAt ? new Date(auth.expiresAt * 1000) : null;
      const isExpired = expiresAt ? expiresAt < new Date() : false;
      const source = (auth as ClaudeAuth & { source?: string }).source || 'unknown';

      if (options.json) {
        console.log(JSON.stringify({
          authenticated: true,
          source,
          needsRefresh,
          isExpired,
          expiresAt: expiresAt?.toISOString() || null,
          hasRefreshToken: !!auth.refreshToken,
          scopes: auth.scopes || [],
          subscriptionType: (auth as ClaudeAuth & { subscriptionType?: string }).subscriptionType || null,
          rateLimitTier: (auth as ClaudeAuth & { rateLimitTier?: string }).rateLimitTier || null,
        }, null, 2));
        return;
      }

      console.log('\nClaude Authentication Status:');
      console.log(`  Authenticated:  Yes`);
      console.log(`  Source:         ${source}`);
      console.log(`  Token Valid:    ${isExpired ? 'No (expired)' : 'Yes'}`);
      console.log(`  Needs Refresh:  ${needsRefresh ? 'Yes' : 'No'}`);
      if (expiresAt) {
        console.log(`  Expires At:     ${expiresAt.toISOString()}`);
      }
      console.log(`  Has Refresh:    ${auth.refreshToken ? 'Yes' : 'No'}`);
      if (auth.scopes?.length) {
        console.log(`  Scopes:         ${auth.scopes.join(', ')}`);
      }
      const extAuth = auth as ClaudeAuth & { subscriptionType?: string; rateLimitTier?: string };
      if (extAuth.subscriptionType) {
        console.log(`  Subscription:   ${extAuth.subscriptionType}`);
      }
      if (extAuth.rateLimitTier) {
        console.log(`  Rate Limit:     ${extAuth.rateLimitTier}`);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ authenticated: false, error: String(error) }, null, 2));
      } else {
        console.error('Error checking authentication:', error);
      }
      process.exit(1);
    }
  });

authCommand
  .command('refresh')
  .description('Refresh Claude access token')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const auth = await getClaudeCredentials();

      if (!auth) {
        console.error('No credentials found to refresh');
        process.exit(1);
      }

      if (!auth.refreshToken) {
        console.error('No refresh token available');
        process.exit(1);
      }

      console.log('Refreshing Claude access token...');
      const refreshed = await refreshClaudeToken(auth);

      const expiresAt = refreshed.expiresAt ? new Date(refreshed.expiresAt * 1000) : null;

      if (options.json) {
        console.log(JSON.stringify({
          success: true,
          expiresAt: expiresAt?.toISOString() || null,
        }, null, 2));
        return;
      }

      console.log('Token refreshed successfully!');
      if (expiresAt) {
        console.log(`  New expiry: ${expiresAt.toISOString()}`);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: String(error) }, null, 2));
      } else {
        console.error('Error refreshing token:', error);
      }
      process.exit(1);
    }
  });

authCommand
  .command('ensure')
  .description('Ensure Claude token is valid (refresh if needed)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const auth = await getClaudeCredentials();

      if (!auth) {
        console.error('No credentials found');
        process.exit(1);
      }

      const validated = await ensureValidToken(auth);
      const expiresAt = validated.expiresAt ? new Date(validated.expiresAt * 1000) : null;
      const wasRefreshed = validated.accessToken !== auth.accessToken;

      if (options.json) {
        console.log(JSON.stringify({
          valid: true,
          wasRefreshed,
          expiresAt: expiresAt?.toISOString() || null,
        }, null, 2));
        return;
      }

      console.log(`Token is valid${wasRefreshed ? ' (was refreshed)' : ''}`);
      if (expiresAt) {
        console.log(`  Expires: ${expiresAt.toISOString()}`);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ valid: false, error: String(error) }, null, 2));
      } else {
        console.error('Error ensuring valid token:', error);
      }
      process.exit(1);
    }
  });
