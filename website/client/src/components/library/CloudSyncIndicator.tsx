/**
 * CloudSyncIndicator Component
 * Implements SPEC.md Section 4.5: Cloud Services visual indicator
 *
 * Displays cloud sync status for library items with appropriate
 * icons and tooltips for each sync state.
 */

import { useState, useEffect } from 'react';
import type { CloudSyncStatus, CloudSyncState } from '@/types/cloudServices';

interface CloudSyncIndicatorProps {
  syncState: CloudSyncState;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showTooltip?: boolean;
  onSyncClick?: () => void;
  onResolveConflict?: () => void;
  className?: string;
}

// Status colors and labels
const statusConfig: Record<
  CloudSyncStatus,
  {
    color: string;
    bgColor: string;
    label: string;
    description: string;
    animate?: boolean;
  }
> = {
  synced: {
    color: 'text-success',
    bgColor: 'bg-success/20',
    label: 'Synced',
    description: 'All data is synced with cloud',
  },
  syncing: {
    color: 'text-info',
    bgColor: 'bg-info/20',
    label: 'Syncing',
    description: 'Syncing data with cloud...',
    animate: true,
  },
  pending: {
    color: 'text-warning',
    bgColor: 'bg-warning/20',
    label: 'Pending',
    description: 'Changes waiting to sync',
  },
  conflict: {
    color: 'text-error',
    bgColor: 'bg-error/20',
    label: 'Conflict',
    description: 'Sync conflict detected - action required',
  },
  offline: {
    color: 'text-base-content/50',
    bgColor: 'bg-base-content/10',
    label: 'Offline',
    description: 'Device is offline - changes will sync when online',
  },
  error: {
    color: 'text-error',
    bgColor: 'bg-error/20',
    label: 'Error',
    description: 'Sync error occurred',
  },
  disabled: {
    color: 'text-base-content/30',
    bgColor: 'bg-base-content/5',
    label: 'Disabled',
    description: 'Cloud sync is disabled',
  },
};

// Size configurations
const sizeConfig = {
  sm: {
    iconSize: 'w-4 h-4',
    containerSize: 'p-1',
    fontSize: 'text-xs',
  },
  md: {
    iconSize: 'w-5 h-5',
    containerSize: 'p-1.5',
    fontSize: 'text-sm',
  },
  lg: {
    iconSize: 'w-6 h-6',
    containerSize: 'p-2',
    fontSize: 'text-base',
  },
};

/**
 * Get the appropriate icon for the sync status
 */
