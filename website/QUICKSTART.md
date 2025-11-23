# Quick Start Guide

This guide will help you get the WebEDT application running in under 10 minutes.

## Prerequisites Checklist

- [ ] Node.js 20+ installed (`node --version`)
- [ ] pnpm installed (`pnpm --version`) - If not: `npm install -g pnpm`
- [ ] PostgreSQL database accessible (credentials provided in .env)
- [ ] ai-coding-worker repository cloned and ready
- [ ] GitHub OAuth App created (optional, can do later)

## Step 1: Install Dependencies (2 minutes)

```bash
# From the root directory
pnpm install
```

This will install all dependencies for the monorepo (client, server, and shared packages).

## Step 2: Setup Database (1 minute)

```bash
cd apps/server

# Push the schema to your database
pnpm db:push

# Or generate and run migrations (recommended for production)
pnpm db:generate
pnpm db:migrate
```

The database credentials are already configured in `apps/server/.env`:
```
DATABASE_URL=postgresql://postgres:nen6macmosi5ztxs@webedt-app-webedt-9neuux:5432/postgres
```

## Step 3: Configure GitHub OAuth (Optional - 3 minutes)

If you want to use GitHub integration:

1. Go to [GitHub OAuth Apps](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: WebEDT Local
   - **Homepage URL**: `http://localhost:5173`
   - **Callback URL**: `http://localhost:3001/api/github/oauth/callback`
4. Copy the Client ID and Secret
5. Update `apps/server/.env`:
   ```env
   GITHUB_OAUTH_CLIENT_ID=your_client_id_here
   GITHUB_OAUTH_CLIENT_SECRET=your_client_secret_here
   ```

**Skip this step for now?** You can still use the app without GitHub integration and add it later.

## Step 4: Start All Services (1 minute)

You need **three terminals**:

### Terminal 1: AI Coding Worker
```bash
cd /path/to/ai-coding-worker
npm run dev
```

Wait for: `Server listening on port 5001`

### Terminal 2: Backend Server
```bash
cd apps/server
pnpm dev
```

Wait for: `Server running on http://localhost:3001`

### Terminal 3: Frontend
```bash
cd apps/client
pnpm dev
```

Wait for: `Local: http://localhost:5173/`

## Step 5: Create Your First Account (1 minute)

1. Open http://localhost:5173 in your browser
2. Click "create a new account"
3. Enter email and password (min 8 characters)
4. Click "Create account"

You'll be automatically logged in and redirected to the dashboard.

## Step 6: Add Claude Credentials (2 minutes)

To use the AI coding assistant, you need Claude OAuth credentials:

1. Go to Settings page (click "Settings" in navigation)
2. Scroll to "Claude Authentication"
3. Follow the instructions in ai-coding-worker's `CREDENTIALS.md` to get your tokens
4. Paste the JSON into the textarea:
   ```json
   {
     "accessToken": "...",
     "refreshToken": "...",
     "expiresAt": 1234567890,
     "scopes": ["..."],
     "subscriptionType": "...",
     "rateLimitTier": "..."
   }
   ```
5. Click "Save Claude Credentials"

## Step 7: Start Coding! (1 minute)

1. Click "New Session" from the Dashboard
2. (Optional) Select a repository and branch if you connected GitHub
3. Type your coding request, for example:
   - "Create a Python function to calculate fibonacci numbers"
   - "Write a React component for a todo list"
   - "Help me refactor this code to use async/await"
4. Click "Send"
5. Watch the AI stream responses in real-time!

## Troubleshooting

### "Connection refused" when starting servers

Make sure each service is running on the correct port:
- Frontend: 5173
- Backend: 3001
- AI Worker: 5001

### "Database connection failed"

1. Check that the DATABASE_URL is correct in `apps/server/.env`
2. Verify PostgreSQL is accessible from your machine
3. Try connecting with `psql` or a database client

### "GitHub OAuth failed"

1. Verify callback URL matches exactly: `http://localhost:3001/api/github/oauth/callback`
2. Check client ID and secret are correct
3. Make sure you're logged into the app before clicking "Connect GitHub"

### "Claude credentials invalid"

1. Make sure the JSON is valid (check for missing quotes, commas)
2. Verify you copied all required fields
3. Check that tokens haven't expired (expiresAt is in the future)

### SSE streaming not working

1. Verify ai-coding-worker is running on port 5001
2. Check browser console for errors
3. Make sure cookies are enabled
4. Try refreshing the page

## Next Steps

- **Explore Sessions**: View your chat history in the Dashboard
- **Connect GitHub**: Go to Settings > GitHub Integration
- **Try Different Repos**: Test the AI with various codebases
- **Read Full Docs**: Check out the main [README.md](README.md) for detailed information

## Common Commands

```bash
# Root directory
pnpm install          # Install all dependencies
pnpm dev             # Start all services in parallel (requires tmux/pm2)
pnpm build           # Build all packages

# Server
cd apps/server
pnpm dev             # Start development server
pnpm db:push         # Apply schema changes
pnpm db:studio       # Open Drizzle Studio (database GUI)

# Client
cd apps/client
pnpm dev             # Start Vite dev server
pnpm build           # Build for production
pnpm preview         # Preview production build
```

## Getting Help

- Check the full [README.md](README.md) for detailed documentation
- Review ai-coding-worker docs at https://github.com/webedt/ai-coding-worker
- Check server logs for error messages
- Inspect browser console for frontend errors

## Success!

If you can see the chat interface and send messages, you're all set!

The WebEDT application is now running and ready to help you with AI-assisted coding tasks.
