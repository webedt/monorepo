import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl } from '@/lib/api';

/**
 * Session list update event types from the server
 */
export type SessionUpdateType = 'created' | 'updated' | 'deleted' | 'status_changed';

export interface SessionListEvent {
  type: SessionUpdateType;
  session: {
    id: string;
    status?: string;
    userRequest?: string;
    [key: string]: unknown;
  };
  timestamp: string;
}

interface UseSessionListUpdatesOptions {
  /** Whether to enable the SSE connection (default: true) */
  enabled?: boolean;
  /** Callback when a session update is received */
  onUpdate?: (event: SessionListEvent) => void;
}

/**
 * Hook to subscribe to real-time session list updates via SSE.
 *
 * This eliminates the need for polling the sessions list by receiving
 * push notifications when sessions are created, updated, or change status.
 *
 * The hook automatically invalidates the React Query cache for the 'sessions'
 * query key when updates are received, triggering a refetch.
 *
 * @example
 * ```tsx
 * // Basic usage - just invalidates the sessions query
 * useSessionListUpdates();
 *
 * // With custom callback
 * useSessionListUpdates({
 *   onUpdate: (event) => {
 *     console.log('Session updated:', event);
 *   }
 * });
 * ```
 */
export function useSessionListUpdates(options: UseSessionListUpdatesOptions = {}) {
  const { enabled = true, onUpdate } = options;
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptRef = useRef(0);
  const maxReconnectAttempts = 5;

  // Use ref to avoid stale closure issues
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      return; // Already connected
    }

    const url = `${getApiBaseUrl()}/api/sessions/updates`;
    console.log('[SessionListUpdates] Connecting to:', url);

    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[SessionListUpdates] Connected');
      reconnectAttemptRef.current = 0;
    };

    // Handle the 'connected' event (initial connection confirmation)
    eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[SessionListUpdates] Connection confirmed:', data);
      } catch {
        // Ignore parse errors
      }
    });

    // Handle session events
    const handleSessionEvent = (eventType: SessionUpdateType) => (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SessionListEvent;
        console.log(`[SessionListUpdates] Received ${eventType} event:`, data);

        // Call the user callback if provided
        onUpdateRef.current?.(data);

        // Invalidate the sessions query to trigger a refetch
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      } catch (err) {
        console.error('[SessionListUpdates] Error parsing event:', err);
      }
    };

    eventSource.addEventListener('created', handleSessionEvent('created'));
    eventSource.addEventListener('updated', handleSessionEvent('updated'));
    eventSource.addEventListener('deleted', handleSessionEvent('deleted'));
    eventSource.addEventListener('status_changed', handleSessionEvent('status_changed'));

    eventSource.onerror = (error) => {
      console.error('[SessionListUpdates] Error:', error);

      // Close the current connection
      eventSource.close();
      eventSourceRef.current = null;

      // Attempt to reconnect with exponential backoff
      if (reconnectAttemptRef.current < maxReconnectAttempts) {
        reconnectAttemptRef.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
        console.log(`[SessionListUpdates] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        console.warn('[SessionListUpdates] Max reconnect attempts reached, stopping');
      }
    };
  }, [queryClient]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    if (eventSourceRef.current) {
      console.log('[SessionListUpdates] Disconnecting');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return { disconnect };
}
