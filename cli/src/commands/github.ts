import { Command } from 'commander';
import { Octokit } from '@octokit/rest';
import { getGitHubCredentials } from '@webedt/shared';

// Helper to get GitHub token using shared credential resolver
function getToken(options: { token?: string }): string {
  const credentials = getGitHubCredentials({ token: options.token });

  if (!credentials) {
    console.error('\nGitHub token not found. Checked:');
    console.error('  1. --token CLI option');
    console.error('  2. GITHUB_TOKEN environment variable');
    console.error('  3. gh CLI (`gh auth token`)');
    console.error('  4. macOS Keychain (gh:github.com)');
    console.error('\nTo authenticate, either:');
    console.error('  - Set GITHUB_TOKEN in your .env file');
    console.error('  - Run `gh auth login` to authenticate with GitHub CLI');
    process.exit(1);
  }

  return credentials.token;
}

export const githubCommand = new Command('github')
  .description('GitHub API operations')
  .option('-t, --token <token>', 'GitHub access token (or set GITHUB_TOKEN env)');

// ============================================================================
// REPOS SUBGROUP
// ============================================================================

const reposCommand = new Command('repos')
  .description('Repository operations');

reposCommand
  .command('list')
  .description('List repositories accessible with the token')
  .option('-l, --limit <number>', 'Limit number of results', '30')
  .action(async (options, cmd) => {
    try {
      const parentOpts = cmd.parent?.parent?.opts() || {};
      const token = getToken(parentOpts);
      const limit = parseInt(options.limit, 10);

      const octokit = new Octokit({ auth: token });
      const { data: repos } = await octokit.repos.listForAuthenticatedUser({
        sort: 'updated',
        per_page: limit,
      });

      console.log('\nRepositories:');
      console.log('-'.repeat(80));

      for (const repo of repos) {
        const visibility = repo.private ? 'private' : 'public';
        console.log(`  ${repo.full_name.padEnd(40)} (${visibility})`);
      }

      console.log('-'.repeat(80));
      console.log(`Total: ${repos.length} repository(ies)`);
    } catch (error) {
      console.error('Error listing repos:', error);
      process.exit(1);
    }
  });

// ============================================================================
// BRANCHES SUBGROUP
// ============================================================================

const branchesCommand = new Command('branches')
  .description('Branch operations');

branchesCommand
  .command('list <owner> <repo>')
  .description('List branches for a repository')
  .action(async (owner, repo, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.parent?.opts() || {};
      const token = getToken(parentOpts);

      const octokit = new Octokit({ auth: token });
      const { data: branches } = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100,
      });

      console.log(`\nBranches for ${owner}/${repo}:`);
      console.log('-'.repeat(60));

      for (const branch of branches) {
        console.log(`  ${branch.name}${branch.protected ? ' (protected)' : ''}`);
      }

      console.log('-'.repeat(60));
      console.log(`Total: ${branches.length} branch(es)`);
    } catch (error) {
      console.error('Error listing branches:', error);
      process.exit(1);
    }
  });

branchesCommand
  .command('create <owner> <repo> <branchName>')
  .description('Create a new branch from a base branch')
  .option('-b, --base <base>', 'Base branch', 'main')
  .action(async (owner, repo, branchName, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.parent?.opts() || {};
      const token = getToken(parentOpts);

      const octokit = new Octokit({ auth: token });

      // Get the SHA of the base branch
      const { data: baseBranchData } = await octokit.repos.getBranch({
        owner,
        repo,
        branch: options.base,
      });

      // Create the new branch
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: baseBranchData.commit.sha,
      });

      console.log(`Branch '${branchName}' created from '${options.base}' successfully.`);
    } catch (error) {
      console.error('Error creating branch:', error);
      process.exit(1);
    }
  });

branchesCommand
  .command('delete <owner> <repo> <branchName>')
  .description('Delete a branch')
  .option('-f, --force', 'Skip confirmation')
  .action(async (owner, repo, branchName, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.parent?.opts() || {};
      const token = getToken(parentOpts);

      if (!options.force) {
        console.log(`\nAbout to delete branch: ${branchName}`);
        console.log('Use --force to confirm deletion.');
        process.exit(0);
      }

      const octokit = new Octokit({ auth: token });
      await octokit.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });

      console.log(`Branch '${branchName}' deleted successfully.`);
    } catch (error) {
      console.error('Error deleting branch:', error);
      process.exit(1);
    }
  });

// ============================================================================
// PR SUBGROUP
// ============================================================================

const prCommand = new Command('pr')
  .description('Pull request operations');

prCommand
  .command('create <owner> <repo> <head> <base>')
  .description('Create a pull request')
  .option('--title <title>', 'PR title')
  .option('--body <body>', 'PR body')
  .action(async (owner, repo, head, base, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.parent?.opts() || {};
      const token = getToken(parentOpts);

      const title = options.title || `Merge ${head} into ${base}`;
      const body = options.body || '';

      const octokit = new Octokit({ auth: token });
      const { data: pr } = await octokit.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
      });

      console.log(`\nPull Request created:`);
      console.log(`  URL:    ${pr.html_url}`);
      console.log(`  Number: #${pr.number}`);
      console.log(`  Title:  ${pr.title}`);
    } catch (error) {
      console.error('Error creating PR:', error);
      process.exit(1);
    }
  });

prCommand
  .command('list <owner> <repo>')
  .description('List pull requests')
  .option('-s, --state <state>', 'PR state (open, closed, all)', 'open')
  .option('-l, --limit <number>', 'Limit number of results', '30')
  .action(async (owner, repo, options, cmd) => {
    try {
      const parentOpts = cmd.parent?.parent?.opts() || {};
      const token = getToken(parentOpts);
      const limit = parseInt(options.limit, 10);

      const octokit = new Octokit({ auth: token });
      const { data: prs } = await octokit.pulls.list({
        owner,
        repo,
        state: options.state as 'open' | 'closed' | 'all',
        per_page: limit,
      });

      if (prs.length === 0) {
        console.log(`No ${options.state} pull requests found.`);
        return;
      }

      console.log(`\nPull Requests for ${owner}/${repo} (${options.state}):`);
      console.log('-'.repeat(100));

      for (const pr of prs) {
        const created = new Date(pr.created_at).toISOString().slice(0, 10);
        console.log(`  #${String(pr.number).padEnd(6)} ${pr.title.slice(0, 60).padEnd(62)} ${created}`);
      }

      console.log('-'.repeat(100));
      console.log(`Total: ${prs.length} pull request(s)`);
    } catch (error) {
      console.error('Error listing PRs:', error);
      process.exit(1);
    }
  });

// ============================================================================
// REGISTER SUBCOMMANDS
// ============================================================================

githubCommand.addCommand(reposCommand);
githubCommand.addCommand(branchesCommand);
githubCommand.addCommand(prCommand);