function SyncStatusIcon({
  status,
  size,
  animate,
}: {
  status: CloudSyncStatus;
  size: string;
  animate?: boolean;
}) {
  const animationClass = animate ? 'animate-spin' : '';

  switch (status) {
    case 'synced':
      return (
        <svg
          className={`${size}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      );

    case 'syncing':
      return (
        <svg
          className={`${size} ${animationClass}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      );

    case 'pending':
      return (
        <svg
          className={size}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );

    case 'conflict':
      return (
        <svg
          className={size}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      );

    case 'offline':
      return (
        <svg
          className={size}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 18.364L5.636 5.636"
          />
        </svg>
      );

    case 'error':
      return (
        <svg
          className={size}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      );

    case 'disabled':
      return (
        <svg
          className={size}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
          />
        </svg>
      );

    default:
      return null;
  }
}

/**
 * CloudSyncIndicator - Shows cloud sync status for library items
 */
export default function CloudSyncIndicator({
  syncState,
  size = 'md',
  showLabel = false,
  showTooltip = true,
  onSyncClick,
  onResolveConflict,
  className = '',
}: CloudSyncIndicatorProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  const config = statusConfig[syncState.status];
  const sizeConf = sizeConfig[size];

  // Format last synced time
  const formatLastSynced = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Determine if the button should be interactive
  const isInteractive =
    (syncState.status === 'pending' || syncState.status === 'error') && onSyncClick;
  const isConflictResolvable = syncState.status === 'conflict' && onResolveConflict;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isConflictResolvable && onResolveConflict) {
      onResolveConflict();
    } else if (isInteractive && onSyncClick) {
      onSyncClick();
    }
  };

  return (
    <div className={`relative inline-flex items-center gap-1.5 ${className}`}>
      <button
        className={`
          flex items-center justify-center rounded-full
          ${sizeConf.containerSize}
          ${config.bgColor}
          ${config.color}
          ${isInteractive || isConflictResolvable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
          transition-all duration-200
        `}
        onClick={handleClick}
        onMouseEnter={() => setIsTooltipVisible(true)}
        onMouseLeave={() => setIsTooltipVisible(false)}
        title={showTooltip ? undefined : config.description}
        aria-label={`Cloud sync status: ${config.label}`}
        disabled={!isInteractive && !isConflictResolvable}
      >
        <SyncStatusIcon
          status={syncState.status}
          size={sizeConf.iconSize}
          animate={config.animate}
        />
      </button>

      {showLabel && (
        <span className={`${sizeConf.fontSize} ${config.color} font-medium`}>
          {config.label}
        </span>
      )}

      {/* Progress bar for syncing */}
      {syncState.status === 'syncing' && syncState.syncProgress !== undefined && (
        <div className="w-12 h-1 bg-base-300 rounded-full overflow-hidden">
          <div
            className="h-full bg-info transition-all duration-300"
            style={{ width: `${syncState.syncProgress}%` }}
          />
        </div>
      )}

      {/* Tooltip */}
      {showTooltip && isTooltipVisible && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50"
          role="tooltip"
        >
          <div className="bg-base-300 text-base-content rounded-lg shadow-lg p-3 min-w-48 max-w-64">
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-semibold ${config.color}`}>{config.label}</span>
              {syncState.saveCount > 0 && (
                <span className="text-xs text-base-content/60">
                  ({syncState.saveCount} save{syncState.saveCount !== 1 ? 's' : ''})
                </span>
              )}
            </div>
            <p className="text-sm text-base-content/70 mb-2">{config.description}</p>

            {syncState.lastSyncedAt && (
              <p className="text-xs text-base-content/50">
                Last synced: {formatLastSynced(syncState.lastSyncedAt)}
              </p>
            )}

            {syncState.errorMessage && (
              <p className="text-xs text-error mt-1">{syncState.errorMessage}</p>
            )}

            {syncState.conflictDetails && (
              <div className="mt-2 p-2 bg-error/10 rounded text-xs">
                <p className="text-error font-medium mb-1">Conflict Details:</p>
                <p className="text-base-content/70">
                  Local: v{syncState.conflictDetails.localVersion} from{' '}
                  {syncState.conflictDetails.localDeviceName || 'this device'}
                </p>
                <p className="text-base-content/70">
                  Remote: v{syncState.conflictDetails.remoteVersion} from{' '}
                  {syncState.conflictDetails.remoteDeviceName || 'another device'}
                </p>
              </div>
            )}

            {(isInteractive || isConflictResolvable) && (
              <p className="text-xs text-primary mt-2">Click to {isConflictResolvable ? 'resolve' : 'sync now'}</p>
            )}

            {/* Tooltip arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-base-300" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact version of CloudSyncIndicator for use in list views
 */
export function CloudSyncIndicatorCompact({
  syncState,
  className = '',
}: {
  syncState: CloudSyncState;
  className?: string;
}) {
  const config = statusConfig[syncState.status];

  return (
    <span
      className={`inline-flex items-center gap-1 ${config.color} ${className}`}
      title={`${config.label}: ${config.description}`}
    >
      <SyncStatusIcon status={syncState.status} size="w-3.5 h-3.5" animate={config.animate} />
    </span>
  );
}

/**
 * Cloud icon for items that support cloud saves (without status)
 */
export function CloudSavesBadge({
  hasCloudSaves,
  className = '',
}: {
  hasCloudSaves: boolean;
  className?: string;
}) {
  if (!hasCloudSaves) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-info ${className}`}
      title="Cloud Saves Supported"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
        />
      </svg>
    </span>
  );
}
