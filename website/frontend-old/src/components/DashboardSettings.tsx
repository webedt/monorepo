import { useState } from 'react';
import type { DashboardWidget } from '@/hooks/useDashboardLayout';
import type { UserFocusType } from '@/hooks/useDashboardPreferences';

/**
 * Props for the DashboardSettings component
 */
interface DashboardSettingsProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** All available widgets */
  widgets: DashboardWidget[];
  /** Current user focus setting */
  userFocus: UserFocusType;
  /** Whether dashboard is set as landing page */
  dashboardAsLandingPage: boolean;
  /** Callback to toggle widget visibility */
  onToggleWidget: (widgetId: string) => void;
  /** Callback to apply a focus preset */
  onApplyFocusPreset: (focus: UserFocusType) => void;
  /** Callback to set dashboard as landing page */
  onSetDashboardAsLandingPage: (value: boolean) => void;
  /** Callback to reset to defaults */
  onResetToDefaults: () => void;
  /** Callback to move widget up */
  onMoveWidgetUp: (widgetId: string) => void;
  /** Callback to move widget down */
  onMoveWidgetDown: (widgetId: string) => void;
}

/**
 * Focus preset descriptions for better UX
 */
const focusDescriptions: Record<UserFocusType, { title: string; description: string; icon: string }> = {
  player: {
    title: 'Player Focus',
    description: 'Optimized for gaming - shows recently played games, library favorites, and store highlights.',
    icon: '🎮',
  },
  editor: {
    title: 'Editor Focus',
    description: 'Optimized for development - shows editor quick access, session activity, and tools.',
    icon: '💻',
  },
  balanced: {
    title: 'Balanced',
    description: 'Shows all widgets - perfect for users who use both gaming and development features.',
    icon: '⚖️',
  },
};

/**
 * DashboardSettings - Modal component for dashboard customization
 *
 * Features:
 * - User focus selection (player vs editor)
 * - Widget visibility toggles
 * - Widget reordering controls
 * - Landing page preference
 * - Reset to defaults option
 *
 * Implements SPEC.md Section 2.3 - Personalization:
 * - Adapts based on user preferences (player vs. editor focus)
 * - Default landing page configurable in settings
 */
