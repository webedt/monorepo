import { useState, useCallback } from 'react';
import type { StoreItem } from '@/types/store';

export interface PurchaseButtonProps {
  item: StoreItem;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
  onPurchase?: (item: StoreItem) => void;
  onPlayNow?: (item: StoreItem) => void;
}

/**
 * PurchaseButton component for store items.
 * Displays appropriate action based on item price (Buy Now, Get Free, Play Now).
 * Handles purchase flow and integrates with checkout.
 */
export default function PurchaseButton({
  item,
  variant = 'primary',
  size = 'md',
  showIcon = true,
  className = '',
  onPurchase,
  onPlayNow,
}: PurchaseButtonProps) {
  const [isPurchasing, setIsPurchasing] = useState(false);

  const isFree = item.price === null || item.price === 0;
  const hasDiscount = item.isOnSale && item.originalPrice && item.salePercentage;

  // Format price for display
  const formatPrice = (price: number | null): string => {
    if (price === null || price === 0) {
      return 'Free';
    }
    return `$${price.toFixed(2)}`;
  };

  // Get button size classes
  const getSizeClasses = (): string => {
    switch (size) {
      case 'sm':
        return 'btn-sm';
      case 'lg':
        return 'btn-lg';
      default:
        return '';
    }
  };

  // Get button variant classes
  const getVariantClasses = (): string => {
    switch (variant) {
      case 'secondary':
        return 'btn-secondary';
      case 'ghost':
        return 'btn-ghost';
      default:
        return 'btn-primary';
    }
  };

  // Handle purchase click
  const handlePurchase = useCallback(async () => {
    setIsPurchasing(true);
    try {
      // Simulate purchase flow - in production this would integrate with Stripe/PayPal
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (onPurchase) {
        onPurchase(item);
      } else {
        console.log('Purchase initiated:', item.title, formatPrice(item.price));
      }
    } finally {
      setIsPurchasing(false);
    }
  }, [item, onPurchase]);

  // Handle play now click (for free items or already owned)
  const handlePlayNow = useCallback(() => {
    if (onPlayNow) {
      onPlayNow(item);
    } else {
      console.log('Play Now:', item.title);
    }
  }, [item, onPlayNow]);

  // Render play icon
  const PlayIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );

  // Render cart/purchase icon
  const CartIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );

  // Free items - show "Get Free" or "Play Now" button
  if (isFree) {
    return (
      <button
        className={`btn ${getVariantClasses()} ${getSizeClasses()} ${className}`}
        onClick={handlePlayNow}
        disabled={isPurchasing}
      >
        {showIcon && <PlayIcon />}
        <span>Play Now</span>
        <span className="badge badge-success badge-sm ml-1">Free</span>
      </button>
    );
  }

  // Paid items - show "Buy Now" button with price
  return (
    <button
      className={`btn ${getVariantClasses()} ${getSizeClasses()} ${className}`}
      onClick={handlePurchase}
      disabled={isPurchasing}
    >
      {isPurchasing ? (
        <>
          <span className="loading loading-spinner loading-sm"></span>
          <span>Processing...</span>
        </>
      ) : (
        <>
          {showIcon && <CartIcon />}
          <span>Buy Now</span>
          <span className="flex items-center gap-1 ml-1">
            {hasDiscount && (
              <span className="text-xs line-through opacity-60">
                ${item.originalPrice?.toFixed(2)}
              </span>
            )}
            <span className={hasDiscount ? 'text-warning' : ''}>
              {formatPrice(item.price)}
            </span>
          </span>
        </>
      )}
    </button>
  );
}

/**
 * Compact price display component for use in cards and lists.
 */
export function PriceDisplay({
  price,
  originalPrice,
  isOnSale,
  salePercentage,
  size = 'md',
  className = '',
}: {
  price: number | null;
  originalPrice?: number | null;
  isOnSale?: boolean;
  salePercentage?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const isFree = price === null || price === 0;
  const hasDiscount = isOnSale && originalPrice && salePercentage;

  const formatPrice = (p: number | null): string => {
    if (p === null || p === 0) return 'Free';
    return `$${p.toFixed(2)}`;
  };

  const getSizeClasses = (): string => {
    switch (size) {
      case 'sm':
        return 'text-sm';
      case 'lg':
        return 'text-2xl';
      default:
        return 'text-xl';
    }
  };

  if (isFree) {
    return (
      <span className={`badge badge-success ${size === 'lg' ? 'badge-lg' : ''} font-bold ${className}`}>
        Free
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {hasDiscount && (
        <>
          <span className="badge badge-error badge-sm font-bold">-{salePercentage}%</span>
          <span className="text-base-content/50 line-through text-sm">
            ${originalPrice?.toFixed(2)}
          </span>
        </>
      )}
      <span className={`font-bold ${getSizeClasses()} ${hasDiscount ? 'text-error' : 'text-primary'}`}>
        {formatPrice(price)}
      </span>
    </div>
  );
}
