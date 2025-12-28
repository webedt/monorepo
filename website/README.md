# WebEDT Website

The WebEDT Website is a React-based frontend with an Express backend that provides the complete platform experience.

## Overview

This project consists of two main components:
- **Frontend**: React app built with Vite (port 3000)
- **Backend**: Express API server (port 3001)

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- npm

### Development

From the monorepo root:

```bash
npm install
npm run dev
```

This starts:
- Frontend (Vite dev): http://localhost:3000
- Backend (Express): http://localhost:3001

### Building

```bash
npm run build
```

### Production

```bash
npm start
```

Runs Vite preview + backend using concurrently.

## Project Structure

```
website/
├── frontend/                  # React frontend (Vite)
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── pages/             # Page components
│   │   ├── types/             # TypeScript type definitions
│   │   └── lib/               # Utilities and API client
│   ├── package.json
│   └── vite.config.ts
├── backend/                   # Express API server
│   ├── src/
│   │   ├── api/routes/        # API route handlers
│   │   ├── cli/               # CLI commands
│   │   └── scripts/           # Database utilities
│   └── package.json
└── README.md
```

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Lucia

## Scale & Capacity

Current deployment is designed for small-scale usage:

| Metric | Current | Short-term Target |
|--------|---------|-------------------|
| **Concurrent Users** | 1-3 | Up to 10 |
| **Storage per User** | Few GB | Few GB |
| **Architecture** | Single instance | Horizontally scalable |

The backend uses PostgreSQL connection pooling and is designed for horizontal scalability when demand increases.

## Deployment

Deployed via GitHub Actions to Dokploy. Preview environments are created per branch at:

```
https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/
```
