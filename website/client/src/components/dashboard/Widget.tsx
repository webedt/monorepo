import type { DashboardWidget } from '@/hooks/useDashboardLayout';

/**
 * Props for the Widget component
 */
interface WidgetProps {
  /** Widget configuration */
  widget: DashboardWidget;
  /** Widget content to render */
  children: React.ReactNode;
  /** Whether this widget is currently being dragged */
  isDragging?: boolean;
  /** Handler called when drag starts */
  onDragStart?: (e: React.DragEvent, widgetId: string) => void;
  /** Handler called during drag over */
  onDragOver?: (e: React.DragEvent) => void;
  /** Handler called when widget is dropped */
  onDrop?: (e: React.DragEvent, widgetId: string) => void;
  /** Handler called when drag ends */
  onDragEnd?: () => void;
}

/**
 * Base Widget component for the Dashboard
 * Provides drag-and-drop functionality and consistent styling
 * Implements SPEC.md Section 2.1 - Drag-and-drop widget arrangement
 */
export function Widget({
  widget,
  children,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: WidgetProps) {
  return (
    <div
      className={`bg-base-100 rounded-xl shadow-lg overflow-hidden transition-all duration-200 ${
        isDragging ? 'opacity-50 scale-95 ring-2 ring-primary' : ''
      }`}
      draggable
      onDragStart={(e) => onDragStart?.(e, widget.id)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop?.(e, widget.id)}
      onDragEnd={onDragEnd}
    >
      {/* Widget Header - Draggable handle */}
      <div className="flex items-center justify-between px-4 py-3 bg-base-200 border-b border-base-300 cursor-move select-none">
        <h3 className="font-semibold text-base-content flex items-center gap-2">
          {/* Drag handle icon */}
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
          {widget.title}
        </h3>
      </div>
      {/* Widget Content */}
      <div className="p-4">{children}</div>
    </div>
  );
}

export default Widget;
