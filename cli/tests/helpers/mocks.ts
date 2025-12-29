/**
 * Mock helpers for CLI command tests
 *
 * Provides factory functions to create mock objects for testing CLI commands
 * without requiring actual database connections or external API calls.
 */

import type { User, Session } from 'lucia';

// ============================================================================
// TYPE DEFINITIONS FOR MOCKS
// ============================================================================

export interface MockUser {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  isAdmin: boolean;
  createdAt: Date;
  githubId: string | null;
  githubAccessToken: string | null;
  claudeAuth: ClaudeAuthMock | null;
  codexAuth: unknown | null;
  geminiAuth: unknown | null;
  preferredProvider: string;
  imageResizeMaxDimension: number | null;
  voiceCommandKeywords: string[];
  defaultLandingPage: string;
  preferredModel: string | null;
}

export interface ClaudeAuthMock {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  source?: string;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

export interface MockChatSession {
  id: string;
  userId: string;
  userRequest: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  provider: string;
  sessionPath: string | null;
  repositoryOwner: string;
  repositoryName: string;
  branch: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface MockEvent {
  id: string;
  chatSessionId: string;
  eventData: Record<string, unknown>;
  timestamp: Date;
}

export interface MockRemoteSession {
  id: string;
  title: string | null;
  session_status: 'idle' | 'running' | 'completed' | 'archived';
  environment_id: string;
  created_at: string;
  updated_at: string | null;
}

export interface MockOrganization {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  description: string | null;
  websiteUrl: string | null;
  githubOrg: string | null;
  isVerified: boolean;
  createdAt: Date;
}

export interface MockOrganizationMember {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
  user: MockUser;
}

export interface MockOrganizationRepo {
  id: string;
  organizationId: string;
  repositoryOwner: string;
  repositoryName: string;
  isDefault: boolean;
  addedBy: string;
  addedAt: Date;
}

export interface MockGitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string };
}

export interface MockGitHubBranch {
  name: string;
  protected: boolean;
}

export interface MockGitHubPR {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  state: 'open' | 'closed';
  head: { ref: string };
  base: { ref: string };
}

export interface MockDatabaseCredentials {
  connectionString: string;
  source: string;
}

export interface MockParsedDbUrl {
  host: string;
  port: number;
  database: string;
  user: string;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: 'test-user-id-' + Math.random().toString(36).slice(2, 9),
    email: 'test@example.com',
    displayName: 'Test User',
    passwordHash: '$2b$10$testhashedpassword',
    isAdmin: false,
    createdAt: new Date(),
    githubId: null,
    githubAccessToken: null,
    claudeAuth: null,
    codexAuth: null,
    geminiAuth: null,
    preferredProvider: 'claude',
    imageResizeMaxDimension: null,
    voiceCommandKeywords: [],
    defaultLandingPage: 'store',
    preferredModel: null,
    ...overrides,
  };
}

export function createMockClaudeAuth(overrides: Partial<ClaudeAuthMock> = {}): ClaudeAuthMock {
  return {
    accessToken: 'test-access-token-' + Math.random().toString(36).slice(2, 9),
    refreshToken: 'test-refresh-token-' + Math.random().toString(36).slice(2, 9),
    expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    source: 'test',
    scopes: ['user:read', 'user:write'],
    subscriptionType: 'pro',
    rateLimitTier: 'standard',
    ...overrides,
  };
}

export function createMockChatSession(overrides: Partial<MockChatSession> = {}): MockChatSession {
  return {
    id: 'test-session-id-' + Math.random().toString(36).slice(2, 9),
    userId: 'test-user-id',
    userRequest: 'Test request prompt',
    status: 'completed',
    provider: 'claude',
    sessionPath: null,
    repositoryOwner: 'testowner',
    repositoryName: 'testrepo',
    branch: 'claude/test-branch',
    createdAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  };
}

export function createMockEvent(overrides: Partial<MockEvent> = {}): MockEvent {
  return {
    id: 'test-event-id-' + Math.random().toString(36).slice(2, 9),
    chatSessionId: 'test-session-id',
    eventData: { type: 'text', content: 'Test event content' },
    timestamp: new Date(),
    ...overrides,
  };
}

