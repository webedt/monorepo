/**
 * OpenAPI/Swagger Configuration
 * Defines the OpenAPI 3.0 specification for the WebEDT API
 */

import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * OpenAPI 3.0 specification options
 */
const swaggerOptions: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'WebEDT API',
      version: '1.0.0',
      description: `
WebEDT is an AI-powered code editing platform. This API provides endpoints for:

- **Authentication**: User registration, login, logout, and session management
- **Sessions**: AI coding session management (create, list, update, delete)
- **GitHub**: OAuth integration, repository operations, file management
- **AI Execution**: Claude Remote Sessions for AI-assisted coding
- **Store**: Game/asset store browsing and management
- **Community**: Social features, channels, and real-time messaging

## Authentication

Most endpoints require authentication via session cookies. After logging in,
the server sets a session cookie that must be included in subsequent requests.

## Response Format

All responses follow a standardized format:

**Success Response:**
\`\`\`json
{
  "success": true,
  "data": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
\`\`\`

**Error Response:**
\`\`\`json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "fields": { "fieldName": ["error message"] }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
\`\`\`

## Rate Limiting

API endpoints may be rate-limited at the infrastructure level.
      `,
      contact: {
        name: 'WebEDT Support',
        email: 'support@webedt.com',
      },
      license: {
        name: 'Proprietary',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'Current server',
      },
    ],
    tags: [
      { name: 'Health', description: 'Health check and monitoring endpoints' },
      { name: 'Auth', description: 'Authentication and session management' },
      { name: 'Sessions', description: 'AI coding session operations' },
      { name: 'GitHub', description: 'GitHub OAuth and repository operations' },
      { name: 'Execute', description: 'AI execution endpoints (SSE streaming)' },
      { name: 'User', description: 'User profile and settings' },
      { name: 'Admin', description: 'Administrative operations (admin only)' },
      { name: 'Store', description: 'Game/asset store operations' },
      { name: 'Library', description: 'User library management' },
      { name: 'Community', description: 'Community posts and discussions' },
      { name: 'Channels', description: 'Real-time messaging channels' },
      { name: 'Storage', description: 'User storage quota management' },
      { name: 'Billing', description: 'Subscription and billing management' },
      { name: 'Collections', description: 'User-created session collections' },
      { name: 'Workspace', description: 'Workspace presence and events' },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'auth_session',
          description: 'Session cookie set after successful login',
        },
      },
      schemas: {
        // Common response schemas
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' },
          },
          required: ['success', 'data', 'timestamp'],
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                code: { type: 'string', enum: [
                  'VALIDATION_ERROR',
                  'UNAUTHORIZED',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'CONFLICT',
                  'RATE_LIMITED',
                  'INTERNAL_ERROR',
                  'BAD_REQUEST',
                  'SERVICE_UNAVAILABLE',
                ]},
                fields: {
                  type: 'object',
                  additionalProperties: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
              required: ['message'],
            },
            timestamp: { type: 'string', format: 'date-time' },
          },
          required: ['success', 'error', 'timestamp'],
        },

        // User schemas
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'User ID' },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string', nullable: true },
            githubId: { type: 'string', nullable: true },
            githubAccessToken: { type: 'string', nullable: true },
            claudeAuth: { type: 'object', nullable: true },
            codexAuth: { type: 'object', nullable: true },
            geminiAuth: { type: 'object', nullable: true },
            preferredProvider: { type: 'string', enum: ['claude', 'codex', 'gemini'], default: 'claude' },
            imageResizeMaxDimension: { type: 'integer', nullable: true },
            voiceCommandKeywords: { type: 'array', items: { type: 'string' } },
            defaultLandingPage: { type: 'string', default: 'store' },
            preferredModel: { type: 'string', nullable: true },
            isAdmin: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // Session schemas
        ChatSession: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string' },
            sessionPath: { type: 'string', nullable: true },
            repositoryOwner: { type: 'string', nullable: true },
            repositoryName: { type: 'string', nullable: true },
            repositoryUrl: { type: 'string', nullable: true },
            baseBranch: { type: 'string', nullable: true },
            branch: { type: 'string', nullable: true },
            userRequest: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['pending', 'running', 'completed', 'error'] },
            provider: { type: 'string', enum: ['claude', 'codex', 'gemini'], nullable: true },
            remoteSessionId: { type: 'string', nullable: true },
            favorite: { type: 'boolean' },
            locked: { type: 'boolean' },
            autoCommit: { type: 'boolean' },
            totalCost: { type: 'string', nullable: true },
            shareToken: { type: 'string', nullable: true },
            shareExpiresAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
            deletedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },

        // Event schemas
        SessionEvent: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            chatSessionId: { type: 'string', format: 'uuid' },
            eventData: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },

        // GitHub schemas
        Repository: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            full_name: { type: 'string' },
            owner: {
              type: 'object',
              properties: {
                login: { type: 'string' },
              },
            },
            private: { type: 'boolean' },
            description: { type: 'string', nullable: true },
            html_url: { type: 'string', format: 'uri' },
            clone_url: { type: 'string', format: 'uri' },
            default_branch: { type: 'string' },
          },
        },
        Branch: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            protected: { type: 'boolean' },
            commit: {
              type: 'object',
              properties: {
                sha: { type: 'string' },
                url: { type: 'string', format: 'uri' },
              },
            },
          },
        },
        PullRequest: {
          type: 'object',
          properties: {
            number: { type: 'integer' },
            title: { type: 'string' },
            state: { type: 'string', enum: ['open', 'closed'] },
            htmlUrl: { type: 'string', format: 'uri' },
            head: {
              type: 'object',
              properties: {
                ref: { type: 'string' },
                sha: { type: 'string' },
              },
            },
            base: {
              type: 'object',
              properties: {
                ref: { type: 'string' },
                sha: { type: 'string' },
              },
            },
            mergeable: { type: 'boolean', nullable: true },
            merged: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // Pagination
        PaginationMeta: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            hasMore: { type: 'boolean' },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: {
                success: false,
                error: { message: 'Unauthorized', code: 'UNAUTHORIZED' },
                timestamp: '2024-01-01T00:00:00.000Z',
              },
            },
          },
        },
        Forbidden: {
          description: 'Access denied',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: {
                success: false,
                error: { message: 'Forbidden', code: 'FORBIDDEN' },
                timestamp: '2024-01-01T00:00:00.000Z',
              },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: {
                success: false,
                error: { message: 'Not found', code: 'NOT_FOUND' },
                timestamp: '2024-01-01T00:00:00.000Z',
              },
            },
          },
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: {
                success: false,
                error: {
                  message: 'Validation failed',
                  code: 'VALIDATION_ERROR',
                  fields: { email: ['Invalid email address'] },
                },
                timestamp: '2024-01-01T00:00:00.000Z',
              },
            },
          },
        },
        InternalError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: {
                success: false,
                error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
                timestamp: '2024-01-01T00:00:00.000Z',
              },
            },
          },
        },
      },
    },
    security: [{ sessionCookie: [] }],
  },
  apis: [
    // Health and metrics endpoints (in index.ts)
    path.join(__dirname, '../../index.ts'),
    // All route files
    path.join(__dirname, '../routes/*.ts'),
  ],
};

/**
 * Generate OpenAPI specification
 */
export const swaggerSpec = swaggerJSDoc(swaggerOptions);

export default swaggerSpec;
