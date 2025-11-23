# WebEDT - AI Coding Worker Website

A full-stack TypeScript application that provides a web interface for the [ai-coding-worker](https://github.com/webedt/ai-coding-worker) service. Features include user authentication, GitHub OAuth integration, and a real-time chat interface for AI-assisted coding tasks.

## Features

- **User Authentication**: Email/password authentication with Lucia Auth
- **GitHub Integration**: OAuth flow for repository access and automatic commits
- **Real-time Chat**: Server-Sent Events (SSE) for streaming AI responses
- **Session Management**: Track and resume coding sessions
- **Repository Management**: Select repositories and branches for AI tasks
- **PostgreSQL Storage**: Persistent storage of users, sessions, and messages

## Tech Stack

### Frontend
- **Vite** - Build tool with hot module replacement
- **React 18** - UI framework
- **TypeScript** - Type safety
- **React Router** - Client-side routing
- **TanStack Query** - Server state management
- **Zustand** - Client state management
- **Tailwind CSS** - Styling
- **React Hook Form + Zod** - Form validation

### Backend
- **Express.js** - Web server
- **TypeScript** - Type safety
- **Drizzle ORM** - SQL-first ORM
- **PostgreSQL** - Database
- **Lucia Auth** - Authentication
- **Octokit** - GitHub API client
- **better-sse** - Server-Sent Events

## Project Structure

```
webedt-website/
├── apps/
│   ├── client/              # Vite + React frontend
│   │   ├── src/
│   │   │   ├── components/  # React components
│   │   │   ├── pages/       # Page components
│   │   │   ├── hooks/       # Custom hooks
│   │   │   ├── lib/         # Utilities, API, store
│   │   │   ├── App.tsx      # Main app component
│   │   │   └── main.tsx     # Entry point
│   │   └── package.json
│   └── server/              # Express backend
│       ├── src/
│       │   ├── routes/      # API routes
│       │   ├── middleware/  # Express middleware
│       │   ├── db/          # Database schema and client
│       │   ├── auth.ts      # Lucia configuration
│       │   └── index.ts     # Server entry point
│       └── package.json
├── packages/
│   └── shared/              # Shared TypeScript types
│       └── src/
│           └── types.ts
├── pnpm-workspace.yaml
└── package.json
```

## Prerequisites

1. **Node.js** 20+ and **pnpm** installed
2. **PostgreSQL** database (credentials provided)
3. **ai-coding-worker** running on localhost:5001
4. **GitHub OAuth App** (for repository access)
5. **Claude OAuth credentials** (see ai-coding-worker CREDENTIALS.md)

## Setup Instructions

### 1. Install Dependencies

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install all dependencies
pnpm install
```

### 2. Configure Environment Variables

#### Backend (.env in apps/server/)

Already configured with your PostgreSQL credentials:

```env
DATABASE_URL=postgresql://postgres:nen6macmosi5ztxs@webedt-app-webedt-9neuux:5432/postgres
SESSION_SECRET=change-this-to-a-random-string-in-production
GITHUB_OAUTH_CLIENT_ID=your-github-client-id
GITHUB_OAUTH_CLIENT_SECRET=your-github-client-secret
GITHUB_OAUTH_REDIRECT_URL=http://localhost:3000/auth/github/callback
AI_WORKER_URL=http://localhost:5001
PORT=3001
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

**Important**: Update `SESSION_SECRET` and add your GitHub OAuth credentials.

#### Frontend (.env in apps/client/)

```env
VITE_API_BASE_URL=http://localhost:3001
```

### 3. Setup GitHub OAuth App

1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: WebEDT (or your choice)
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:3001/api/github/oauth/callback`
4. Copy the Client ID and Client Secret to your `.env` file

### 4. Initialize Database

```bash
# Navigate to server directory
cd apps/server

# Generate migration files
pnpm db:generate

# Run migrations
pnpm db:migrate

# Or use push for development (applies schema directly)
pnpm db:push
```

### 5. Start Development Servers

Open **three terminals**:

```bash
# Terminal 1: Start ai-coding-worker
cd path/to/ai-coding-worker
npm run dev

# Terminal 2: Start backend server
cd apps/server
pnpm dev

# Terminal 3: Start frontend
cd apps/client
pnpm dev
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001
- **AI Worker**: http://localhost:5001

## Usage Guide

### 1. Create an Account

1. Navigate to http://localhost:5173
2. Click "create a new account"
3. Register with email and password

### 2. Connect GitHub

1. Go to Settings page
2. Click "Connect GitHub"
3. Authorize the OAuth app
4. You'll be redirected back with GitHub connected

### 3. Add Claude Credentials

1. Follow instructions in ai-coding-worker's `CREDENTIALS.md` to obtain Claude OAuth tokens
2. In Settings, paste the JSON with your credentials:
   ```json
   {
     "accessToken": "...",
     "refreshToken": "...",
     "expiresAt": 123456789,
     "scopes": ["..."],
     "subscriptionType": "...",
     "rateLimitTier": "..."
   }
   ```
3. Click "Save Claude Credentials"

**Note**: The save endpoint needs to be implemented. For now, this is a UI placeholder.

### 4. Start a Coding Session

1. Click "New Session" from Dashboard
2. Select a repository (optional)
3. Specify a branch (optional)
4. Toggle "Auto-commit" if desired
5. Type your coding request
6. Watch as the AI streams responses in real-time

### 5. View Previous Sessions

- Dashboard shows all my sessions
- Click on any session to view its chat history
- Sessions include status (pending, running, completed, error)

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Sign in
- `POST /api/auth/logout` - Sign out
- `GET /api/auth/session` - Get current session

### GitHub
- `GET /api/github/oauth` - Initiate OAuth flow
- `GET /api/github/oauth/callback` - OAuth callback
- `GET /api/github/repos` - List repositories
- `GET /api/github/repos/:owner/:repo/branches` - List branches
- `POST /api/github/disconnect` - Disconnect GitHub

### Sessions
- `GET /api/sessions` - List all user sessions
- `GET /api/sessions/:id` - Get session details
- `GET /api/sessions/:id/messages` - Get session messages
- `DELETE /api/sessions/:id` - Delete session

### Execution
- `POST /api/execute` - Execute AI task (SSE stream)

## Database Schema

### Users
- `id` - Serial primary key
- `email` - Unique email
- `passwordHash` - Bcrypt hash
- `githubId` - GitHub user ID
- `githubAccessToken` - GitHub OAuth token
- `claudeAuth` - Claude credentials (JSON)
- `createdAt` - Timestamp

### Sessions (Lucia)
- `id` - Session ID
- `userId` - Foreign key to users
- `expiresAt` - Expiration timestamp

### Chat Sessions
- `id` - Serial primary key
- `userId` - Foreign key to users
- `aiWorkerSessionId` - ai-coding-worker session ID
- `userRequest` - Original request
- `status` - pending/running/completed/error
- `repositoryUrl` - Optional GitHub repo
- `branch` - Optional branch
- `autoCommit` - Boolean
- `createdAt` - Timestamp
- `completedAt` - Optional completion timestamp

### Messages
- `id` - Serial primary key
- `chatSessionId` - Foreign key to chat_sessions
- `type` - user/assistant/system/error
- `content` - Message text
- `timestamp` - Timestamp

## Development Commands

### Root
```bash
pnpm dev        # Start all apps in parallel
pnpm build      # Build all apps
pnpm clean      # Clean all build artifacts
```

### Server
```bash
pnpm dev        # Start with tsx watch
pnpm build      # Compile TypeScript
pnpm start      # Run production build
pnpm db:generate # Generate migrations
pnpm db:migrate  # Run migrations
pnpm db:push     # Push schema (dev)
pnpm db:studio   # Open Drizzle Studio
```

### Client
```bash
pnpm dev        # Start Vite dev server
pnpm build      # Build for production
pnpm preview    # Preview production build
```

## Troubleshooting

### Database Connection Errors

If you see "Connection timeout" errors:
1. Verify the DATABASE_URL is correct
2. Check if PostgreSQL is accessible from your network
3. Try increasing `connectionTimeoutMillis` in [apps/server/src/db/index.ts](apps/server/src/db/index.ts)

### SSE Connection Issues

If streaming doesn't work:
1. Check that ai-coding-worker is running on localhost:5001
2. Verify Claude credentials are valid
3. Check browser console for CORS errors
4. Ensure cookies are enabled (required for authentication)

### GitHub OAuth Fails

If GitHub redirect doesn't work:
1. Verify callback URL matches your OAuth app settings
2. Check that `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are set
3. Ensure you're logged in before clicking "Connect GitHub"

### Build Errors

If you encounter TypeScript errors:
1. Run `pnpm install` in root directory
2. Delete `node_modules` and `.pnpm-store`, then reinstall
3. Check that all workspace dependencies use `workspace:*`

## Production Deployment

### Environment Variables

Update for production:
- Generate strong `SESSION_SECRET`
- Use production database URL
- Update `ALLOWED_ORIGINS` to your domain
- Set `NODE_ENV=production`
- Configure SSL for PostgreSQL

### Build

```bash
pnpm build
```

### Database Migrations

```bash
cd apps/server
pnpm db:migrate
```

### Deployment Options

**Backend**:
- Deploy to any Node.js host (Heroku, Render, Railway, etc.)
- Ensure PostgreSQL is accessible
- Set all environment variables

**Frontend**:
- Deploy to Vercel, Netlify, or Cloudflare Pages
- Set `VITE_API_BASE_URL` to your backend URL
- Configure build command: `pnpm build`
- Set publish directory: `apps/client/dist`

## Future Enhancements

- [ ] Implement Claude credentials save endpoint
- [ ] Add message editing and regeneration
- [ ] Implement session sharing
- [ ] Add file upload for context
- [ ] Support multiple AI providers
- [ ] Add syntax highlighting for code blocks
- [ ] Implement session export (JSON, Markdown)
- [ ] Add user profile customization
- [ ] Support dark mode toggle
- [ ] Add email verification
- [ ] Implement rate limiting
- [ ] Add analytics and usage tracking

## Contributing

This is a custom project. For issues or questions, refer to the ai-coding-worker repository at https://github.com/webedt/ai-coding-worker

## License

MIT