export function createMockRemoteSession(overrides: Partial<MockRemoteSession> = {}): MockRemoteSession {
  return {
    id: 'remote-session-id-' + Math.random().toString(36).slice(2, 9),
    title: 'Test Remote Session',
    session_status: 'completed',
    environment_id: 'test-env-id',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockOrganization(overrides: Partial<MockOrganization> = {}): MockOrganization {
  return {
    id: 'test-org-id-' + Math.random().toString(36).slice(2, 9),
    name: 'Test Organization',
    slug: 'test-org',
    displayName: 'Test Org Display',
    description: 'A test organization',
    websiteUrl: 'https://example.com',
    githubOrg: 'test-github-org',
    isVerified: false,
    createdAt: new Date(),
    ...overrides,
  };
}

export function createMockOrganizationMember(overrides: Partial<MockOrganizationMember> = {}): MockOrganizationMember {
  return {
    userId: 'test-user-id',
    role: 'member',
    joinedAt: new Date(),
    user: createMockUser(),
    ...overrides,
  };
}

export function createMockOrganizationRepo(overrides: Partial<MockOrganizationRepo> = {}): MockOrganizationRepo {
  return {
    id: 'test-repo-id-' + Math.random().toString(36).slice(2, 9),
    organizationId: 'test-org-id',
    repositoryOwner: 'testowner',
    repositoryName: 'testrepo',
    isDefault: false,
    addedBy: 'test-user-id',
    addedAt: new Date(),
    ...overrides,
  };
}

export function createMockGitHubRepo(overrides: Partial<MockGitHubRepo> = {}): MockGitHubRepo {
  return {
    id: Math.floor(Math.random() * 1000000),
    name: 'test-repo',
    full_name: 'testowner/test-repo',
    private: false,
    owner: { login: 'testowner' },
    ...overrides,
  };
}

export function createMockGitHubBranch(overrides: Partial<MockGitHubBranch> = {}): MockGitHubBranch {
  return {
    name: 'main',
    protected: false,
    ...overrides,
  };
}

export function createMockGitHubPR(overrides: Partial<MockGitHubPR> = {}): MockGitHubPR {
  return {
    number: Math.floor(Math.random() * 1000),
    title: 'Test Pull Request',
    html_url: 'https://github.com/testowner/testrepo/pull/1',
    created_at: new Date().toISOString(),
    state: 'open',
    head: { ref: 'feature-branch' },
    base: { ref: 'main' },
    ...overrides,
  };
}

export function createMockDatabaseCredentials(overrides: Partial<MockDatabaseCredentials> = {}): MockDatabaseCredentials {
  return {
    connectionString: 'postgresql://testuser:testpass@localhost:5432/testdb',
    source: 'environment',
    ...overrides,
  };
}

export function createMockParsedDbUrl(overrides: Partial<MockParsedDbUrl> = {}): MockParsedDbUrl {
  return {
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    user: 'testuser',
    ...overrides,
  };
}

// ============================================================================
// MOCK SERVICE STUBS
// ============================================================================

/**
 * Mock console for capturing output in tests
 */
export interface MockConsole {
  logs: string[];
  errors: string[];
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  reset: () => void;
  getOutput: () => string;
  getErrorOutput: () => string;
}

export function createMockConsole(): MockConsole {
  const logs: string[] = [];
  const errors: string[] = [];

  return {
    logs,
    errors,
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    },
    error: (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    },
    reset: () => {
      logs.length = 0;
      errors.length = 0;
    },
    getOutput: () => logs.join('\n'),
    getErrorOutput: () => errors.join('\n'),
  };
}

/**
 * Mock process.exit to prevent tests from actually exiting
 */
export function createMockProcessExit(): {
  exitCode: number | null;
  exit: (code?: number) => never;
} {
  const state = { exitCode: null as number | null };

  return {
    get exitCode() { return state.exitCode; },
    exit: ((code?: number): never => {
      state.exitCode = code ?? 0;
      throw new Error(`process.exit(${code ?? 0})`);
    }) as (code?: number) => never,
  };
}

// ============================================================================
// LUCIA SESSION MOCKS
// ============================================================================

export function createMockLuciaSession(userId: string = 'test-user-id'): Session {
  return {
    id: 'lucia-session-id-' + Math.random().toString(36).slice(2, 9),
    userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    fresh: false,
  };
}

export function createMockLuciaUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    displayName: null,
    passwordHash: '$2b$10$testhashedpassword',
    isAdmin: false,
    createdAt: new Date(),
    githubId: null,
    githubAccessToken: null,
    claudeAuth: null,
    codexAuth: null,
    geminiAuth: null,
    preferredProvider: 'claude',
    imageResizeMaxDimension: null,
    voiceCommandKeywords: [],
    defaultLandingPage: 'store',
    preferredModel: null,
    ...overrides,
  } as User;
}
