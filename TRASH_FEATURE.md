# Trash/Recycle Bin Feature

This document describes the trash/recycle bin feature that allows users to soft-delete and restore sessions.

## Overview

Sessions are now soft-deleted instead of permanently deleted, allowing users to restore them from the trash if needed. Permanent deletion is still available from the trash modal.

## Features

- ✅ **Soft Delete**: Sessions are marked as deleted but kept in the database
- ✅ **Trash View**: Modal showing all deleted sessions
- ✅ **Restore**: Individual or bulk restore functionality
- ✅ **Permanent Delete**: Option to permanently delete from trash (with GitHub branch cleanup)
- ✅ **Bulk Operations**: Select and restore/delete multiple sessions
- ✅ **Deletion Timestamps**: Shows when each session was deleted

## User Interface

### Sessions Page
- **Trash Icon Button**: Located to the right of "Select all" checkbox
- Click to open the trash modal

### Trash Modal
- Lists all deleted sessions
- Shows deletion date for each session
- Select all checkbox for bulk operations
- Individual restore/delete buttons for each session
- Bulk restore/delete buttons when items are selected

## Technical Changes

### Database Schema
Added `deletedAt` timestamp field to `chat_sessions` table:
- PostgreSQL: `deleted_at timestamp`
- SQLite: `deleted_at integer (mode: 'timestamp')`

### Backend API Endpoints

#### New Endpoints
- `GET /api/sessions/deleted` - Get all deleted sessions for user
- `POST /api/sessions/:id/restore` - Restore a single session
- `POST /api/sessions/bulk-restore` - Restore multiple sessions
- `POST /api/sessions/bulk-delete-permanent` - Permanently delete soft-deleted sessions

#### Modified Endpoints
- `GET /api/sessions` - Now filters out deleted sessions (where `deletedAt IS NULL`)
- `DELETE /api/sessions/:id` - Now performs soft delete (sets `deletedAt`)
- `POST /api/sessions/bulk-delete` - Now performs soft delete

### Frontend Changes

#### API Client (`lib/api.ts`)
- `sessionsApi.listDeleted()` - Fetch deleted sessions
- `sessionsApi.restore(id)` - Restore single session
- `sessionsApi.restoreBulk(ids)` - Restore multiple sessions
- `sessionsApi.deletePermanentBulk(ids)` - Permanently delete sessions

#### TypeScript Types (`packages/shared/src/types.ts`)
- Added `deletedAt: Date | null` to `ChatSession` interface

#### Sessions Page (`pages/Sessions.tsx`)
- Added trash icon button
- Added trash modal with deleted sessions list
- Added restore functionality
- Updated delete confirmation messages

## Database Migration

### Required Migration
Run the following SQL to add the `deletedAt` column:

```sql
ALTER TABLE chat_sessions ADD COLUMN deleted_at timestamp;
```

### Migration Files
- Location: `website/apps/server/drizzle/0001_add_deleted_at.sql`
- See `website/apps/server/drizzle/README.md` for instructions

### How to Run Migration

#### Option 1: Using psql
```bash
psql $DATABASE_URL -f website/apps/server/drizzle/0001_add_deleted_at.sql
```

#### Option 2: Using Drizzle Kit
```bash
cd website/apps/server
npx drizzle-kit push:pg
```

#### Option 3: Manual SQL
Connect to your database and run:
```sql
ALTER TABLE chat_sessions ADD COLUMN deleted_at timestamp;
```

## Behavior

### When Deleting a Session (Soft Delete / Moving to Trash)
1. Session's `deletedAt` field is set to current timestamp
2. Session no longer appears in main sessions list
3. Session appears in trash modal
4. GitHub branch is deleted (if exists)
5. Storage worker files are deleted (if exist)
6. Database record is retained (soft delete)

### When Restoring a Session
1. Session's `deletedAt` field is set to `null`
2. Session reappears in main sessions list
3. All data and messages are intact
4. **Note:** GitHub branch and storage files are NOT restored (they were deleted during soft delete)

### When Permanently Deleting
1. Database record is permanently removed
2. All associated messages are cascade-deleted
3. **Note:** GitHub branch and storage were already deleted during soft delete

## Notes

- Existing sessions will have `deletedAt = null` (not deleted)
- The migration is backward compatible
- Soft delete improves user experience by preventing accidental data loss
- Permanent delete still cleans up all associated resources
