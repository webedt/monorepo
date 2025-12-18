import { useState } from 'react';

interface StatusBanner {
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

interface MobileToolbarProps {
  // Filter controls
  eventFilters: Record<string, boolean>;
  onEventFiltersChange: (filters: Record<string, boolean>) => void;
  // Timestamp toggle
  showTimestamps: boolean;
  onShowTimestampsChange: (show: boolean) => void;
  // Raw JSON toggle
  showRawJson: boolean;
  onShowRawJsonChange: (show: boolean) => void;
  // Status banners
  statusBanners?: StatusBanner[];
  // PR-specific status (legacy support)
  prLoading?: 'create' | 'auto' | null;
  prSuccess?: string | null;
  prError?: string | null;
  autoPrProgress?: string | null;
  onPrSuccessDismiss?: () => void;
  onPrErrorDismiss?: () => void;
}

export default function MobileToolbar({
  eventFilters,
  onEventFiltersChange,
  showTimestamps,
  onShowTimestampsChange,
  showRawJson,
  onShowRawJsonChange,
  statusBanners = [],
  prLoading: _prLoading, // Reserved for future loading indicator
  prSuccess,
  prError,
  autoPrProgress,
  onPrSuccessDismiss,
  onPrErrorDismiss,
}: MobileToolbarProps) {
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);

  // Build combined banners from props
  const allBanners: StatusBanner[] = [...statusBanners];

  if (autoPrProgress) {
    allBanners.push({
      type: 'info',
      message: autoPrProgress,
    });
  }

  if (prSuccess) {
    allBanners.push({
      type: 'success',
      message: prSuccess,
      dismissible: true,
      onDismiss: onPrSuccessDismiss,
    });
  }

  if (prError) {
    allBanners.push({
      type: 'error',
      message: prError,
      dismissible: true,
      onDismiss: onPrErrorDismiss,
    });
  }

  const filterOptions = [
    { key: 'thinking', emoji: '🧠', label: 'Thinking' },
    { key: 'message', emoji: '💬', label: 'Status' },
    { key: 'system', emoji: '⚙️', label: 'System' },
    { key: 'connected', emoji: '🔌', label: 'Connection' },
    { key: 'env_manager_log', emoji: '🔧', label: 'Env Logs' },
    { key: 'tool_use', emoji: '🔨', label: 'Tools' },
    { key: 'completed', emoji: '🏁', label: 'Completed' },
    { key: 'title_generation', emoji: '✨', label: 'Title' },
    { key: 'session_name', emoji: '📝', label: 'Session' },
  ];

  return (
    <div className="md:hidden">
      {/* Status Banners */}
      {allBanners.length > 0 && (
        <div className="px-3 py-2 space-y-2 border-b border-base-300 bg-base-100">
          {allBanners.map((banner, index) => (
            <div
              key={index}
              className={`alert py-2 px-3 ${
                banner.type === 'info' ? 'alert-info' :
                banner.type === 'success' ? 'alert-success' :
                banner.type === 'error' ? 'alert-error' :
                'alert-warning'
              }`}
            >
              {banner.type === 'info' && (
                <span className="loading loading-spinner loading-sm"></span>
              )}
              {banner.type === 'success' && (
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {banner.type === 'error' && (
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <span className="text-sm font-medium flex-1">{banner.message}</span>
              {banner.dismissible && banner.onDismiss && (
                <button
                  onClick={banner.onDismiss}
                  className="btn btn-ghost btn-xs btn-circle"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toolbar Controls */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-base-300 bg-base-200/50">
        <div className="flex items-center gap-2">
          {/* Filter dropdown - only show in formatted view */}
          {!showRawJson && (
            <div className="relative">
              <button
                onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                className="btn btn-xs btn-ghost gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span className="hidden xs:inline">Filter</span>
              </button>

              {filterDropdownOpen && (
                <>
                  {/* Backdrop */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setFilterDropdownOpen(false)}
                  />
                  {/* Dropdown */}
                  <div className="absolute left-0 top-full mt-1 z-50 p-2 shadow-lg bg-base-200 rounded-box w-44">
                    {/* All / None buttons */}
                    <div className="flex gap-1 mb-1 pb-1 border-b border-base-300">
                      <button
                        className="btn btn-xs btn-ghost flex-1"
                        onClick={() => {
                          const newFilters = { ...eventFilters };
                          Object.keys(newFilters).forEach(k => newFilters[k] = true);
                          onEventFiltersChange(newFilters);
                        }}
                      >
                        All
                      </button>
                      <span className="text-base-content/30 self-center">/</span>
                      <button
                        className="btn btn-xs btn-ghost flex-1"
                        onClick={() => {
                          const newFilters = { ...eventFilters };
                          Object.keys(newFilters).forEach(k => newFilters[k] = false);
                          // Always keep core message types visible
                          newFilters.user = true;
                          newFilters.assistant = true;
                          newFilters.result = true;
                          newFilters.error = true;
                          onEventFiltersChange(newFilters);
                        }}
                      >
                        None
                      </button>
                    </div>
                    {/* Event type checkboxes */}
                    {filterOptions.map(({ key, emoji, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer px-1 py-0.5">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={eventFilters[key] ?? true}
                          onChange={(e) => onEventFiltersChange({ ...eventFilters, [key]: e.target.checked })}
                        />
                        <span>{emoji}</span>
                        <span className="text-xs">{label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Timestamps toggle - only show in formatted view */}
          {!showRawJson && (
            <button
              onClick={() => onShowTimestampsChange(!showTimestamps)}
              className={`btn btn-xs ${showTimestamps ? 'btn-primary' : 'btn-ghost'}`}
              title={showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}
        </div>

        {/* Raw JSON toggle */}
        <button
          onClick={() => onShowRawJsonChange(!showRawJson)}
          className={`btn btn-xs ${showRawJson ? 'btn-primary' : 'btn-ghost'}`}
          title={showRawJson ? 'Switch to formatted view' : 'Switch to raw JSON view'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span className="hidden xs:inline ml-1">JSON</span>
        </button>
      </div>
    </div>
  );
}
