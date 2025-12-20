import type { ReactNode } from 'react';
import type { DashboardWidget } from '@/hooks/useDashboardLayout';

/**
 * Props for the WidgetContainer component
 */
interface WidgetContainerProps {
  /** The widget being rendered */
  widget: DashboardWidget;
  /** Content to render inside the widget */
  children: ReactNode;
  /** Whether this widget is currently being dragged */
  isDragging?: boolean;
  /** Whether drag-and-drop is enabled (customization mode) */
  isDragEnabled?: boolean;
  /** Handler called when drag starts */
  onDragStart?: (e: React.DragEvent, widgetId: string) => void;
  /** Handler called during drag over */
  onDragOver?: (e: React.DragEvent) => void;
  /** Handler called when widget is dropped */
  onDrop?: (e: React.DragEvent, widgetId: string) => void;
  /** Handler called when drag ends */
  onDragEnd?: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * WidgetContainer - A reusable container component for dashboard widgets
 *
 * Features:
 * - Drag-and-drop support for widget reordering (SPEC.md Section 2.1)
 * - Consistent styling across all widgets
 * - Visual feedback during drag operations
 * - Responsive design with smooth transitions
 *
 * @example
 * ```tsx
 * <WidgetContainer
 *   widget={widget}
 *   isDragging={draggedWidget === widget.id}
 *   onDragStart={handleDragStart}
 *   onDragOver={handleDragOver}
 *   onDrop={handleDrop}
 *   onDragEnd={handleDragEnd}
 * >
 *   <RecentlyPlayedWidget />
 * </WidgetContainer>
 * ```
 */
export function WidgetContainer({
  widget,
  children,
  isDragging = false,
  isDragEnabled = true,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  className = '',
}: WidgetContainerProps) {
  return (
    <div
      className={`
        bg-base-100 rounded-xl shadow-lg overflow-hidden
        transition-all duration-200 ease-in-out
        ${isDragging ? 'opacity-50 scale-95 ring-2 ring-primary shadow-xl' : 'hover:shadow-xl'}
        ${isDragEnabled ? 'cursor-move' : ''}
        ${className}
      `}
      draggable={isDragEnabled}
      onDragStart={(e) => isDragEnabled && onDragStart?.(e, widget.id)}
      onDragOver={(e) => isDragEnabled && onDragOver?.(e)}
      onDrop={(e) => isDragEnabled && onDrop?.(e, widget.id)}
      onDragEnd={onDragEnd}
      role="article"
      aria-label={`${widget.title} widget`}
      aria-grabbed={isDragging}
    >
      {/* Widget Header */}
      <div
        className={`
          flex items-center justify-between px-4 py-3
          bg-base-200 border-b border-base-300
          ${isDragEnabled ? 'cursor-move select-none' : ''}
        `}
      >
        <h3 className="font-semibold text-base-content flex items-center gap-2">
          {/* Drag handle icon - only show when drag is enabled */}
          {isDragEnabled && (
            <svg
              className="w-4 h-4 text-base-content/50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8h16M4 16h16"
              />
            </svg>
          )}
          {widget.title}
        </h3>

        {/* Optional widget actions slot could go here */}
      </div>

      {/* Widget Content */}
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

export default WidgetContainer;
