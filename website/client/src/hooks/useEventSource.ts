import { useState, useEffect, useRef, useCallback } from 'react';

interface UseEventSourceOptions {
  onMessage?: (data: any) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onCompleted?: (data?: any) => void;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  method?: 'GET' | 'POST';
  body?: any;
  /** Inactivity timeout in ms - if no events received within this time, consider stream hung (default: 5 minutes) */
  inactivityTimeout?: number;
}

export function useEventSource(url: string | null, options: UseEventSourceOptions = {}) {
  const {
    onMessage,
    onError,
    onConnected,
    onCompleted,
    autoReconnect = true,
    maxReconnectAttempts = 5,
    method = 'GET',
    body,
    inactivityTimeout = 5 * 60 * 1000, // Default 5 minutes
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const inactivityTimeoutRef = useRef<NodeJS.Timeout>();
  const cleanupTimeoutRef = useRef<NodeJS.Timeout>(); // For deferred cleanup (Strict Mode handling)
  const hasExplicitlyClosedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const lastActivityRef = useRef<number>(Date.now());
  const isMountedRef = useRef(true); // Track if component is actually mounted
  const maxRetryAttempts = 10; // Maximum retry attempts for 429 errors

  // Use refs to always have access to the latest callbacks and body
  // This prevents stale closure issues when the effect doesn't re-run
  const onConnectedRef = useRef(onConnected);
  const onCompletedRef = useRef(onCompleted);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const bodyRef = useRef(body);
  const methodRef = useRef(method);

  // Keep refs in sync with props
  useEffect(() => {
    onConnectedRef.current = onConnected;
    onCompletedRef.current = onCompleted;
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    bodyRef.current = body;
    methodRef.current = method;
  });

  // Helper to reset inactivity timeout
  const resetInactivityTimeout = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }
    inactivityTimeoutRef.current = setTimeout(() => {
      console.warn(`[SSE] No activity for ${inactivityTimeout / 1000}s - stream may be hung`);
      // Notify via message so user sees something - pass raw event directly
      onMessageRef.current?.({
        type: 'system',
        message: `⚠️ No response received for ${Math.round(inactivityTimeout / 60000)} minutes. The session may be stuck. You can try sending a new message.`
      });
      // Trigger completion to allow user to continue
      hasExplicitlyClosedRef.current = true;
      onCompletedRef.current?.({ timedOut: true });
      // Disconnect the hung stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsConnected(false);
    }, inactivityTimeout);
  }, [inactivityTimeout]);

  const connect = useCallback(() => {
    // Cancel any pending cleanup (handles React Strict Mode remount)
    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = undefined;
      console.log('[SSE] Cancelled pending cleanup (component remounted)');
    }

    isMountedRef.current = true;

    // If there's an existing connection, disconnect it first to allow new connection
    // This handles the case where a new request comes in while a previous connection is still active
    if (abortControllerRef.current) {
      console.log('[SSE] Disconnecting previous connection to allow new request');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Prevent duplicate connections (only check isConnectingRef now since we cleared the others)
    if (!url || isConnectingRef.current) return;

    try {
      isConnectingRef.current = true;
      hasExplicitlyClosedRef.current = false;

      // Use fetch for POST, EventSource for GET
      // Use refs to get the latest values to avoid stale closures
      if (methodRef.current === 'POST') {
        connectWithFetch();
      } else {
        // Use withCredentials to include cookies for authentication
        const es = new EventSource(url, { withCredentials: true });
        setupEventSource(es);
      }
    } catch (err) {
      isConnectingRef.current = false;
      const error = err instanceof Error ? err : new Error('Failed to connect');
      setError(error);
      onErrorRef.current?.(error);
    }
  }, [url]); // Only depend on url - use refs for other values to avoid stale closures

  const connectWithFetch = async () => {
    if (!url) return;

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(bodyRef.current),
        credentials: 'include',
        signal: controller.signal,
      });

      console.log(`[SSE] Response status: ${response.status}, ok: ${response.ok}`);

      if (!response.ok) {
        console.log(`[SSE] Response not OK, status: ${response.status}`);

        // First, read the response body (can only be read once)
        let errorData: any = null;
        try {
          errorData = await response.json();
          console.log('[SSE] Response error data:', JSON.stringify(errorData));
        } catch (e) {
          console.error('[SSE] Failed to parse error response as JSON:', e);
        }

        // Handle 429 (worker busy) with automatic retry
        if (response.status === 429) {
          console.log('[SSE] Detected 429 status, handling retry logic...');

          const retryAfter = errorData?.retryAfter || 5; // Default to 5 seconds

          retryAttemptRef.current += 1;
          console.log(`[SSE] Retry attempt ${retryAttemptRef.current}/${maxRetryAttempts}`);

          if (retryAttemptRef.current > maxRetryAttempts) {
            console.error(`[SSE] Max retry attempts (${maxRetryAttempts}) exceeded`);
            isConnectingRef.current = false;
            abortControllerRef.current = null;
            throw new Error(`Worker busy after ${maxRetryAttempts} retry attempts. Please try again later.`);
          }

          console.log(`[SSE] Scheduling retry in ${retryAfter} seconds...`);

          // Notify user we're retrying - pass raw event directly
          try {
            onMessageRef.current?.({
              type: 'system',
              message: `⏳ Worker is busy, retrying in ${retryAfter} seconds (attempt ${retryAttemptRef.current}/${maxRetryAttempts})...`
            });
          } catch (msgErr) {
            console.error('[SSE] Failed to send retry notification message:', msgErr);
          }

          isConnectingRef.current = false;
          abortControllerRef.current = null;

          // Retry after the specified delay
          setTimeout(() => {
            console.log('[SSE] Executing delayed retry now...');
            connectWithFetch();
          }, retryAfter * 1000);

          console.log('[SSE] 429 handler complete, returning without error');
          return; // CRITICAL: Return here to avoid throwing error
        }

        // For other errors, construct error message and throw
        console.log(`[SSE] Non-429 error (status ${response.status}), preparing to throw error`);
        let errorMessage = `HTTP error! status: ${response.status}`;

        if (errorData) {
          if (typeof errorData.error === 'string') {
            errorMessage = errorData.error;
          } else if (typeof errorData.message === 'string') {
            errorMessage = errorData.message;
          } else if (errorData.error) {
            errorMessage = JSON.stringify(errorData);
          }
        }

        isConnectingRef.current = false;
        abortControllerRef.current = null;
        console.error('[SSE] Throwing error with message:', errorMessage);
        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      isConnectingRef.current = false;
      setIsConnected(true);
      setError(null);
      reconnectAttemptRef.current = 0;
      retryAttemptRef.current = 0; // Reset retry counter on successful connection
      onConnectedRef.current?.();

      // Start inactivity timeout
      resetInactivityTimeout();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let currentEvent = '';
      let currentData = '';
      let receivedCompletedEvent = false;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Flush any remaining event in the buffer
          if (currentEvent || currentData) {
            console.log('[SSE] Flushing final event:', currentEvent || 'message', currentData.substring(0, 100));
            handleSSEEvent(currentEvent || 'message', currentData);
            if (currentEvent === 'completed') {
              receivedCompletedEvent = true;
            }
          }
          break;
        }

        // Reset inactivity timeout on any data received
        resetInactivityTimeout();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            // Empty line signals end of event
            if (currentEvent || currentData) {
              handleSSEEvent(currentEvent || 'message', currentData);
              if (currentEvent === 'completed') {
                receivedCompletedEvent = true;
              }
              currentEvent = '';
              currentData = '';
            }
            continue;
          }

          if (line.startsWith('event:')) {
            currentEvent = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            currentData = line.substring(5).trim();
          }
        }
      }

      // Clear inactivity timeout when stream ends
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }

      // If stream ended without a "completed" event, trigger completion anyway
      // This handles cases where the server stream ends unexpectedly
      if (!receivedCompletedEvent && !hasExplicitlyClosedRef.current) {
        console.log('[SSE] Stream ended without completed event - triggering completion');
        hasExplicitlyClosedRef.current = true;
        onCompletedRef.current?.({ streamEndedWithoutCompletion: true });
      }

      setIsConnected(false);
      abortControllerRef.current = null;
    } catch (err) {
      // Clear inactivity timeout on error
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }

      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[SSE] Request aborted by user');
        return; // User cancelled
      }

      console.error('[SSE] Caught error in connectWithFetch:', err);
      console.error('[SSE] Error type:', typeof err);
      console.error('[SSE] Error instance check:', err instanceof Error);

      isConnectingRef.current = false;
      setIsConnected(false);
      const error = err instanceof Error ? err : new Error('Stream error');
      console.error('[SSE] Final error object:', error);
      console.error('[SSE] Final error message:', error.message);
      setError(error);
      onErrorRef.current?.(error);
      abortControllerRef.current = null;
    }
  };

  // Handle SSE events and pass raw event data directly without wrapper
  const handleSSEEvent = (eventType: string, data: string) => {
    if (eventType === 'completed') {
      hasExplicitlyClosedRef.current = true;
      try {
        const parsed = JSON.parse(data);
        onCompletedRef.current?.(parsed);
      } catch (e) {
        console.debug('[SSE] Could not parse completed event data as JSON, using default completion', e);
        onCompletedRef.current?.();
      }
      disconnect();
    } else if (eventType === 'error') {
      try {
        const parsed = JSON.parse(data);
        hasExplicitlyClosedRef.current = true;
        onErrorRef.current?.(new Error(parsed.error || 'Stream error'));
        disconnect();
      } catch (e) {
        console.debug('[SSE] Could not parse error event data as JSON, forwarding as message', e);
        // Pass raw event with type field
        onMessageRef.current?.({ type: 'error', rawData: data });
      }
    } else {
      try {
        // Parse and pass raw event directly - the event already has a 'type' field
        const parsed = JSON.parse(data);
        onMessageRef.current?.(parsed);
      } catch (e) {
        console.debug(`[SSE] Could not parse ${eventType} event data as JSON, forwarding raw`, e);
        // For unparseable data, create a raw event with the eventType as type
        onMessageRef.current?.({ type: eventType, rawData: data });
      }
    }
  };

  const setupEventSource = (es: EventSource) => {

      es.onopen = () => {
        isConnectingRef.current = false;
        setIsConnected(true);
        setError(null);
        reconnectAttemptRef.current = 0;
        onConnectedRef.current?.();
        // Start inactivity timeout for EventSource as well
        resetInactivityTimeout();
      };

      es.onmessage = (event) => {
        // Reset inactivity timeout on any message
        resetInactivityTimeout();
        try {
          // Parse and pass raw event directly
          const data = JSON.parse(event.data);
          onMessageRef.current?.(data);
        } catch (e) {
          console.debug('[SSE] Could not parse message event data as JSON, forwarding raw', e);
          onMessageRef.current?.({ type: 'message', rawData: event.data });
        }
      };

      es.addEventListener('connected', (event: MessageEvent) => {
        resetInactivityTimeout();
        try {
          // Parse and pass raw event directly
          const data = JSON.parse(event.data);
          onMessageRef.current?.(data);
        } catch (e) {
          console.debug('[SSE] Could not parse connected event data as JSON, forwarding raw', e);
          onMessageRef.current?.({ type: 'connected', rawData: event.data });
        }
      });

      // Listen to various event types the AI worker sends
      const eventTypes = ['session-created', 'assistant_message', 'status', 'thought', 'tool_use', 'result', 'session_name'];

      eventTypes.forEach(eventType => {
        es.addEventListener(eventType, (event: MessageEvent) => {
          resetInactivityTimeout();
          try {
            // Parse and pass raw event directly
            const data = JSON.parse(event.data);
            onMessageRef.current?.(data);
          } catch (e) {
            console.debug(`[SSE] Could not parse ${eventType} event data as JSON, forwarding raw`, e);
            onMessageRef.current?.({ type: eventType, rawData: event.data });
          }
        });
      });

      // Listen for heartbeat events (keeps connection alive during long operations)
      es.addEventListener('heartbeat', () => {
        resetInactivityTimeout();
        // Forward heartbeat to message handler so it can be processed by the component
        onMessageRef.current?.({ type: 'heartbeat' });
      });

      es.addEventListener('completed', (event: MessageEvent) => {
        // Clear inactivity timeout on completion
        if (inactivityTimeoutRef.current) {
          clearTimeout(inactivityTimeoutRef.current);
        }
        setIsConnected(false);
        hasExplicitlyClosedRef.current = true;
        try {
          const data = JSON.parse(event.data);
          onCompletedRef.current?.(data);
        } catch (e) {
          console.debug('[SSE] Could not parse completed event data as JSON, using default completion', e);
          onCompletedRef.current?.();
        }
        disconnect();
      });

      es.addEventListener('error', (event: MessageEvent) => {
        // Clear inactivity timeout on error
        if (inactivityTimeoutRef.current) {
          clearTimeout(inactivityTimeoutRef.current);
        }
        try {
          const data = JSON.parse(event.data);
          setIsConnected(false);
          hasExplicitlyClosedRef.current = true;
          onErrorRef.current?.(new Error(data.error || 'Stream error'));
          // Don't auto-reconnect on explicit error events
          disconnect();
        } catch (e) {
          console.debug('[SSE] Could not parse error event data as JSON, forwarding as message', e);
          onMessageRef.current?.({ type: 'error', rawData: event.data });
        }
      });

      es.onerror = () => {
        // Don't handle if we've already explicitly closed the connection
        if (hasExplicitlyClosedRef.current) {
          return;
        }

        setIsConnected(false);
        const err = new Error('Connection lost');
        setError(err);

        // Only call onError if we're not auto-reconnecting or if we've exhausted retries
        if (!autoReconnect || reconnectAttemptRef.current >= maxReconnectAttempts) {
          onErrorRef.current?.(err);
        }

        if (autoReconnect && reconnectAttemptRef.current < maxReconnectAttempts) {
          reconnectAttemptRef.current += 1;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);

          reconnectTimeoutRef.current = setTimeout(() => {
            eventSourceRef.current = null;
            connect();
          }, delay);
        } else {
          disconnect();
        }
      };

      eventSourceRef.current = es;
  };

  const disconnect = useCallback(() => {
    isConnectingRef.current = false;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    if (url) {
      connect();
    }

    return () => {
      // Use deferred cleanup to handle React Strict Mode
      // In Strict Mode, React unmounts and remounts components for effect cleanup testing
      // By deferring the disconnect, we allow the remount to cancel the cleanup
      isMountedRef.current = false;

      // If there's no active connection, no need to defer cleanup
      if (!abortControllerRef.current && !eventSourceRef.current) {
        return;
      }

      // Defer the actual disconnect by 100ms
      // This gives React Strict Mode time to remount and cancel the cleanup
      cleanupTimeoutRef.current = setTimeout(() => {
        // Only disconnect if still unmounted after the delay
        if (!isMountedRef.current) {
          console.log('[SSE] Deferred cleanup executing - component did not remount');
          disconnect();
        }
      }, 100);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Cleanup on actual component unmount
  useEffect(() => {
    return () => {
      // Clear any pending deferred cleanup
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }
      // Immediate disconnect on final unmount
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    error,
    disconnect,
    reconnect: connect,
  };
}
