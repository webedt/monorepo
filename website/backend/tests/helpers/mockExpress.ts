/**
 * Mock Express Request/Response for testing route handlers
 */

import type { Request, Response } from 'express';
import type { User, Session } from 'lucia';

export interface MockRequest extends Partial<Request> {
  body: Record<string, unknown>;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  user?: User | null;
  authSession?: Session | null;
}

export interface MockResponse extends Partial<Response> {
  statusCode: number;
  data: unknown;
  headers: Map<string, string>;
  cookies: Map<string, string>;
}

export function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: null,
    authSession: null,
    ...overrides,
  };
}

export function createMockResponse(): MockResponse & {
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
  appendHeader: (name: string, value: string) => MockResponse;
  setHeader: (name: string, value: string) => MockResponse;
} {
  const state = {
    statusCode: 200,
    data: null as unknown,
    headers: new Map<string, string>(),
    cookies: new Map<string, string>(),
  };

  const mockRes = {
    get statusCode() { return state.statusCode; },
    set statusCode(code: number) { state.statusCode = code; },
    get data() { return state.data; },
    get headers() { return state.headers; },
    get cookies() { return state.cookies; },
    status(code: number) {
      state.statusCode = code;
      return mockRes;
    },
    json(data: unknown) {
      state.data = data;
      return mockRes;
    },
    appendHeader(name: string, value: string) {
      state.headers.set(name, value);
      return mockRes;
    },
    setHeader(name: string, value: string) {
      state.headers.set(name, value);
      return mockRes;
    },
  };

  return mockRes as MockResponse & typeof mockRes;
}

export function createMockUser(overrides: Partial<User> = {}): User {
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

export function createMockSession(userId: string = 'test-user-id'): Session {
  return {
    id: 'test-session-id',
    userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    fresh: false,
  };
}

export function createMockNext(): () => void {
  return () => {};
}
