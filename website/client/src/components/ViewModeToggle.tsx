/**
 * ViewModeToggle Component
 *
 * Re-export of LibraryViewToggle for backward compatibility.
 * Implements SPEC.md Section 4.2 View Options:
 * - Grid View: Thumbnail-based grid layout
 * - List View: Standard list with more details
 * - Compact List View: Dense list for power users
 *
 * @see ./library/LibraryViewToggle.tsx for full implementation
 */
export { default, default as ViewModeToggle } from './library/LibraryViewToggle';
export type { ViewMode } from '@/hooks/useViewMode';
