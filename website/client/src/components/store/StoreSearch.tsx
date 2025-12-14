import { useRef, useEffect } from 'react';

interface StoreSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  resultCount?: number;
  totalCount?: number;
  autoFocus?: boolean;
}

/**
 * StoreSearch component - Universal search box for the store.
 * Implements SPEC.md Section 3.3 - Search & Filtering:
 * "Universal Search Box: Single text input that searches across all fields
 * (title, description, tags, creator, etc.)"
 *
 * Features:
 * - Search icon
 * - Clear button when text is present
 * - Optional result count display
 * - Auto-focus support
 * - Keyboard shortcut hint (Ctrl/Cmd + K)
 */
export default function StoreSearch({
  value,
  onChange,
  placeholder = 'Search games, creators, tags...',
  resultCount,
  totalCount,
  autoFocus = false,
}: StoreSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount if requested
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Handle keyboard shortcut (Ctrl/Cmd + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const showResultCount = resultCount !== undefined && totalCount !== undefined;

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          className="input input-bordered w-full pl-10 pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Search store"
        />
        {/* Search Icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-base-content/50"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {/* Clear Button */}
        {value && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
            onClick={() => onChange('')}
            aria-label="Clear search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Result Count - shown below search input when searching */}
      {showResultCount && value && (
        <div className="text-xs text-base-content/50 mt-1 ml-1">
          Found {resultCount} of {totalCount} items
        </div>
      )}
    </div>
  );
}
