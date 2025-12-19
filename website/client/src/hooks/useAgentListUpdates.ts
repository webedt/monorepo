import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl } from '@/lib/api';

/**
 * Agent list update event types from the server
 */
export type AgentUpdateType = 'created' | 'updated' | 'deleted' | 'status_changed';

export interface AgentListEvent {
  type: AgentUpdateType;
  session: {
    id: string;
    status?: string;
    userRequest?: string;
    [key: string]: unknown;
  };
  timestamp: string;
}

interface UseAgentListUpdatesOptions {
  /** Whether to enable the SSE connection (default: true) */
  enabled?: boolean;
  /** Callback when an agent update is received */
  onUpdate?: (event: AgentListEvent) => void;
}

/**
 * Hook to subscribe to real-time agent list updates via SSE.
 *
 * This eliminates the need for polling the agents list by receiving
 * push notifications when agents are created, updated, or change status.
 *
 * The hook automatically invalidates the React Query cache for the 'sessions'
 * query key when updates are received, triggering a refetch.
 *
 * @example
 * ```tsx
 * // Basic usage - just invalidates the sessions query
 * useAgentListUpdates();
 *
 * // With custom callback
 * useAgentListUpdates({
 *   onUpdate: (event) => {
 *     console.log('Agent updated:', event);
 *   }
 * });
 * ```
 */
export function useAgentListUpdates(options: UseAgentListUpdatesOptions = {}) {
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
    console.log('[AgentListUpdates] Connecting to:', url);

    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[AgentListUpdates] Connected');
      reconnectAttemptRef.current = 0;
    };

    // Handle the 'connected' event (initial connection confirmation)
    eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[AgentListUpdates] Connection confirmed:', data);
      } catch {
        // Ignore parse errors
      }
    });

    // Handle agent events
    const handleAgentEvent = (eventType: AgentUpdateType) => (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as AgentListEvent;
        console.log(`[AgentListUpdates] Received ${eventType} event:`, data);

        // Call the user callback if provided
        onUpdateRef.current?.(data);

        // Invalidate the sessions query to trigger a refetch
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      } catch (err) {
        console.error('[AgentListUpdates] Error parsing event:', err);
      }
    };

    eventSource.addEventListener('created', handleAgentEvent('created'));
    eventSource.addEventListener('updated', handleAgentEvent('updated'));
    eventSource.addEventListener('deleted', handleAgentEvent('deleted'));
    eventSource.addEventListener('status_changed', handleAgentEvent('status_changed'));

    eventSource.onerror = (error) => {
      console.error('[AgentListUpdates] Error:', error);

      // Close the current connection
      eventSource.close();
      eventSourceRef.current = null;

      // Attempt to reconnect with exponential backoff
      if (reconnectAttemptRef.current < maxReconnectAttempts) {
        reconnectAttemptRef.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
        console.log(`[AgentListUpdates] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        console.warn('[AgentListUpdates] Max reconnect attempts reached, stopping');
      }
    };
  }, [queryClient]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    if (eventSourceRef.current) {
      console.log('[AgentListUpdates] Disconnecting');
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
