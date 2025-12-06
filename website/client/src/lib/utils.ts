import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Truncate a session name if it exceeds the maximum length
 * @param name The session name to truncate
 * @param maxLength Maximum length before truncation (default: 80)
 * @returns Truncated name with ellipsis if needed
 */
export function truncateSessionName(name: string, maxLength: number = 80): string {
  if (!name || name.length <= maxLength) {
    return name;
  }
  return name.substring(0, maxLength - 3) + '...';
}
