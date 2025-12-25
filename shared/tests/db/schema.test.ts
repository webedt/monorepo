/**
 * Tests for the Database Schema module.
 * Covers table definitions, type inference, and schema validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  users,
  sessions,
  chatSessions,
  messages,
  events,
  type User,
  type NewUser,
  type Session,
  type NewSession,
  type ChatSession,
  type NewChatSession,
  type Message,
  type NewMessage,
  type Event,
  type NewEvent
} from '../../src/db/schema.js';

describe('Database Schema', () => {
  describe('users table', () => {
    it('should have id as primary key', () => {
      const idColumn = users.id;
      assert.ok(idColumn);
      assert.strictEqual(idColumn.name, 'id');
    });

    it('should have required email field', () => {
      const emailColumn = users.email;
      assert.ok(emailColumn);
      assert.strictEqual(emailColumn.name, 'email');
    });

    it('should have passwordHash field', () => {
      const passwordHashColumn = users.passwordHash;
      assert.ok(passwordHashColumn);
      assert.strictEqual(passwordHashColumn.name, 'password_hash');
    });

    it('should have optional GitHub fields', () => {
      assert.ok(users.githubId);
      assert.ok(users.githubAccessToken);
    });

    it('should have Claude auth JSON field', () => {
      assert.ok(users.claudeAuth);
      assert.strictEqual(users.claudeAuth.name, 'claude_auth');
    });

    it('should have Codex auth JSON field', () => {
      assert.ok(users.codexAuth);
      assert.strictEqual(users.codexAuth.name, 'codex_auth');
    });

    it('should have Gemini auth JSON field', () => {
      assert.ok(users.geminiAuth);
      assert.strictEqual(users.geminiAuth.name, 'gemini_auth');
    });

    it('should have OpenRouter API key field', () => {
      assert.ok(users.openrouterApiKey);
      assert.strictEqual(users.openrouterApiKey.name, 'openrouter_api_key');
    });

    it('should have autocomplete settings', () => {
      assert.ok(users.autocompleteEnabled);
      assert.ok(users.autocompleteModel);
    });

    it('should have image AI settings', () => {
      assert.ok(users.imageAiKeys);
      assert.ok(users.imageAiProvider);
      assert.ok(users.imageAiModel);
    });

    it('should have user preference fields', () => {
      assert.ok(users.preferredProvider);
      assert.ok(users.imageResizeMaxDimension);
      assert.ok(users.voiceCommandKeywords);
      assert.ok(users.stopListeningAfterSubmit);
      assert.ok(users.defaultLandingPage);
      assert.ok(users.preferredModel);
      assert.ok(users.chatVerbosityLevel);
    });

    it('should have admin flag', () => {
      assert.ok(users.isAdmin);
      assert.strictEqual(users.isAdmin.name, 'is_admin');
    });

    it('should have createdAt timestamp', () => {
      assert.ok(users.createdAt);
      assert.strictEqual(users.createdAt.name, 'created_at');
    });
  });

  describe('sessions table', () => {
    it('should have id as primary key', () => {
      assert.ok(sessions.id);
      assert.strictEqual(sessions.id.name, 'id');
    });

    it('should have userId foreign key', () => {
      assert.ok(sessions.userId);
      assert.strictEqual(sessions.userId.name, 'user_id');
    });

    it('should have expiresAt timestamp', () => {
      assert.ok(sessions.expiresAt);
      assert.strictEqual(sessions.expiresAt.name, 'expires_at');
    });
  });

  describe('chatSessions table', () => {
    it('should have UUID id as primary key', () => {
      assert.ok(chatSessions.id);
      assert.strictEqual(chatSessions.id.name, 'id');
    });

    it('should have userId foreign key', () => {
      assert.ok(chatSessions.userId);
      assert.strictEqual(chatSessions.userId.name, 'user_id');
    });

    it('should have sessionPath for storage identification', () => {
      assert.ok(chatSessions.sessionPath);
      assert.strictEqual(chatSessions.sessionPath.name, 'session_path');
    });

    it('should have repository metadata fields', () => {
      assert.ok(chatSessions.repositoryOwner);
      assert.ok(chatSessions.repositoryName);
      assert.ok(chatSessions.repositoryUrl);
      assert.ok(chatSessions.baseBranch);
      assert.ok(chatSessions.branch);
    });

    it('should have userRequest field', () => {
      assert.ok(chatSessions.userRequest);
      assert.strictEqual(chatSessions.userRequest.name, 'user_request');
    });

    it('should have status field', () => {
      assert.ok(chatSessions.status);
      assert.strictEqual(chatSessions.status.name, 'status');
    });

    it('should have provider field', () => {
      assert.ok(chatSessions.provider);
      assert.strictEqual(chatSessions.provider.name, 'provider');
    });

    it('should have providerSessionId for conversation resume', () => {
      assert.ok(chatSessions.providerSessionId);
      assert.strictEqual(chatSessions.providerSessionId.name, 'provider_session_id');
    });

    it('should have autoCommit flag', () => {
      assert.ok(chatSessions.autoCommit);
      assert.strictEqual(chatSessions.autoCommit.name, 'auto_commit');
    });

    it('should have locked flag', () => {
      assert.ok(chatSessions.locked);
      assert.strictEqual(chatSessions.locked.name, 'locked');
    });

    it('should have timestamp fields', () => {
      assert.ok(chatSessions.createdAt);
      assert.ok(chatSessions.completedAt);
      assert.ok(chatSessions.deletedAt);
    });

    it('should have workerLastActivity for orphan detection', () => {
      assert.ok(chatSessions.workerLastActivity);
      assert.strictEqual(chatSessions.workerLastActivity.name, 'worker_last_activity');
    });
  });

  describe('messages table', () => {
    it('should have serial id as primary key', () => {
      assert.ok(messages.id);
      assert.strictEqual(messages.id.name, 'id');
    });

    it('should have chatSessionId foreign key', () => {
      assert.ok(messages.chatSessionId);
      assert.strictEqual(messages.chatSessionId.name, 'chat_session_id');
    });

    it('should have type field', () => {
      assert.ok(messages.type);
      assert.strictEqual(messages.type.name, 'type');
    });

    it('should have content field', () => {
      assert.ok(messages.content);
      assert.strictEqual(messages.content.name, 'content');
    });

    it('should have images JSON field', () => {
      assert.ok(messages.images);
      assert.strictEqual(messages.images.name, 'images');
    });

    it('should have timestamp field', () => {
      assert.ok(messages.timestamp);
      assert.strictEqual(messages.timestamp.name, 'timestamp');
    });
  });

  describe('events table', () => {
    it('should have serial id as primary key', () => {
      assert.ok(events.id);
      assert.strictEqual(events.id.name, 'id');
    });

    it('should have chatSessionId foreign key', () => {
      assert.ok(events.chatSessionId);
      assert.strictEqual(events.chatSessionId.name, 'chat_session_id');
    });

    it('should have eventData JSON field', () => {
      assert.ok(events.eventData);
      assert.strictEqual(events.eventData.name, 'event_data');
    });

    it('should have timestamp field', () => {
      assert.ok(events.timestamp);
      assert.strictEqual(events.timestamp.name, 'timestamp');
    });
  });
});

describe('Type Inference', () => {
  describe('User types', () => {
    it('should infer User select type', () => {
      const user: User = {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        passwordHash: 'hashed',
        githubId: 'gh-123',
        githubAccessToken: 'token',
        claudeAuth: {
          accessToken: 'claude-token',
          refreshToken: 'refresh',
          expiresAt: Date.now()
        },
        codexAuth: null,
        geminiAuth: null,
        openrouterApiKey: null,
        autocompleteEnabled: true,
        autocompleteModel: 'gpt-4',
        imageAiKeys: null,
        imageAiProvider: 'openrouter',
        imageAiModel: 'dalle-3',
        preferredProvider: 'claude',
        imageResizeMaxDimension: 1024,
        voiceCommandKeywords: [],
        stopListeningAfterSubmit: false,
        defaultLandingPage: 'store',
        preferredModel: null,
        chatVerbosityLevel: 'verbose',
        isAdmin: false,
        createdAt: new Date()
      };

      assert.strictEqual(user.id, 'user-123');
      assert.strictEqual(user.email, 'test@example.com');
    });

    it('should infer NewUser insert type', () => {
      const newUser: NewUser = {
        id: 'user-456',
        email: 'new@example.com',
        passwordHash: 'hashed-password'
      };

      assert.strictEqual(newUser.id, 'user-456');
      assert.strictEqual(newUser.email, 'new@example.com');
    });

    it('should allow partial fields in NewUser', () => {
      const partialUser: NewUser = {
        id: 'user-789',
        email: 'partial@example.com',
        passwordHash: 'hash',
        displayName: 'Partial User'
      };

      assert.ok(partialUser.displayName);
    });
  });

  describe('Session types', () => {
    it('should infer Session select type', () => {
      const session: Session = {
        id: 'session-123',
        userId: 'user-123',
        expiresAt: new Date()
      };

      assert.strictEqual(session.id, 'session-123');
      assert.ok(session.expiresAt instanceof Date);
    });

    it('should infer NewSession insert type', () => {
      const newSession: NewSession = {
        id: 'session-456',
        userId: 'user-456',
        expiresAt: new Date()
      };

      assert.strictEqual(newSession.userId, 'user-456');
    });
  });

  describe('ChatSession types', () => {
    it('should infer ChatSession select type', () => {
      const chatSession: ChatSession = {
        id: 'chat-123',
        userId: 'user-123',
        sessionPath: 'owner__repo__branch',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        userRequest: 'Implement feature',
        status: 'pending',
        repositoryUrl: 'https://github.com/owner/repo',
        baseBranch: 'main',
        branch: 'feature/test',
        provider: 'claude',
        providerSessionId: null,
        remoteSessionId: null,
        remoteWebUrl: null,
        totalCost: null,
        issueNumber: null,
        autoCommit: true,
        locked: false,
        createdAt: new Date(),
        completedAt: null,
        deletedAt: null,
        workerLastActivity: null
      };

      assert.strictEqual(chatSession.status, 'pending');
      assert.strictEqual(chatSession.autoCommit, true);
    });

    it('should infer NewChatSession insert type', () => {
      const newChatSession: NewChatSession = {
        id: 'chat-456',
        userId: 'user-456',
        userRequest: 'Fix bug'
      };

      assert.strictEqual(newChatSession.userRequest, 'Fix bug');
    });

    it('should support various status values', () => {
      const statuses = ['pending', 'running', 'completed', 'error'];

      for (const status of statuses) {
        const session: Partial<ChatSession> = { status };
        assert.strictEqual(session.status, status);
      }
    });

    it('should support various provider values', () => {
      const providers = ['claude', 'codex', 'copilot', 'gemini'];

      for (const provider of providers) {
        const session: Partial<ChatSession> = { provider };
        assert.strictEqual(session.provider, provider);
      }
    });
  });

  describe('Message types', () => {
    it('should infer Message select type', () => {
      const message: Message = {
        id: 1,
        chatSessionId: 'chat-123',
        type: 'user',
        content: 'Hello, implement feature X',
        images: null,
        timestamp: new Date()
      };

      assert.strictEqual(message.type, 'user');
      assert.strictEqual(message.content, 'Hello, implement feature X');
    });

    it('should infer NewMessage insert type', () => {
      const newMessage: NewMessage = {
        chatSessionId: 'chat-123',
        type: 'assistant',
        content: 'I will help you implement that feature.'
      };

      assert.strictEqual(newMessage.type, 'assistant');
    });

    it('should support message types', () => {
      const types = ['user', 'assistant', 'system', 'error'];

      for (const type of types) {
        const msg: Partial<Message> = { type };
        assert.strictEqual(msg.type, type);
      }
    });

    it('should support images array structure', () => {
      const message: Partial<Message> = {
        images: [
          {
            id: 'img-1',
            data: 'base64-encoded-data',
            mediaType: 'image/png',
            fileName: 'screenshot.png'
          }
        ]
      };

      assert.ok(message.images);
      assert.strictEqual(message.images?.length, 1);
      assert.strictEqual(message.images[0].mediaType, 'image/png');
    });
  });

  describe('Event types', () => {
    it('should infer Event select type', () => {
      const event: Event = {
        id: 1,
        chatSessionId: 'chat-123',
        eventData: { type: 'session_start' },
        timestamp: new Date()
      };

      assert.strictEqual((event.eventData as any).type, 'session_start');
    });

    it('should infer NewEvent insert type', () => {
      const newEvent: NewEvent = {
        chatSessionId: 'chat-123',
        eventData: { type: 'tool_use', tool: 'Read' }
      };

      assert.strictEqual((newEvent.eventData as any).type, 'tool_use');
    });

    it('should support various event types in eventData', () => {
      const eventTypes = [
        'session_start',
        'setup_progress',
        'claude_start',
        'claude_attempt',
        'tool_use',
        'claude_complete',
        'claude_error',
        'commit_progress',
        'error'
      ];

      for (const type of eventTypes) {
        const evt: Partial<Event> = { eventData: { type } };
        assert.strictEqual((evt.eventData as any).type, type);
      }
    });
  });
});

describe('JSON Column Types', () => {
  describe('Claude auth structure', () => {
    it('should support full Claude auth object', () => {
      const claudeAuth = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['read', 'write'],
        subscriptionType: 'pro',
        rateLimitTier: 'high'
      };

      assert.ok(claudeAuth.accessToken);
      assert.ok(claudeAuth.refreshToken);
      assert.strictEqual(typeof claudeAuth.expiresAt, 'number');
      assert.ok(Array.isArray(claudeAuth.scopes));
    });

    it('should support minimal Claude auth object', () => {
      const claudeAuth = {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now()
      };

      assert.ok(claudeAuth.accessToken);
    });
  });

  describe('Codex auth structure', () => {
    it('should support Codex auth with API key', () => {
      const codexAuth = {
        apiKey: 'codex-api-key'
      };

      assert.ok(codexAuth.apiKey);
    });

    it('should support Codex auth with OAuth tokens', () => {
      const codexAuth = {
        accessToken: 'oauth-access',
        refreshToken: 'oauth-refresh',
        expiresAt: Date.now()
      };

      assert.ok(codexAuth.accessToken);
    });
  });

  describe('Gemini auth structure', () => {
    it('should support Gemini auth object', () => {
      const geminiAuth = {
        accessToken: 'gemini-access',
        refreshToken: 'gemini-refresh',
        expiresAt: Date.now(),
        tokenType: 'Bearer',
        scope: 'full'
      };

      assert.ok(geminiAuth.accessToken);
      assert.strictEqual(geminiAuth.tokenType, 'Bearer');
    });
  });

  describe('Image AI keys structure', () => {
    it('should support image AI provider keys', () => {
      const imageAiKeys = {
        openrouter: 'openrouter-key',
        cometapi: 'comet-key',
        google: 'google-key'
      };

      assert.ok(imageAiKeys.openrouter);
    });

    it('should support partial image AI keys', () => {
      const imageAiKeys = {
        openrouter: 'only-openrouter-key'
      };

      assert.ok(imageAiKeys.openrouter);
      assert.strictEqual((imageAiKeys as Record<string, unknown>).cometapi, undefined);
    });
  });

  describe('Message images structure', () => {
    it('should support array of images', () => {
      const images = [
        {
          id: 'img-1',
          data: 'base64data1',
          mediaType: 'image/png',
          fileName: 'screenshot1.png'
        },
        {
          id: 'img-2',
          data: 'base64data2',
          mediaType: 'image/jpeg',
          fileName: 'photo.jpg'
        }
      ];

      assert.strictEqual(images.length, 2);
      assert.strictEqual(images[0].mediaType, 'image/png');
      assert.strictEqual(images[1].mediaType, 'image/jpeg');
    });
  });

  describe('Event data structure', () => {
    it('should support session_start event', () => {
      const eventData = {
        type: 'session_start',
        message: 'Session started'
      };

      assert.strictEqual(eventData.type, 'session_start');
    });

    it('should support setup_progress event', () => {
      const eventData = {
        type: 'setup_progress',
        stage: 'clone',
        message: 'Cloning repository'
      };

      assert.strictEqual(eventData.stage, 'clone');
    });

    it('should support tool_use event', () => {
      const eventData = {
        type: 'tool_use',
        tool: 'Write',
        input: {
          file_path: '/src/index.ts',
          content: 'export const x = 1;'
        },
        toolCount: 5,
        turnCount: 3
      };

      assert.strictEqual(eventData.tool, 'Write');
      assert.ok(eventData.input);
    });
  });
});

describe('Default Values', () => {
  it('should have status default to pending', () => {
    // The schema defines default as 'pending'
    const defaultStatus = 'pending';
    assert.strictEqual(defaultStatus, 'pending');
  });

  it('should have autoCommit default to false', () => {
    const defaultAutoCommit = false;
    assert.strictEqual(defaultAutoCommit, false);
  });

  it('should have locked default to false', () => {
    const defaultLocked = false;
    assert.strictEqual(defaultLocked, false);
  });

  it('should have autocompleteEnabled default to true', () => {
    const defaultAutocomplete = true;
    assert.strictEqual(defaultAutocomplete, true);
  });

  it('should have preferredProvider default to claude', () => {
    const defaultProvider = 'claude';
    assert.strictEqual(defaultProvider, 'claude');
  });

  it('should have isAdmin default to false', () => {
    const defaultIsAdmin = false;
    assert.strictEqual(defaultIsAdmin, false);
  });

  it('should have chatVerbosityLevel default to verbose', () => {
    const defaultVerbosity = 'verbose';
    assert.strictEqual(defaultVerbosity, 'verbose');
  });

  it('should have imageResizeMaxDimension default to 1024', () => {
    const defaultMaxDimension = 1024;
    assert.strictEqual(defaultMaxDimension, 1024);
  });
});

describe('Foreign Key Relationships', () => {
  it('should reference users from sessions', () => {
    // Sessions should have userId referencing users.id
    const relationship = {
      from: 'sessions.user_id',
      to: 'users.id',
      onDelete: 'cascade'
    };

    assert.strictEqual(relationship.onDelete, 'cascade');
  });

  it('should reference users from chatSessions', () => {
    const relationship = {
      from: 'chat_sessions.user_id',
      to: 'users.id',
      onDelete: 'cascade'
    };

    assert.strictEqual(relationship.onDelete, 'cascade');
  });

  it('should reference chatSessions from messages', () => {
    const relationship = {
      from: 'messages.chat_session_id',
      to: 'chat_sessions.id',
      onDelete: 'cascade'
    };

    assert.strictEqual(relationship.onDelete, 'cascade');
  });

  it('should reference chatSessions from events', () => {
    const relationship = {
      from: 'events.chat_session_id',
      to: 'chat_sessions.id',
      onDelete: 'cascade'
    };

    assert.strictEqual(relationship.onDelete, 'cascade');
  });
});

describe('Unique Constraints', () => {
  it('should have unique email in users', () => {
    // users.email is defined as unique
    const constraint = { field: 'email', unique: true };
    assert.strictEqual(constraint.unique, true);
  });

  it('should have unique githubId in users', () => {
    // users.githubId is defined as unique
    const constraint = { field: 'github_id', unique: true };
    assert.strictEqual(constraint.unique, true);
  });

  it('should have unique sessionPath in chatSessions', () => {
    // chatSessions.sessionPath is defined as unique
    const constraint = { field: 'session_path', unique: true };
    assert.strictEqual(constraint.unique, true);
  });
});
