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
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const hasExplicitlyClosedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const maxRetryAttempts = 10; // Maximum retry attempts for 429 errors

  const connect = useCallback(() => {
    // Prevent duplicate connections
    if (!url || (eventSourceRef.current || abortControllerRef.current) || isConnectingRef.current) return;

    try {
      isConnectingRef.current = true;
      hasExplicitlyClosedRef.current = false;

      // Use fetch for POST, EventSource for GET
      if (method === 'POST') {
        connectWithFetch();
      } else {
        const es = new EventSource(url);
        setupEventSource(es);
      }
    } catch (err) {
      isConnectingRef.current = false;
      const error = err instanceof Error ? err : new Error('Failed to connect');
      setError(error);
      onError?.(error);
    }
  }, [url, method, body, onMessage, onError, onConnected, onCompleted, autoReconnect, maxReconnectAttempts]);

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
        body: JSON.stringify(body),
        credentials: 'include',
        signal: controller.signal,
      });

      console.log(`[SSE] Response status: ${response.status}, ok: ${response.ok}`);

      if (!response.ok) {
        // Handle 429 (worker busy) with automatic retry
        if (response.status === 429) {
          console.log('[SSE] Detected 429 status, handling retry logic...');
          let errorData: any = {};
          try {
            errorData = await response.json();
            console.log('[SSE] 429 response data:', errorData);
          } catch (e) {
            console.error('[SSE] Failed to parse 429 response:', e);
          }

          const retryAfter = errorData.retryAfter || 5; // Default to 5 seconds

          retryAttemptRef.current += 1;

          if (retryAttemptRef.current > maxRetryAttempts) {
            console.error(`[SSE] Max retry attempts (${maxRetryAttempts}) exceeded`);
            isConnectingRef.current = false;
            abortControllerRef.current = null;
            throw new Error(`Worker busy after ${maxRetryAttempts} retry attempts. Please try again later.`);
          }

          console.log(`[SSE] Worker busy (429), retry ${retryAttemptRef.current}/${maxRetryAttempts} in ${retryAfter} seconds...`);

          // Notify user we're retrying (optional - could be used for UI feedback)
          onMessage?.({
            eventType: 'system',
            data: {
              type: 'message',
              message: `⏳ Worker is busy, retrying in ${retryAfter} seconds (attempt ${retryAttemptRef.current}/${maxRetryAttempts})...`
            }
          });

          isConnectingRef.current = false;
          abortControllerRef.current = null;

          // Retry after the specified delay
          console.log(`[SSE] Setting timeout to retry in ${retryAfter} seconds...`);
          setTimeout(() => {
            console.log('[SSE] Retrying connection now...');
            connectWithFetch();
          }, retryAfter * 1000);
          console.log('[SSE] Returning from 429 handler (should not throw error)');
          return;
        }

        // For other errors, read the response and throw
        console.log(`[SSE] Non-429 error, status: ${response.status}`);
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          console.log('[SSE] Error response data:', errorData);
          if (errorData.error) {
            // Ensure we use the error string, not the entire object
            errorMessage = typeof errorData.error === 'string'
              ? errorData.error
              : errorData.message || JSON.stringify(errorData);
          }
        } catch (e) {
          // ignore json parse error and use default message
          console.error('[SSE] Failed to parse error response:', e);
        }
        isConnectingRef.current = false;
        abortControllerRef.current = null;
        console.error('[SSE] Throwing error:', errorMessage);
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
      onConnected?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let currentEvent = '';
      let currentData = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Flush any remaining event in the buffer
          if (currentEvent || currentData) {
            console.log('[SSE] Flushing final event:', currentEvent || 'message', currentData.substring(0, 100));
            handleSSEEvent(currentEvent || 'message', currentData);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            // Empty line signals end of event
            if (currentEvent || currentData) {
              handleSSEEvent(currentEvent || 'message', currentData);
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

      setIsConnected(false);
      abortControllerRef.current = null;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return; // User cancelled
      }

      isConnectingRef.current = false;
      setIsConnected(false);
      const error = err instanceof Error ? err : new Error('Stream error');
      setError(error);
      onError?.(error);
      abortControllerRef.current = null;
    }
  };

  const handleSSEEvent = (eventType: string, data: string) => {
    if (eventType === 'completed') {
      hasExplicitlyClosedRef.current = true;
      try {
        const parsed = JSON.parse(data);
        onCompleted?.(parsed);
      } catch {
        onCompleted?.();
      }
      disconnect();
    } else if (eventType === 'error') {
      try {
        const parsed = JSON.parse(data);
        hasExplicitlyClosedRef.current = true;
        onError?.(new Error(parsed.error || 'Stream error'));
        disconnect();
      } catch {
        onMessage?.({ eventType: 'error', data });
      }
    } else {
      try {
        const parsed = JSON.parse(data);
        onMessage?.({ eventType, data: parsed });
      } catch {
        onMessage?.({ eventType, data });
      }
    }
  };

  const setupEventSource = (es: EventSource) => {

      es.onopen = () => {
        isConnectingRef.current = false;
        setIsConnected(true);
        setError(null);
        reconnectAttemptRef.current = 0;
        onConnected?.();
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage?.({ eventType: 'message', data });
        } catch {
          onMessage?.({ eventType: 'message', data: event.data });
        }
      };

      es.addEventListener('connected', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          onMessage?.({ eventType: 'connected', data });
        } catch {
          onMessage?.({ eventType: 'connected', data: event.data });
        }
      });

      // Listen to various event types the AI worker sends
      const eventTypes = ['session-created', 'assistant_message', 'status', 'thought', 'tool_use', 'result', 'session_name'];

      eventTypes.forEach(eventType => {
        es.addEventListener(eventType, (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            onMessage?.({ eventType, data });
          } catch {
            onMessage?.({ eventType, data: event.data });
          }
        });
      });

      es.addEventListener('completed', (event: MessageEvent) => {
        setIsConnected(false);
        hasExplicitlyClosedRef.current = true;
        try {
          const data = JSON.parse(event.data);
          onCompleted?.(data);
        } catch {
          onCompleted?.();
        }
        disconnect();
      });

      es.addEventListener('error', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          setIsConnected(false);
          hasExplicitlyClosedRef.current = true;
          onError?.(new Error(data.error || 'Stream error'));
          // Don't auto-reconnect on explicit error events
          disconnect();
        } catch {
          onMessage?.({ eventType: 'error', data: event.data });
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
          onError?.(err);
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
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return {
    isConnected,
    error,
    disconnect,
    reconnect: connect,
  };
}
