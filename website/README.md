# WebEDT Website

The WebEDT Website is a React-based frontend that provides the complete platform experience including the Dashboard, Store, Library, and Editor Suite.

## Overview

This project consists of two main components:
- **Client**: React frontend built with Vite
- **Server**: Express API facade that proxies requests to the Internal API Server

## Features

### Dashboard
- Personalized aggregation hub with customizable widgets
- Recently Played, Editor Quick Access, Store Highlights
- Library Favorites, Community Activity, Session Activity
- Layout saved per user

### Store (Marketplace)
- Grid marketplace with trailer auto-play on hover
- Universal search across all fields
- Filtering by category, genre, price range
- Wishlist support, ratings & reviews
- Stripe and PayPal integration (planned)

### Library
- Three view modes: Grid, List, Compact List
- Filtering: All items, Recently added, Recently played, Most used, Favorites, By collection, Wishlisted
- Sorting: Title, Date Added, Last Played, Play Count
- Quick Favorite and Custom Collections support
- Pagination controls

### Editor Suite
- **Chat**: AI-powered development assistant with verbosity modes
- **Code**: Multi-file editing with syntax highlighting and Git diff
- **Images**: File explorer with image filtering (canvas tools planned)
- **Sounds**: Wave editor with audio effects
- **Scenes**: Scene editor scaffold (2D scene placement planned)
- **Preview**: Live preview with hot reload

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- npm or yarn

### Installation

```bash
# Install client dependencies
cd client
npm install

# Install server dependencies (if applicable)
cd ../server
npm install
```

### Development

```bash
# Run the client development server
cd client
npm run dev

# The client will be available at http://localhost:5173
```

### Building

```bash
# Build the client for production
cd client
npm run build

# Output will be in client/dist
```

## Project Structure

```
website/
├── client/                    # React frontend (Vite)
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── pages/             # Page components
│   │   ├── types/             # TypeScript type definitions
│   │   └── lib/               # Utilities and state management
│   ├── package.json
│   └── vite.config.ts
├── server/                    # Express API facade
│   └── ...
├── Dockerfile                 # Container configuration
└── README.md                  # This file
```

## Technology Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS with DaisyUI
- **State Management**: Zustand, React Query
- **Routing**: React Router 7
- **Forms**: React Hook Form with Zod validation

## Deployment

The website is deployed via GitHub Actions to Dokploy:
- `website-deploy-dokploy.yml` - Deploys on non-main branch pushes
- `website-cleanup-dokploy.yml` - Cleans up apps on branch deletion

Preview environments are created per branch at:
```
https://preview.webedt.etdofresh.com/{owner}/{repo}/{branch}/
```

## Related Documentation

- [Main README](../README.md) - Platform overview
- [SPEC.md](../SPEC.md) - Complete platform specification
- [Architecture Guide](../docs/architecture.md) - System design
- [Internal API Server](../internal-api-server/README.md) - Backend API documentation
