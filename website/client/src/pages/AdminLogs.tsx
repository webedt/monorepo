import { useEffect, useState, useCallback } from 'react';
import { adminApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useNavigate } from 'react-router-dom';

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  component?: string;
  message: string;
  sessionId?: string;
  [key: string]: any;
}

interface LogsStatus {
  enabled: boolean;
  count: number;
  maxLogs: number;
}

interface LogsResponse {
  success: boolean;
  data: {
    logs: LogEntry[];
    total: number;
    filtered: number;
    status: LogsStatus;
  };
}

const LOG_LEVELS = ['all', 'debug', 'info', 'warn', 'error'] as const;
type LogLevel = typeof LOG_LEVELS[number];

export default function AdminLogs() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<LogsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  // Filters
  const [levelFilter, setLevelFilter] = useState<LogLevel>('all');
  const [componentFilter, setComponentFilter] = useState('');
  const [sessionIdFilter, setSessionIdFilter] = useState('');
  const [limitFilter, setLimitFilter] = useState(100);

  // Redirect if not admin
  useEffect(() => {
    if (!user?.isAdmin) {
      navigate('/');
    }
  }, [user, navigate]);

  const loadLogs = useCallback(async () => {
    try {
      setError(null);
      const params: any = { limit: limitFilter };
      if (levelFilter !== 'all') params.level = levelFilter;
      if (componentFilter) params.component = componentFilter;
      if (sessionIdFilter) params.sessionId = sessionIdFilter;

      const response: LogsResponse = await adminApi.getLogs(params);
      setLogs(response.data.logs);
      setStatus(response.data.status);
    } catch (err: any) {
      setError(err.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [levelFilter, componentFilter, sessionIdFilter, limitFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadLogs();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, loadLogs]);

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear all logs? This action cannot be undone.')) {
      return;
    }

    try {
      await adminApi.clearLogs();
      await loadLogs();
    } catch (err: any) {
      alert(err.message || 'Failed to clear logs');
    }
  };

  const getLevelBadgeClass = (level: string) => {
    switch (level) {
      case 'error':
        return 'badge-error';
      case 'warn':
        return 'badge-warning';
      case 'info':
        return 'badge-info';
      case 'debug':
        return 'badge-ghost';
      default:
        return 'badge-ghost';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  if (!user?.isAdmin) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-base-content mb-2">Server Logs</h1>
        <p className="text-base-content/70">View and filter server logs for debugging</p>
      </div>

      {/* Status Card */}
      {status && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-base-200 rounded-lg p-6 shadow">
            <div className="text-sm text-base-content/70 mb-1">Log Capture</div>
            <div className={`text-2xl font-bold ${status.enabled ? 'text-success' : 'text-error'}`}>
              {status.enabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          <div className="bg-base-200 rounded-lg p-6 shadow">
            <div className="text-sm text-base-content/70 mb-1">Total Logs</div>
            <div className="text-2xl font-bold text-base-content">{status.count}</div>
          </div>
          <div className="bg-base-200 rounded-lg p-6 shadow">
            <div className="text-sm text-base-content/70 mb-1">Max Capacity</div>
            <div className="text-2xl font-bold text-base-content">{status.maxLogs}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-base-200 rounded-lg p-4 mb-6 shadow">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Level Filter */}
          <div className="form-control">
            <label className="label">
              <span className="label-text text-xs">Level</span>
            </label>
            <select
              className="select select-bordered select-sm"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as LogLevel)}
            >
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level === 'all' ? 'All Levels' : level.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Component Filter */}
          <div className="form-control">
            <label className="label">
              <span className="label-text text-xs">Component</span>
            </label>
            <input
              type="text"
              placeholder="e.g., execute"
              className="input input-bordered input-sm w-32"
              value={componentFilter}
              onChange={(e) => setComponentFilter(e.target.value)}
            />
          </div>

          {/* Session ID Filter */}
          <div className="form-control">
            <label className="label">
              <span className="label-text text-xs">Session ID</span>
            </label>
            <input
              type="text"
              placeholder="Session ID"
              className="input input-bordered input-sm w-40"
              value={sessionIdFilter}
              onChange={(e) => setSessionIdFilter(e.target.value)}
            />
          </div>

          {/* Limit */}
          <div className="form-control">
            <label className="label">
              <span className="label-text text-xs">Limit</span>
            </label>
            <select
              className="select select-bordered select-sm"
              value={limitFilter}
              onChange={(e) => setLimitFilter(Number(e.target.value))}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>

          {/* Auto Refresh */}
          <div className="form-control">
            <label className="label cursor-pointer gap-2">
              <span className="label-text text-xs">Auto-refresh</span>
              <input
                type="checkbox"
                className="toggle toggle-sm toggle-primary"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
            </label>
          </div>

          {autoRefresh && (
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Interval</span>
              </label>
              <select
                className="select select-bordered select-sm"
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
              >
                <option value={2000}>2s</option>
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
                <option value={30000}>30s</option>
              </select>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={loadLogs}
              className="btn btn-sm btn-primary"
              disabled={loading}
            >
              {loading ? <span className="loading loading-spinner loading-xs"></span> : 'Refresh'}
            </button>
            <button
              onClick={handleClearLogs}
              className="btn btn-sm btn-error btn-outline"
            >
              Clear All
            </button>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      {loading && logs.length === 0 ? (
        <div className="text-center py-12">
          <div className="loading loading-spinner loading-lg"></div>
          <p className="mt-4 text-base-content/70">Loading logs...</p>
        </div>
      ) : error ? (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 bg-base-200 rounded-lg">
          <p className="text-base-content/70">No logs found matching your filters</p>
        </div>
      ) : (
        <div className="bg-base-200 rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="table table-xs w-full">
              <thead className="sticky top-0 bg-base-300 z-10">
                <tr>
                  <th className="w-36">Timestamp</th>
                  <th className="w-20">Level</th>
                  <th className="w-24">Component</th>
                  <th>Message</th>
                  <th className="w-32">Session</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {logs.map((log, index) => (
                  <tr key={`${log.timestamp}-${index}`} className="hover">
                    <td className="text-base-content/70 whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td>
                      <span className={`badge badge-xs ${getLevelBadgeClass(log.level)}`}>
                        {log.level}
                      </span>
                    </td>
                    <td className="text-base-content/70">
                      {log.component || '-'}
                    </td>
                    <td className="break-all max-w-md">
                      <span className={log.level === 'error' ? 'text-error' : ''}>
                        {log.message}
                      </span>
                    </td>
                    <td className="text-base-content/50 text-xs">
                      {log.sessionId ? (
                        <span
                          className="cursor-pointer hover:text-primary"
                          onClick={() => setSessionIdFilter(log.sessionId!)}
                          title="Click to filter by this session"
                        >
                          {log.sessionId.substring(0, 8)}...
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-base-300 text-xs text-base-content/70">
            Showing {logs.length} logs
            {status && status.count > logs.length && ` of ${status.count} total`}
          </div>
        </div>
      )}
    </div>
  );
}
