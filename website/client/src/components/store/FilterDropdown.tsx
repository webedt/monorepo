interface FilterDropdownProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Record<T, string>;
  className?: string;
  ariaLabel?: string;
}

/**
 * FilterDropdown - Reusable dropdown component for store filters.
 * Implements filter dropdowns from SPEC.md Section 3.3.
 * Used for category, genre, price range, and other filter types.
 */
export default function FilterDropdown<T extends string>({
  value,
  onChange,
  options,
  className = '',
  ariaLabel,
}: FilterDropdownProps<T>) {
  return (
    <select
      className={`select select-bordered select-sm ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
    >
      {(Object.keys(options) as T[]).map((optionKey) => (
        <option key={optionKey} value={optionKey}>
          {options[optionKey]}
        </option>
      ))}
    </select>
  );
}
