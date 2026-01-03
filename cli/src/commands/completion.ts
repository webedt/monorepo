/**
 * Shell Completion Command
 *
 * Generates shell completion scripts for bash, zsh, and fish.
 * Provides auto-completion for all CLI commands, subcommands, and options.
 */

import { Command } from 'commander';

// Command structure definition for completion generation
interface CommandDef {
  name: string;
  description: string;
  subcommands?: CommandDef[];
  options?: OptionDef[];
  arguments?: string[];
}

interface OptionDef {
  short?: string;
  long: string;
  description: string;
  hasValue?: boolean;
  choices?: string[];
}

// Complete command tree for the CLI
const COMMAND_TREE: CommandDef[] = [
  {
    name: 'audit',
    description: 'Admin audit log operations',
    subcommands: [
      {
        name: 'list',
        description: 'List audit logs',
        options: [
          { short: 'a', long: 'admin', description: 'Filter by admin user ID', hasValue: true },
          { short: 't', long: 'action', description: 'Filter by action type', hasValue: true },
          { short: 'e', long: 'entity-type', description: 'Filter by entity type', hasValue: true },
          { short: 'i', long: 'entity-id', description: 'Filter by entity ID', hasValue: true },
          { long: 'start-date', description: 'Filter by start date (ISO 8601)', hasValue: true },
          { long: 'end-date', description: 'Filter by end date (ISO 8601)', hasValue: true },
          { short: 'l', long: 'limit', description: 'Limit number of results', hasValue: true },
          { short: 'o', long: 'offset', description: 'Offset for pagination', hasValue: true },
          { long: 'json', description: 'Output as JSON' },
        ],
      },
      {
        name: 'get',
        description: 'Get a specific audit log entry',
        arguments: ['<auditId>'],
        options: [{ long: 'json', description: 'Output as JSON' }],
      },
      {
        name: 'stats',
        description: 'Get audit statistics',
        options: [
          { long: 'start-date', description: 'Filter by start date', hasValue: true },
          { long: 'end-date', description: 'Filter by end date', hasValue: true },
          { long: 'json', description: 'Output as JSON' },
        ],
      },
    ],
  },
  {
    name: 'auth',
    description: 'Authentication utilities',
    subcommands: [
      {
        name: 'check',
        description: 'Check Claude authentication status',
        options: [{ long: 'json', description: 'Output as JSON' }],
      },
      {
        name: 'refresh',
        description: 'Refresh Claude access token',
        options: [{ long: 'json', description: 'Output as JSON' }],
      },
      {
        name: 'ensure',
        description: 'Ensure Claude token is valid (refresh if needed)',
        options: [{ long: 'json', description: 'Output as JSON' }],
      },
    ],
  },
  {
    name: 'claude',
    description: 'Claude execution environments',
    subcommands: [
      {
        name: 'web',
        description: 'Claude Remote Sessions (cloud-based execution)',
        options: [
          { short: 't', long: 'token', description: 'Claude access token', hasValue: true },
          { short: 'e', long: 'environment', description: 'Claude environment ID', hasValue: true },
          { short: 'o', long: 'org', description: 'Organization UUID', hasValue: true },
          { short: 'v', long: 'verbose', description: 'Enable verbose output' },
        ],
        subcommands: [
          {
            name: 'list',
            description: 'List remote sessions from Anthropic API',
            options: [
              { short: 'l', long: 'limit', description: 'Limit number of results', hasValue: true },
              { long: 'today', description: 'Only show sessions created today' },
              { long: 'json', description: 'Output as JSON' },
            ],
          },
          {
            name: 'get',
            description: 'Get details of a remote session',
            arguments: ['<sessionId>'],
          },
          {
            name: 'events',
            description: 'Get events for a remote session',
            arguments: ['<sessionId>'],
            options: [{ long: 'json', description: 'Output as JSON' }],
          },
          {
            name: 'execute',
            description: 'Execute a coding task on a GitHub repository',
            arguments: ['<gitUrl>', '<prompt>'],
            options: [
              { short: 'm', long: 'model', description: 'Model to use', hasValue: true },
              { short: 'b', long: 'branch-prefix', description: 'Branch prefix', hasValue: true },
              { long: 'title', description: 'Session title', hasValue: true },
              { long: 'quiet', description: 'Only show final result' },
              { long: 'json', description: 'Output raw JSON result' },
              { long: 'jsonl', description: 'Stream events as JSON Lines' },
              { long: 'raw', description: 'Stream raw WebSocket frames' },
            ],
          },
          {
            name: 'resume',
            description: 'Send a follow-up message to an existing session',
            arguments: ['<sessionId>', '<message>'],
            options: [{ long: 'quiet', description: 'Only show final result' }],
          },
          {
            name: 'archive',
            description: 'Archive one or more remote sessions',
            arguments: ['[sessionIds...]'],
            options: [
              { long: 'today', description: 'Archive all sessions created today' },
              { long: 'all', description: 'Archive all sessions' },
              { short: 'l', long: 'limit', description: 'Limit for --today/--all', hasValue: true },
            ],
          },
          {
            name: 'rename',
            description: 'Rename a remote session',
            arguments: ['<sessionId>', '<newTitle>'],
          },
          {
            name: 'interrupt',
            description: 'Interrupt a running session',
            arguments: ['<sessionId>'],
          },
          {
            name: 'can-resume',
            description: 'Check if a session can be resumed',
            arguments: ['<sessionId>'],
            options: [
              { long: 'check-events', description: 'Also check if session has a completed event' },
              { long: 'json', description: 'Output as JSON' },
            ],
          },
          {
            name: 'is-complete',
            description: 'Check if a session is complete',
            arguments: ['<sessionId>'],
            options: [{ long: 'json', description: 'Output as JSON' }],
          },
          {
            name: 'send',
            description: 'Send a message to a session (fire-and-forget)',
            arguments: ['<sessionId>', '<message>'],
          },
          {
            name: 'set-permission',
            description: 'Set permission mode for a session',
            arguments: ['<sessionId>'],
            options: [
              {
                short: 'm',
                long: 'mode',
                description: 'Permission mode',
                hasValue: true,
                choices: ['default', 'plan', 'auto-edit'],
              },
            ],
          },
          {
            name: 'discover-env',
            description: 'Discover environment ID from existing sessions',
          },
          {
            name: 'test',
            description: 'Run test scenarios',
            subcommands: [
              { name: 'scenario1', description: 'Execute + wait + resume' },
              { name: 'scenario2', description: 'Execute + early terminate + interrupt' },
              { name: 'scenario3', description: 'Execute + terminate + queue resume' },
              { name: 'scenario4', description: 'Execute + terminate + interrupt + resume' },
              { name: 'scenario5', description: 'Double-queue test' },
              { name: 'scenario6', description: 'Execute + rename' },
              { name: 'scenario7', description: 'Execute + complete + archive' },
              { name: 'scenario8', description: 'WebSocket streaming' },
              { name: 'all', description: 'Run all test scenarios' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'db',
    description: 'Database operations',
    subcommands: [
      {
        name: 'check',
        description: 'Check database connection status',
        options: [{ long: 'json', description: 'Output as JSON' }],
      },
      {
        name: 'encrypt-data',
        description: 'Encrypt existing plain text credentials in the database',
        options: [
          { long: 'dry-run', description: 'Show what would be encrypted without making changes' },
          { long: 'json', description: 'Output as JSON' },
        ],
      },
      {
        name: 'rotate-keys',
        description: 'Rotate encryption keys for all encrypted credentials',
        options: [
          { long: 'old-key', description: 'Old encryption key', hasValue: true },
          { long: 'old-salt', description: 'Old encryption salt', hasValue: true },
          { long: 'new-key', description: 'New encryption key', hasValue: true },
          { long: 'new-salt', description: 'New encryption salt', hasValue: true },
          { long: 'dry-run', description: 'Show what would be rotated without making changes' },
          { long: 'json', description: 'Output as JSON' },
        ],
      },
    ],
  },
  {
    name: 'github',
    description: 'GitHub API operations',
    options: [{ short: 't', long: 'token', description: 'GitHub access token', hasValue: true }],
    subcommands: [
      {
        name: 'repos',
        description: 'Repository operations',
        subcommands: [
          {
            name: 'list',
            description: 'List repositories accessible with the token',
            options: [{ short: 'l', long: 'limit', description: 'Limit number of results', hasValue: true }],
          },
        ],
      },
      {
        name: 'branches',
        description: 'Branch operations',
        subcommands: [
          {
            name: 'list',
            description: 'List branches for a repository',
            arguments: ['<owner>', '<repo>'],
          },
          {
            name: 'create',
            description: 'Create a new branch from a base branch',
            arguments: ['<owner>', '<repo>', '<branchName>'],
            options: [{ short: 'b', long: 'base', description: 'Base branch', hasValue: true }],
          },
          {
            name: 'delete',
            description: 'Delete a branch',
            arguments: ['<owner>', '<repo>', '<branchName>'],
            options: [{ short: 'f', long: 'force', description: 'Skip confirmation' }],
          },
        ],
      },
      {
        name: 'pr',
        description: 'Pull request operations',
        subcommands: [
          {
            name: 'list',
            description: 'List pull requests',
            arguments: ['<owner>', '<repo>'],
            options: [
              {
                short: 's',
                long: 'state',
                description: 'PR state',
                hasValue: true,
                choices: ['open', 'closed', 'all'],
              },
              { short: 'l', long: 'limit', description: 'Limit number of results', hasValue: true },
            ],
          },
          {
            name: 'create',
            description: 'Create a pull request',
            arguments: ['<owner>', '<repo>', '<head>', '<base>'],
            options: [
              { long: 'title', description: 'PR title', hasValue: true },
              { long: 'body', description: 'PR body', hasValue: true },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'llm',
    description: 'One-off LLM requests (no session persistence)',
    subcommands: [
      {
        name: 'execute',
        description: 'Execute a one-off LLM request',
        arguments: ['<prompt>'],
        options: [
          { short: 'm', long: 'model', description: 'Model to use', hasValue: true },
          { long: 'json', description: 'Output as JSON' },
        ],
      },
    ],
  },
  {
    name: 'organizations',
    description: 'Organization/Studio management operations',
    subcommands: [
      {
        name: 'list',
        description: 'List all organizations',
        options: [{ short: 'u', long: 'user', description: 'Filter by user membership', hasValue: true }],
      },
      {
        name: 'get',
        description: 'Get details of an organization',
        arguments: ['<orgId>'],
      },
      {
        name: 'create',
        description: 'Create a new organization',
        arguments: ['<name>', '<slug>'],
        options: [
          { short: 'd', long: 'description', description: 'Organization description', hasValue: true },
          { long: 'display-name', description: 'Display name', hasValue: true },
          { long: 'website', description: 'Website URL', hasValue: true },
          { long: 'github-org', description: 'GitHub organization name', hasValue: true },
          { short: 'o', long: 'owner', description: 'Owner user ID', hasValue: true },
        ],
      },
      {
        name: 'delete',
        description: 'Delete an organization',
        arguments: ['<orgId>'],
        options: [{ short: 'f', long: 'force', description: 'Skip confirmation' }],
      },
      {
        name: 'add-member',
        description: 'Add a member to an organization',
        arguments: ['<orgId>', '<userId>'],
        options: [
          {
            short: 'r',
            long: 'role',
            description: 'Member role',
            hasValue: true,
            choices: ['owner', 'admin', 'member', 'viewer'],
          },
        ],
      },
      {
        name: 'remove-member',
        description: 'Remove a member from an organization',
        arguments: ['<orgId>', '<userId>'],
        options: [{ short: 'f', long: 'force', description: 'Skip confirmation' }],
      },
      {
        name: 'update-role',
        description: 'Update a member role',
        arguments: ['<orgId>', '<userId>', '<role>'],
      },
      {
        name: 'add-repo',
        description: 'Add a repository to an organization',
        arguments: ['<orgId>', '<owner>', '<repo>'],
        options: [{ long: 'default', description: 'Set as default repository' }],
      },
      {
        name: 'remove-repo',
        description: 'Remove a repository from an organization',
        arguments: ['<orgId>', '<owner>', '<repo>'],
        options: [{ short: 'f', long: 'force', description: 'Skip confirmation' }],
      },
      {
        name: 'set-default-repo',
        description: 'Set the default repository for an organization',
        arguments: ['<orgId>', '<owner>', '<repo>'],
      },
    ],
  },
  {
    name: 'sessions',
    description: 'Session lifecycle operations',
    subcommands: [
      {
        name: 'list',
        description: 'List all sessions',
        options: [
          { short: 'l', long: 'limit', description: 'Limit number of results', hasValue: true },
          { short: 'u', long: 'user', description: 'Filter by user ID', hasValue: true },
          {
            short: 's',
            long: 'status',
            description: 'Filter by status',
            hasValue: true,
            choices: ['pending', 'running', 'completed', 'error'],
          },
        ],
      },
      {
        name: 'get',
        description: 'Get details of a specific session',
        arguments: ['<sessionId>'],
      },
      {
        name: 'delete',
        description: 'Delete a session and its events',
        arguments: ['<sessionId>'],
        options: [{ short: 'f', long: 'force', description: 'Skip confirmation' }],
      },
      {
        name: 'events',
        description: 'List events for a session',
        arguments: ['<sessionId>'],
        options: [
          { short: 'l', long: 'limit', description: 'Limit number of results', hasValue: true },
          { long: 'json', description: 'Output as JSON' },
        ],
      },
      {
        name: 'cleanup',
        description: 'Clean up orphaned sessions',
        options: [
          { long: 'dry-run', description: 'Show what would be deleted without making changes' },
          { long: 'older-than', description: 'Delete sessions older than N days', hasValue: true },
        ],
      },
    ],
  },
  {
    name: 'users',
    description: 'User management operations',
    subcommands: [
      {
        name: 'list',
        description: 'List all users',
        options: [{ short: 'l', long: 'limit', description: 'Limit number of results', hasValue: true }],
      },
      {
        name: 'get',
        description: 'Get details of a specific user',
        arguments: ['<userId>'],
      },
      {
        name: 'create',
        description: 'Create a new user',
        arguments: ['<email>', '<password>'],
        options: [
          { short: 'd', long: 'display-name', description: 'User display name', hasValue: true },
          { short: 'a', long: 'admin', description: 'Make user an admin' },
        ],
      },
      {
        name: 'set-admin',
        description: 'Set user admin status (true or false)',
        arguments: ['<userId>', '<isAdmin>'],
      },
      {
        name: 'delete',
        description: 'Delete a user',
        arguments: ['<userId>'],
        options: [{ short: 'f', long: 'force', description: 'Skip confirmation' }],
      },
    ],
  },
];

// Global options available on the root command
const GLOBAL_OPTIONS: OptionDef[] = [
  { short: 'V', long: 'version', description: 'Output version number' },
  { short: 'h', long: 'help', description: 'Display help' },
];

// ============================================================================
// BASH COMPLETION GENERATOR
// ============================================================================

function generateBashCompletion(): string {
  const lines: string[] = [];

  lines.push('# Bash completion script for webedt CLI');
  lines.push('# Generated automatically - do not edit manually');
  lines.push('#');
  lines.push('# Installation:');
  lines.push('#   webedt completion bash > /etc/bash_completion.d/webedt');
  lines.push('#   # or for user-local installation:');
  lines.push('#   webedt completion bash >> ~/.bashrc');
  lines.push('');
  lines.push('_webedt_completions()');
  lines.push('{');
  lines.push('    local cur prev words cword');
  lines.push('    _init_completion -n : || return');
  lines.push('');
  lines.push('    local commands="' + COMMAND_TREE.map((c) => c.name).join(' ') + '"');
  lines.push('    local global_opts="--version --help -V -h"');
  lines.push('');
  lines.push('    # Determine command depth');
  lines.push('    local cmd=""');
  lines.push('    local subcmd=""');
  lines.push('    local subsubcmd=""');
  lines.push('');
  lines.push('    for ((i=1; i < cword; i++)); do');
  lines.push('        case "${words[i]}" in');
  lines.push('            -*)');
  lines.push('                ;;');
  lines.push('            *)');
  lines.push('                if [[ -z "$cmd" ]]; then');
  lines.push('                    cmd="${words[i]}"');
  lines.push('                elif [[ -z "$subcmd" ]]; then');
  lines.push('                    subcmd="${words[i]}"');
  lines.push('                elif [[ -z "$subsubcmd" ]]; then');
  lines.push('                    subsubcmd="${words[i]}"');
  lines.push('                fi');
  lines.push('                ;;');
  lines.push('        esac');
  lines.push('    done');
  lines.push('');

  // Generate completion cases for each command
  lines.push('    case "$cmd" in');
  lines.push('        "")');
  lines.push('            COMPREPLY=($(compgen -W "$commands $global_opts" -- "$cur"))');
  lines.push('            ;;');

  for (const cmd of COMMAND_TREE) {
    const cmdOpts = (cmd.options || []).map((o) => (o.short ? `-${o.short} ` : '') + `--${o.long}`).join(' ');
    const subCmds = (cmd.subcommands || []).map((s) => s.name).join(' ');

    lines.push(`        ${cmd.name})`);
    lines.push('            case "$subcmd" in');
    lines.push('                "")');
    lines.push(`                    COMPREPLY=($(compgen -W "${subCmds} ${cmdOpts}" -- "$cur"))`);
    lines.push('                    ;;');

    if (cmd.subcommands) {
      for (const sub of cmd.subcommands) {
        const subOpts = (sub.options || []).map((o) => (o.short ? `-${o.short} ` : '') + `--${o.long}`).join(' ');
        const subSubCmds = (sub.subcommands || []).map((s) => s.name).join(' ');

        lines.push(`                ${sub.name})`);
        if (sub.subcommands && sub.subcommands.length > 0) {
          lines.push('                    case "$subsubcmd" in');
          lines.push('                        "")');
          lines.push(`                            COMPREPLY=($(compgen -W "${subSubCmds} ${subOpts}" -- "$cur"))`);
          lines.push('                            ;;');
          for (const subsub of sub.subcommands) {
            const subsubOpts = (subsub.options || []).map((o) => (o.short ? `-${o.short} ` : '') + `--${o.long}`).join(' ');
            lines.push(`                        ${subsub.name})`);
            lines.push(`                            COMPREPLY=($(compgen -W "${subsubOpts}" -- "$cur"))`);
            lines.push('                            ;;');
          }
          lines.push('                    esac');
        } else {
          lines.push(`                    COMPREPLY=($(compgen -W "${subOpts}" -- "$cur"))`);
        }
        lines.push('                    ;;');
      }
    }
    lines.push('            esac');
    lines.push('            ;;');
  }

  lines.push('    esac');
  lines.push('}');
  lines.push('');
  lines.push('complete -F _webedt_completions webedt');
  lines.push('');
  lines.push('# Support for npm run cli --');
  lines.push('complete -F _webedt_completions npm');

  return lines.join('\n');
}

// ============================================================================
// ZSH COMPLETION GENERATOR
// ============================================================================

function generateZshCompletion(): string {
  const lines: string[] = [];

  lines.push('#compdef webedt');
  lines.push('');
  lines.push('# Zsh completion script for webedt CLI');
  lines.push('# Generated automatically - do not edit manually');
  lines.push('#');
  lines.push('# Installation:');
  lines.push('#   webedt completion zsh > ~/.zsh/completions/_webedt');
  lines.push('#   # Then add to ~/.zshrc:');
  lines.push('#   fpath=(~/.zsh/completions $fpath)');
  lines.push('#   autoload -Uz compinit && compinit');
  lines.push('');

  // Generate subcommand functions
  for (const cmd of COMMAND_TREE) {
    if (cmd.subcommands) {
      lines.push(`_webedt_${cmd.name}() {`);
      lines.push('    local -a subcmds');
      lines.push('    subcmds=(');
      for (const sub of cmd.subcommands) {
        lines.push(`        "${sub.name}:${sub.description.replace(/'/g, "'\\''").replace(/"/g, '\\"')}"`);
      }
      lines.push('    )');
      lines.push('    _describe -t commands "' + cmd.name + ' commands" subcmds');
      lines.push('}');
      lines.push('');

      // Generate sub-subcommand functions
      for (const sub of cmd.subcommands) {
        if (sub.subcommands) {
          lines.push(`_webedt_${cmd.name}_${sub.name}() {`);
          lines.push('    local -a subcmds');
          lines.push('    subcmds=(');
          for (const subsub of sub.subcommands) {
            lines.push(`        "${subsub.name}:${subsub.description.replace(/'/g, "'\\''").replace(/"/g, '\\"')}"`);
          }
          lines.push('    )');
          lines.push('    _describe -t commands "' + sub.name + ' commands" subcmds');
          lines.push('}');
          lines.push('');
        }
      }
    }
  }

  // Main completion function
  lines.push('_webedt() {');
  lines.push('    local context state state_descr line');
  lines.push('    typeset -A opt_args');
  lines.push('');
  lines.push('    _arguments -C \\');
  lines.push("        '(-h --help)'{-h,--help}'[Display help]' \\");
  lines.push("        '(-V --version)'{-V,--version}'[Output version number]' \\");
  lines.push("        '1: :->cmd' \\");
  lines.push("        '*: :->args'");
  lines.push('');
  lines.push('    case "$state" in');
  lines.push('        cmd)');
  lines.push('            local -a commands');
  lines.push('            commands=(');
  for (const cmd of COMMAND_TREE) {
    lines.push(`                "${cmd.name}:${cmd.description.replace(/'/g, "'\\''").replace(/"/g, '\\"')}"`);
  }
  lines.push('            )');
  lines.push('            _describe -t commands "webedt commands" commands');
  lines.push('            ;;');
  lines.push('        args)');
  lines.push('            case "${line[1]}" in');

  for (const cmd of COMMAND_TREE) {
    lines.push(`                ${cmd.name})`);
    if (cmd.subcommands) {
      lines.push(`                    _webedt_${cmd.name}`);
    }
    lines.push('                    ;;');
  }

  lines.push('            esac');
  lines.push('            ;;');
  lines.push('    esac');
  lines.push('}');
  lines.push('');
  lines.push('_webedt "$@"');

  return lines.join('\n');
}

// ============================================================================
// FISH COMPLETION GENERATOR
// ============================================================================

function generateFishCompletion(): string {
  const lines: string[] = [];

  lines.push('# Fish completion script for webedt CLI');
  lines.push('# Generated automatically - do not edit manually');
  lines.push('#');
  lines.push('# Installation:');
  lines.push('#   webedt completion fish > ~/.config/fish/completions/webedt.fish');
  lines.push('');

  // Disable file completion by default
  lines.push('complete -c webedt -f');
  lines.push('');

  // Helper function to check command depth
  lines.push('# Helper function to check if a specific command is in the current line');
  lines.push('function __webedt_using_command');
  lines.push('    set -l cmd (commandline -opc)');
  lines.push('    set -l looking_for $argv');
  lines.push('    set -l found 0');
  lines.push('    for arg in $cmd[2..-1]');
  lines.push('        if string match -q -- "$arg" $looking_for[-1]');
  lines.push('            set found (math $found + 1)');
  lines.push('            set looking_for $looking_for[1..-2]');
  lines.push('            if test (count $looking_for) -eq 0');
  lines.push('                return 0');
  lines.push('            end');
  lines.push('        end');
  lines.push('    end');
  lines.push('    return 1');
  lines.push('end');
  lines.push('');

  lines.push('function __webedt_needs_command');
  lines.push('    set -l cmd (commandline -opc)');
  lines.push('    if test (count $cmd) -eq 1');
  lines.push('        return 0');
  lines.push('    end');
  lines.push('    return 1');
  lines.push('end');
  lines.push('');

  // Top-level commands
  lines.push('# Top-level commands');
  for (const cmd of COMMAND_TREE) {
    lines.push(`complete -c webedt -n "__webedt_needs_command" -a "${cmd.name}" -d "${cmd.description}"`);
  }
  lines.push('');

  // Global options
  lines.push('# Global options');
  lines.push('complete -c webedt -n "__webedt_needs_command" -s h -l help -d "Display help"');
  lines.push('complete -c webedt -n "__webedt_needs_command" -s V -l version -d "Output version number"');
  lines.push('');

  // Generate completions for each command
  for (const cmd of COMMAND_TREE) {
    lines.push(`# ${cmd.name} subcommands`);

    // Command-level options
    if (cmd.options) {
      for (const opt of cmd.options) {
        const shortFlag = opt.short ? ` -s ${opt.short}` : '';
        const requiresArg = opt.hasValue ? ' -r' : '';
        lines.push(`complete -c webedt -n "__webedt_using_command ${cmd.name}" ${shortFlag} -l ${opt.long}${requiresArg} -d "${opt.description}"`);
      }
    }

    if (cmd.subcommands) {
      for (const sub of cmd.subcommands) {
        lines.push(`complete -c webedt -n "__webedt_using_command ${cmd.name}; and not __webedt_using_command ${cmd.name} ${sub.name}" -a "${sub.name}" -d "${sub.description}"`);

        // Subcommand options
        if (sub.options) {
          for (const opt of sub.options) {
            const shortFlag = opt.short ? ` -s ${opt.short}` : '';
            const requiresArg = opt.hasValue ? ' -r' : '';
            lines.push(`complete -c webedt -n "__webedt_using_command ${cmd.name} ${sub.name}" ${shortFlag} -l ${opt.long}${requiresArg} -d "${opt.description}"`);
          }
        }

        // Sub-subcommands
        if (sub.subcommands) {
          for (const subsub of sub.subcommands) {
            lines.push(`complete -c webedt -n "__webedt_using_command ${cmd.name} ${sub.name}; and not __webedt_using_command ${cmd.name} ${sub.name} ${subsub.name}" -a "${subsub.name}" -d "${subsub.description}"`);

            // Sub-subcommand options
            if (subsub.options) {
              for (const opt of subsub.options) {
                const shortFlag = opt.short ? ` -s ${opt.short}` : '';
                const requiresArg = opt.hasValue ? ' -r' : '';
                lines.push(`complete -c webedt -n "__webedt_using_command ${cmd.name} ${sub.name} ${subsub.name}" ${shortFlag} -l ${opt.long}${requiresArg} -d "${opt.description}"`);
              }
            }
          }
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// COMMAND EXPORT
// ============================================================================

export const completionCommand = new Command('completion')
  .description('Generate shell completion scripts')
  .argument('<shell>', 'Shell type (bash, zsh, fish)')
  .action((shell: string) => {
    switch (shell.toLowerCase()) {
      case 'bash':
        console.log(generateBashCompletion());
        break;
      case 'zsh':
        console.log(generateZshCompletion());
        break;
      case 'fish':
        console.log(generateFishCompletion());
        break;
      default:
        console.error(`Unknown shell: ${shell}`);
        console.error('Supported shells: bash, zsh, fish');
        process.exit(1);
    }
  });

// Add install subcommand for convenience
completionCommand
  .command('install <shell>')
  .description('Display installation instructions for a shell')
  .action((shell: string) => {
    switch (shell.toLowerCase()) {
      case 'bash':
        console.log(`
Bash Completion Installation
=============================

Option 1: System-wide (requires sudo)
  sudo webedt completion bash > /etc/bash_completion.d/webedt

Option 2: User-local
  mkdir -p ~/.local/share/bash-completion/completions
  webedt completion bash > ~/.local/share/bash-completion/completions/webedt

Option 3: Add to .bashrc directly
  webedt completion bash >> ~/.bashrc

After installation, restart your shell or run:
  source ~/.bashrc
`);
        break;
      case 'zsh':
        console.log(`
Zsh Completion Installation
============================

Step 1: Create completions directory
  mkdir -p ~/.zsh/completions

Step 2: Generate completion script
  webedt completion zsh > ~/.zsh/completions/_webedt

Step 3: Add to ~/.zshrc (if not already present)
  fpath=(~/.zsh/completions $fpath)
  autoload -Uz compinit && compinit

After installation, restart your shell or run:
  source ~/.zshrc
`);
        break;
      case 'fish':
        console.log(`
Fish Completion Installation
=============================

Generate and install in one command:
  webedt completion fish > ~/.config/fish/completions/webedt.fish

The completion will be available immediately in new fish sessions.
To use in the current session, run:
  source ~/.config/fish/completions/webedt.fish
`);
        break;
      default:
        console.error(`Unknown shell: ${shell}`);
        console.error('Supported shells: bash, zsh, fish');
        process.exit(1);
    }
  });
