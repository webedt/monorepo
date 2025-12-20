import { useCallback } from 'react';
import type { StoreItem } from '@/types/store';

export interface WishlistButtonProps {
  item: StoreItem;
  isWishlisted: boolean;
  variant?: 'filled' | 'outline' | 'ghost';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
  onToggle?: (item: StoreItem, isWishlisted: boolean) => void;
}

/**
 * WishlistButton component for adding/removing items from wishlist.
 * Displays a heart icon that toggles between filled and outline states.
 */
export default function WishlistButton({
  item,
  isWishlisted,
  variant = 'ghost',
  size = 'md',
  showLabel = false,
  className = '',
  onToggle,
}: WishlistButtonProps) {
  // Get button size classes
  const getSizeClasses = (): string => {
    switch (size) {
      case 'xs':
        return 'btn-xs';
      case 'sm':
        return 'btn-sm';
      case 'lg':
        return 'btn-lg';
      default:
        return '';
    }
  };

  // Get icon size classes
  const getIconSizeClasses = (): string => {
    switch (size) {
      case 'xs':
        return 'h-3 w-3';
      case 'sm':
        return 'h-4 w-4';
      case 'lg':
        return 'h-6 w-6';
      default:
        return 'h-5 w-5';
    }
  };

  // Get button variant classes
  const getVariantClasses = (): string => {
    if (isWishlisted) {
      return 'btn-error';
    }

    switch (variant) {
      case 'filled':
        return 'btn-outline btn-error hover:bg-error hover:text-white';
      case 'outline':
        return 'btn-outline hover:btn-error';
      default:
        return 'btn-ghost hover:text-error';
    }
  };

  // Handle toggle click
  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (onToggle) {
        onToggle(item, !isWishlisted);
      } else {
        console.log('Wishlist toggle:', item.title, !isWishlisted ? 'added' : 'removed');
      }
    },
    [item, isWishlisted, onToggle]
  );

  // Heart icon
  const HeartIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`${getIconSizeClasses()} ${isWishlisted ? 'fill-current' : ''}`}
      viewBox="0 0 24 24"
      fill={isWishlisted ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );

  // Circular button without label
  if (!showLabel) {
    return (
      <button
        className={`btn btn-circle ${getSizeClasses()} ${getVariantClasses()} ${className}`}
        onClick={handleToggle}
        title={isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
        aria-label={isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
        aria-pressed={isWishlisted}
      >
        <HeartIcon />
      </button>
    );
  }

  // Button with label
  return (
    <button
      className={`btn ${getSizeClasses()} ${getVariantClasses()} ${className}`}
      onClick={handleToggle}
      aria-pressed={isWishlisted}
    >
      <HeartIcon />
      <span>{isWishlisted ? 'In Wishlist' : 'Add to Wishlist'}</span>
    </button>
  );
}

/**
 * Compact wishlist indicator for lists and minimal views.
 */
export function WishlistIndicator({
  isWishlisted,
  size = 'sm',
  className = '',
}: {
  isWishlisted: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  if (!isWishlisted) return null;

  const getSizeClasses = (): string => {
    switch (size) {
      case 'xs':
        return 'h-3 w-3';
      case 'md':
        return 'h-5 w-5';
      default:
        return 'h-4 w-4';
    }
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`${getSizeClasses()} text-error fill-error ${className}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-label="In Wishlist"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