export function DashboardSettings({
  isOpen,
  onClose,
  widgets,
  userFocus,
  dashboardAsLandingPage,
  onToggleWidget,
  onApplyFocusPreset,
  onSetDashboardAsLandingPage,
  onResetToDefaults,
  onMoveWidgetUp,
  onMoveWidgetDown,
}: DashboardSettingsProps) {
  const [activeTab, setActiveTab] = useState<'focus' | 'widgets' | 'preferences'>('focus');

  if (!isOpen) return null;

  // Sort widgets by order for display
  const sortedWidgets = [...widgets].sort((a, b) => a.order - b.order);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="
          relative w-full max-w-2xl mx-4
          bg-base-100 rounded-2xl shadow-2xl
          max-h-[90vh] flex flex-col
          animate-in fade-in zoom-in-95 duration-200
        "
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-base-300">
          <h2 id="settings-title" className="text-xl font-bold text-base-content">
            Dashboard Settings
          </h2>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Close settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-base-300 px-6">
          <button
            onClick={() => setActiveTab('focus')}
            className={`
              px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${activeTab === 'focus'
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/70 hover:text-base-content'
              }
            `}
          >
            Focus Mode
          </button>
          <button
            onClick={() => setActiveTab('widgets')}
            className={`
              px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${activeTab === 'widgets'
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/70 hover:text-base-content'
              }
            `}
          >
            Widgets
          </button>
          <button
            onClick={() => setActiveTab('preferences')}
            className={`
              px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${activeTab === 'preferences'
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/70 hover:text-base-content'
              }
            `}
          >
            Preferences
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Focus Mode Tab */}
          {activeTab === 'focus' && (
            <div className="space-y-4">
              <p className="text-sm text-base-content/70 mb-4">
                Choose a focus mode to quickly configure your dashboard for your preferred workflow.
              </p>

              <div className="grid gap-4">
                {(Object.entries(focusDescriptions) as [UserFocusType, typeof focusDescriptions['player']][]).map(
                  ([focus, { title, description, icon }]) => (
                    <button
                      key={focus}
                      onClick={() => onApplyFocusPreset(focus)}
                      className={`
                        w-full p-4 rounded-xl text-left transition-all
                        border-2 hover:shadow-md
                        ${userFocus === focus
                          ? 'border-primary bg-primary/10'
                          : 'border-base-300 hover:border-primary/50'
                        }
                      `}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{icon}</span>
                        <div>
                          <h3 className="font-semibold text-base-content flex items-center gap-2">
                            {title}
                            {userFocus === focus && (
                              <span className="badge badge-primary badge-sm">Active</span>
                            )}
                          </h3>
                          <p className="text-sm text-base-content/70 mt-1">{description}</p>
                        </div>
                      </div>
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* Widgets Tab */}
          {activeTab === 'widgets' && (
            <div className="space-y-4">
              <p className="text-sm text-base-content/70 mb-4">
                Toggle widgets on or off, and reorder them using the arrow buttons.
              </p>

              <div className="space-y-2">
                {sortedWidgets.map((widget, index) => (
                  <div
                    key={widget.id}
                    className={`
                      flex items-center gap-3 p-3 rounded-lg
                      bg-base-200 transition-colors
                      ${widget.enabled ? '' : 'opacity-60'}
                    `}
                  >
                    {/* Toggle */}
                    <input
                      type="checkbox"
                      checked={widget.enabled}
                      onChange={() => onToggleWidget(widget.id)}
                      className="checkbox checkbox-primary checkbox-sm"
                      aria-label={`Toggle ${widget.title}`}
                    />

                    {/* Widget Title */}
                    <span className="flex-1 font-medium text-sm">{widget.title}</span>

                    {/* Reorder Buttons */}
                    <div className="flex gap-1">
                      <button
                        onClick={() => onMoveWidgetUp(widget.id)}
                        disabled={index === 0}
                        className="btn btn-ghost btn-xs btn-square"
                        title="Move up"
                        aria-label={`Move ${widget.title} up`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => onMoveWidgetDown(widget.id)}
                        disabled={index === sortedWidgets.length - 1}
                        className="btn btn-ghost btn-xs btn-square"
                        title="Move down"
                        aria-label={`Move ${widget.title} down`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-base-300">
                <p className="text-xs text-base-content/50">
                  Tip: You can also drag and drop widgets directly on the dashboard to reorder them.
                </p>
              </div>
            </div>
          )}

          {/* Preferences Tab */}
          {activeTab === 'preferences' && (
            <div className="space-y-6">
              {/* Landing Page Setting */}
              <div className="space-y-2">
                <h3 className="font-semibold text-base-content">Default Landing Page</h3>
                <p className="text-sm text-base-content/70">
                  Configure whether the dashboard should be shown when you first log in.
                </p>
                <label className="flex items-center gap-3 p-3 bg-base-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dashboardAsLandingPage}
                    onChange={(e) => onSetDashboardAsLandingPage(e.target.checked)}
                    className="checkbox checkbox-primary"
                  />
                  <div>
                    <span className="font-medium text-sm">Use Dashboard as landing page</span>
                    <p className="text-xs text-base-content/60">
                      When enabled, you'll see the dashboard first after logging in.
                    </p>
                  </div>
                </label>
              </div>

              {/* Reset to Defaults */}
              <div className="space-y-2 pt-4 border-t border-base-300">
                <h3 className="font-semibold text-base-content">Reset Settings</h3>
                <p className="text-sm text-base-content/70">
                  Reset all dashboard customizations to their default values.
                </p>
                <button
                  onClick={() => {
                    if (window.confirm('Are you sure you want to reset all dashboard settings to defaults?')) {
                      onResetToDefaults();
                    }
                  }}
                  className="btn btn-outline btn-error btn-sm"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Reset to Defaults
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-base-300">
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default DashboardSettings;
