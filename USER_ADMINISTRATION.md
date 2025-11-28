# User Administration Feature

This document describes the User Administration feature added to the application.

## Overview

The User Administration feature allows administrator users to manage all users in the system, including creating new users, editing user details, setting admin permissions, deleting users, and impersonating users.

## Features

### Admin Dashboard
- View system statistics (total users, total admins, active sessions)
- List all users in the system
- Search and filter users

### User Management
1. **Create Users**: Admins can create new user accounts with:
   - Email address
   - Display name (optional)
   - Password
   - Admin status

2. **Edit Users**: Admins can modify existing users:
   - Update email
   - Change display name
   - Reset password
   - Toggle admin status
   - Note: Admins cannot remove their own admin status

3. **Delete Users**: Remove user accounts permanently
   - Note: Admins cannot delete their own account

4. **Impersonate Users**: Temporarily log in as another user for troubleshooting
   - Note: Admins cannot impersonate themselves

### Security
- All admin routes require authentication AND admin privileges
- Protected by `requireAdmin` middleware
- Returns 401 for unauthenticated requests
- Returns 403 for non-admin users
- Prevents admins from removing their own privileges or deleting themselves

## Technical Implementation

### Database Schema Changes

**PostgreSQL & SQLite:**
```sql
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
```

The migration runs automatically on server start.

### Backend Components

1. **Schema Updates** (`/website/apps/server/src/db/schema.ts`)
   - Added `isAdmin` field to users table

2. **Auth Middleware** (`/website/apps/server/src/middleware/auth.ts`)
   - Added `requireAdmin()` middleware
   - Checks both authentication and admin status

3. **Admin Routes** (`/website/apps/server/src/routes/admin.ts`)
   - `GET /api/admin/users` - List all users
   - `GET /api/admin/users/:id` - Get user details
   - `POST /api/admin/users` - Create new user
   - `PATCH /api/admin/users/:id` - Update user
   - `DELETE /api/admin/users/:id` - Delete user
   - `POST /api/admin/users/:id/impersonate` - Impersonate user
   - `GET /api/admin/stats` - Get system statistics

4. **Server Registration** (`/website/apps/server/src/index.ts`)
   - Registered `/api/admin` routes

### Frontend Components

1. **User Types** (`/website/packages/shared/src/types.ts`)
   - Updated `User` interface with `isAdmin` field

2. **API Client** (`/website/apps/client/src/lib/api.ts`)
   - Added `adminApi` with all admin functions

3. **Layout Component** (`/website/apps/client/src/components/Layout.tsx`)
   - Added "User Administration" menu item (visible only to admins)
   - Menu item appears in user dropdown with crown emoji 👑

4. **Admin Page** (`/website/apps/client/src/pages/UserAdministration.tsx`)
   - Full-featured admin dashboard
   - User table with actions
   - Create/Edit user modal
   - Statistics cards

5. **Routing** (`/website/apps/client/src/App.tsx`)
   - Added `/admin` route
   - Protected by `ProtectedRoute` component

## Usage

### Accessing Admin Panel

1. Log in as an admin user
2. Click on your avatar in the top-right corner
3. Click "👑 User Administration" in the dropdown
4. You'll be taken to `/admin`

### Default Admin Account

**The email `etdofresh@gmail.com` is automatically granted admin privileges:**
- When registering with this email, you'll be created as an admin
- If this account already exists, it will be upgraded to admin on server startup
- This happens automatically - no manual database changes needed!

### Making a User an Admin

**Option 1: Use the Default Admin Email**
Simply register or log in as `etdofresh@gmail.com` - you'll automatically have admin access!

**Option 2: Database (Manual Setup)**
```sql
-- PostgreSQL
UPDATE users SET is_admin = TRUE WHERE email = 'admin@example.com';

-- SQLite
UPDATE users SET is_admin = 1 WHERE email = 'admin@example.com';
```

**Option 3: Through Admin Panel (Once you have at least one admin)**
1. Go to User Administration
2. Click the edit button (✏️) next to the user
3. Check the "Administrator" checkbox
4. Click "Update User"

### Creating a New User

1. Go to User Administration
2. Click "➕ Create New User"
3. Fill in the form:
   - Email (required)
   - Display Name (optional)
   - Password (required)
   - Administrator checkbox (optional)
4. Click "Create User"

### Editing a User

1. Go to User Administration
2. Find the user in the table
3. Click the edit button (✏️)
4. Update the fields you want to change
5. Click "Update User"

Note: Leave password blank to keep the current password

### Deleting a User

1. Go to User Administration
2. Find the user in the table
3. Click the delete button (🗑️)
4. Confirm the deletion

**Warning**: This action cannot be undone and will delete all associated data (sessions, messages, etc.)

### Impersonating a User

1. Go to User Administration
2. Find the user in the table
3. Click the impersonate button (🎭)
4. Confirm the impersonation
5. You'll be logged in as that user

**Note**: To return to your admin account, log out and log back in with your admin credentials.

## API Endpoints

All endpoints require admin authentication.

### List Users
```
GET /api/admin/users
Response: { success: true, data: User[] }
```

### Get User Details
```
GET /api/admin/users/:id
Response: { success: true, data: User }
```

### Create User
```
POST /api/admin/users
Body: { email, displayName?, password, isAdmin? }
Response: { success: true, data: User }
```

### Update User
```
PATCH /api/admin/users/:id
Body: { email?, displayName?, isAdmin?, password? }
Response: { success: true, data: User }
```

### Delete User
```
DELETE /api/admin/users/:id
Response: { success: true, data: { id } }
```

### Impersonate User
```
POST /api/admin/users/:id/impersonate
Response: { success: true, data: { message, userId } }
```

### Get Statistics
```
GET /api/admin/stats
Response: { success: true, data: { totalUsers, totalAdmins, activeSessions } }
```

## Security Considerations

1. **Admin Privilege Protection**: The `requireAdmin` middleware ensures only admins can access admin routes
2. **Self-Protection**: Admins cannot delete themselves or remove their own admin status
3. **Password Security**: Passwords are hashed using bcrypt before storage
4. **Session Management**: Impersonation properly invalidates old sessions and creates new ones
5. **Input Validation**: Email uniqueness is enforced at the database level

## Troubleshooting

### "Forbidden: Admin access required"
- You're not logged in as an admin user
- Make sure your user has `isAdmin = true` in the database

### "User Administration" not showing in menu
- Check that you're logged in
- Verify your user has admin privileges
- Clear browser cache and refresh

### Cannot see any users in the admin panel
- Check browser console for errors
- Verify backend is running
- Check that `/api/admin/users` endpoint is accessible

## Future Enhancements

Possible improvements for the future:
- Role-based permissions (beyond just admin/user)
- User activity logs
- Bulk user operations
- CSV import/export
- Email invitations for new users
- Password reset functionality
- User suspension/activation
- Advanced filtering and search
- Audit trail for admin actions
