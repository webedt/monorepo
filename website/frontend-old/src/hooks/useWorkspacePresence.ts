import { useState, useEffect, useCallback, useRef } from 'react';
import { workspaceApi } from '@/lib/api';

interface PresenceUser {
  userId: string;
  displayName: string;
  page?: string;
  cursorX?: number;
  cursorY?: number;
  selection?: {
    filePath?: string;
    startLine?: number;
    endLine?: number;
    startCol?: number;
    endCol?: number;
  };
  isCurrentUser: boolean;
}

interface UseWorkspacePresenceOptions {
  owner: string;
  repo: string;
  branch: string;
  page?: string;
  enabled?: boolean;
  heartbeatInterval?: number; // milliseconds
}

interface UseWorkspacePresenceReturn {
  users: PresenceUser[];
  otherUsers: PresenceUser[];
  updateCursor: (x: number, y: number) => void;
  updateSelection: (selection: PresenceUser['selection']) => void;
  isConnected: boolean;
}

/**
 * Hook for managing workspace presence (who else is on this branch)
 * Sends heartbeats and receives presence updates from other users
 */
export function useWorkspacePresence({
  owner,
  repo,
  branch,
  page,
  enabled = true,
  heartbeatInterval = 5000,
}: UseWorkspacePresenceOptions): UseWorkspacePresenceReturn {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const cursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const selectionRef = useRef<PresenceUser['selection']>();

  // Update presence with current state
  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !owner || !repo || !branch) return;

    try {
      await workspaceApi.updatePresence({
        owner,
        repo,
        branch,
        page,
        cursorX: cursorRef.current.x,
        cursorY: cursorRef.current.y,
        selection: selectionRef.current,
      });
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to update presence:', error);
      setIsConnected(false);
    }
  }, [owner, repo, branch, page, enabled]);

  // Fetch presence of other users
  const fetchPresence = useCallback(async () => {
    if (!enabled || !owner || !repo || !branch) return;

    try {
      const response = await workspaceApi.getPresence(owner, repo, branch);
      if (response.success && response.data?.users) {
        setUsers(response.data.users);
      }
    } catch (error) {
      console.error('Failed to fetch presence:', error);
    }
  }, [owner, repo, branch, enabled]);

  // Update cursor position (debounced by caller)
  const updateCursor = useCallback((x: number, y: number) => {
    cursorRef.current = { x, y };
  }, []);

  // Update selection
  const updateSelection = useCallback((selection: PresenceUser['selection']) => {
    selectionRef.current = selection;
  }, []);

  // Set up heartbeat interval
  useEffect(() => {
    if (!enabled || !owner || !repo || !branch) return;

    // Send initial heartbeat
    sendHeartbeat();

    // Set up periodic heartbeat
    const heartbeatId = setInterval(sendHeartbeat, heartbeatInterval);

    // Set up presence polling (slightly offset from heartbeat)
    const pollId = setInterval(fetchPresence, heartbeatInterval + 1000);

    // Cleanup on unmount or branch change
    return () => {
      clearInterval(heartbeatId);
      clearInterval(pollId);

      // Remove presence when leaving
      workspaceApi.leaveWorkspace(owner, repo, branch).catch(() => {
        // Ignore errors on cleanup
      });
    };
  }, [owner, repo, branch, enabled, heartbeatInterval, sendHeartbeat, fetchPresence]);

  // Compute other users (excluding current user)
  const otherUsers = users.filter((u) => !u.isCurrentUser);

  return {
    users,
    otherUsers,
    updateCursor,
    updateSelection,
    isConnected,
  };
}
