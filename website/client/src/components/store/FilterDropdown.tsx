interface FilterDropdownProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Record<T, string>;
  className?: string;
}

/**
 * Generic FilterDropdown component for the store.
 * Implements filter dropdowns from SPEC.md Section 3.3.
 * Used for category, genre, and price range filters.
 */
export default function FilterDropdown<T extends string>({
  value,
  onChange,
  options,
  className = '',
}: FilterDropdownProps<T>) {
  return (
    <select
      className={`select select-bordered select-sm ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {(Object.keys(options) as T[]).map((optionKey) => (
        <option key={optionKey} value={optionKey}>
          {options[optionKey]}
        </option>
      ))}
    </select>
  );
}
