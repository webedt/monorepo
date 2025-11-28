# Database Migrations

This directory contains database migration files for the application.

## Running Migrations

### Option 1: Using psql (PostgreSQL)
```bash
psql $DATABASE_URL -f drizzle/0001_add_deleted_at.sql
```

### Option 2: Using Drizzle Kit
```bash
cd website/apps/server
npx drizzle-kit push:pg
```

### Option 3: Manual SQL (via database client)
Run the SQL commands from the migration files directly in your database client (pgAdmin, DBeaver, etc.)

## Current Migrations

- `0001_add_deleted_at.sql` - Adds soft delete support with `deleted_at` column to `chat_sessions` table
