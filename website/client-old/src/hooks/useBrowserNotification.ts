import { useCallback, useEffect, useState } from 'react';

// ============================================================================
// BROWSER NOTIFICATION HOOK
// ============================================================================
// This hook provides a simple API for showing browser notifications when
// sessions complete. It handles permission requests and provides feedback
// about the current permission state.
// ============================================================================

export type NotificationPermission = 'granted' | 'denied' | 'default';

interface UseBrowserNotificationReturn {
  // Current permission state
  permission: NotificationPermission;
  // Whether notifications are supported in this browser
  isSupported: boolean;
  // Request permission from the user
  requestPermission: () => Promise<NotificationPermission>;
  // Show a notification (only works if permission is granted)
  showNotification: (title: string, options?: NotificationOptions) => Notification | null;
  // Show a session completion notification
  showSessionCompletedNotification: (sessionId?: string, repoName?: string) => Notification | null;
}

/**
 * Hook for managing browser notifications
 *
 * Usage:
 * ```tsx
 * const { permission, requestPermission, showSessionCompletedNotification } = useBrowserNotification();
 *
 * // Request permission on user action
 * <button onClick={requestPermission}>Enable Notifications</button>
 *
 * // Show notification when session completes
 * onCompleted: () => {
 *   showSessionCompletedNotification(sessionId, repoName);
 * }
 * ```
 */
export function useBrowserNotification(): UseBrowserNotificationReturn {
  const isSupported = typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (!isSupported) return 'denied';
    return Notification.permission as NotificationPermission;
  });

  // Listen for permission changes using Permissions API (no polling needed)
  useEffect(() => {
    if (!isSupported) return;

    let permissionStatus: PermissionStatus | null = null;

    const handlePermissionChange = () => {
      // Map PermissionState to NotificationPermission
      // PermissionState: 'granted' | 'denied' | 'prompt'
      // NotificationPermission: 'granted' | 'denied' | 'default'
      const state = permissionStatus?.state;
      if (state === 'prompt') {
        setPermission('default');
      } else if (state === 'granted' || state === 'denied') {
        setPermission(state);
      }
    };

    // Use Permissions API to listen for changes without polling
    navigator.permissions
      .query({ name: 'notifications' })
      .then((status) => {
        permissionStatus = status;
        handlePermissionChange(); // Sync initial state
        status.addEventListener('change', handlePermissionChange);
      })
      .catch(() => {
        // Permissions API not supported, fall back to reading Notification.permission
        // This is a one-time read, no polling - permission changes won't be detected
        // but this is acceptable for older browsers
        setPermission(Notification.permission as NotificationPermission);
      });

    return () => {
      if (permissionStatus) {
        permissionStatus.removeEventListener('change', handlePermissionChange);
      }
    };
  }, [isSupported]);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) {
      console.warn('[Notification] Browser does not support notifications');
      return 'denied';
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result as NotificationPermission);
      return result as NotificationPermission;
    } catch (error) {
      console.error('[Notification] Failed to request permission:', error);
      return 'denied';
    }
  }, [isSupported]);

  const showNotification = useCallback((
    title: string,
    options?: NotificationOptions
  ): Notification | null => {
    if (!isSupported) {
      console.warn('[Notification] Browser does not support notifications');
      return null;
    }

    if (permission !== 'granted') {
      console.warn('[Notification] Permission not granted, cannot show notification');
      return null;
    }

    // Don't show notification if the page is already visible/focused
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      console.log('[Notification] Page is visible and focused, skipping notification');
      return null;
    }

    try {
      const notification = new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        ...options,
      });

      // Auto-close after 5 seconds
      setTimeout(() => {
        notification.close();
      }, 5000);

      // Focus window when notification is clicked
      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return notification;
    } catch (error) {
      console.error('[Notification] Failed to show notification:', error);
      return null;
    }
  }, [isSupported, permission]);

  const showSessionCompletedNotification = useCallback((
    sessionId?: string,
    repoName?: string
  ): Notification | null => {
    const title = 'Session Completed';
    const body = repoName
      ? `Your session for ${repoName} has finished processing.`
      : 'Your session has finished processing.';

    return showNotification(title, {
      body,
      tag: sessionId ? `session-${sessionId}` : 'session-completed',
    });
  }, [showNotification]);

  return {
    permission,
    isSupported,
    requestPermission,
    showNotification,
    showSessionCompletedNotification,
  };
}

// ============================================================================
// NOTIFICATION SETTINGS STORE
// ============================================================================
// Persists user preference for notifications to localStorage
// ============================================================================

const NOTIFICATION_PREFS_KEY = 'browserNotificationPrefs';

interface NotificationPrefs {
  enabled: boolean;
  onSessionComplete: boolean;
  soundOnComplete: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  onSessionComplete: true,
  soundOnComplete: true,
};

export function getNotificationPrefs(): NotificationPrefs {
  try {
    const stored = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (stored) {
      return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('[NotificationPrefs] Failed to load:', e);
  }
  return DEFAULT_PREFS;
}

export function setNotificationPrefs(prefs: Partial<NotificationPrefs>): void {
  try {
    const current = getNotificationPrefs();
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify({ ...current, ...prefs }));
  } catch (e) {
    console.warn('[NotificationPrefs] Failed to save:', e);
  }
}

/**
 * Play a notification sound when a session completes.
 * Respects user preferences - only plays if enabled.
 */
export function playNotificationSound(): void {
  const prefs = getNotificationPrefs();
  if (!prefs.enabled || !prefs.soundOnComplete) {
    return;
  }

  try {
    const audio = new Audio('/sounds/session-complete.mp3');
    audio.volume = 0.5;
    audio.play().catch((e) => {
      // Browsers may block autoplay - this is expected behavior
      console.debug('[NotificationSound] Playback blocked:', e);
    });
  } catch (e) {
    console.debug('[NotificationSound] Failed to play:', e);
  }
}
