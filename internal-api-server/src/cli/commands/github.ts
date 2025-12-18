import { Command } from 'commander';
import { Octokit } from '@octokit/rest';

export const githubCommand = new Command('github')
  .description('GitHub operations');

githubCommand
  .command('branches <owner> <repo>')
  .description('List branches for a repository')
  .option('-t, --token <token>', 'GitHub access token (or set GITHUB_TOKEN env)')
  .action(async (owner, repo, options) => {
    try {
      const token = options.token || process.env.GITHUB_TOKEN;
      if (!token) {
        console.error('GitHub token required. Use --token or set GITHUB_TOKEN env.');
        process.exit(1);
      }

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

githubCommand
  .command('repos')
  .description('List repositories accessible with the token')
  .option('-t, --token <token>', 'GitHub access token (or set GITHUB_TOKEN env)')
  .option('-l, --limit <number>', 'Limit number of results', '30')
  .action(async (options) => {
    try {
      const token = options.token || process.env.GITHUB_TOKEN;
      if (!token) {
        console.error('GitHub token required. Use --token or set GITHUB_TOKEN env.');
        process.exit(1);
      }

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

githubCommand
  .command('create-branch <owner> <repo> <branchName>')
  .description('Create a new branch from a base branch')
  .option('-t, --token <token>', 'GitHub access token (or set GITHUB_TOKEN env)')
  .option('-b, --base <base>', 'Base branch', 'main')
  .action(async (owner, repo, branchName, options) => {
    try {
      const token = options.token || process.env.GITHUB_TOKEN;
      if (!token) {
        console.error('GitHub token required. Use --token or set GITHUB_TOKEN env.');
        process.exit(1);
      }

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

githubCommand
  .command('delete-branch <owner> <repo> <branchName>')
  .description('Delete a branch')
  .option('-t, --token <token>', 'GitHub access token (or set GITHUB_TOKEN env)')
  .option('-f, --force', 'Skip confirmation')
  .action(async (owner, repo, branchName, options) => {
    try {
      const token = options.token || process.env.GITHUB_TOKEN;
      if (!token) {
        console.error('GitHub token required. Use --token or set GITHUB_TOKEN env.');
        process.exit(1);
      }

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

githubCommand
  .command('create-pr <owner> <repo> <head> <base>')
  .description('Create a pull request')
  .option('-t, --token <token>', 'GitHub access token (or set GITHUB_TOKEN env)')
  .option('--title <title>', 'PR title')
  .option('--body <body>', 'PR body')
  .action(async (owner, repo, head, base, options) => {
    try {
      const token = options.token || process.env.GITHUB_TOKEN;
      if (!token) {
        console.error('GitHub token required. Use --token or set GITHUB_TOKEN env.');
        process.exit(1);
      }

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
