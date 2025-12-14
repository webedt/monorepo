import { useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StoreItem } from '@/types/store';
import TrailerPlayer from './TrailerPlayer';
import PurchaseButton, { PriceDisplay } from './PurchaseButton';
import WishlistButton from './WishlistButton';

export interface StoreItemModalProps {
  item: StoreItem | null;
  isOpen: boolean;
  isWishlisted: boolean;
  allItems?: StoreItem[];
  onClose: () => void;
  onToggleWishlist: (item: StoreItem) => void;
  onPurchase?: (item: StoreItem) => void;
  onPlayNow?: (item: StoreItem) => void;
  onNavigate?: (item: StoreItem) => void;
}

/**
 * StoreItemModal component for displaying detailed store item information.
 * Shows comprehensive info including trailer, description, metadata,
 * purchase/wishlist functionality, and navigation between items.
 */
export default function StoreItemModal({
  item,
  isOpen,
  isWishlisted,
  allItems = [],
  onClose,
  onToggleWishlist,
  onPurchase,
  onPlayNow,
  onNavigate,
}: StoreItemModalProps) {
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Find current item index for navigation
  const currentIndex = item ? allItems.findIndex((i) => i.id === item.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allItems.length - 1 && currentIndex !== -1;

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          if (hasPrev && allItems[currentIndex - 1]) {
            onNavigate?.(allItems[currentIndex - 1]);
          }
          break;
        case 'ArrowRight':
          if (hasNext && allItems[currentIndex + 1]) {
            onNavigate?.(allItems[currentIndex + 1]);
          }
          break;
      }
    },
    [isOpen, hasPrev, hasNext, currentIndex, allItems, onClose, onNavigate]
  );

  // Set up keyboard listeners
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Handle body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Focus trap - focus close button when modal opens
  useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [isOpen]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle wishlist toggle
  const handleToggleWishlist = useCallback(() => {
    if (item) {
      onToggleWishlist(item);
    }
  }, [item, onToggleWishlist]);

  // Handle purchase
  const handlePurchase = useCallback(() => {
    if (item) {
      if (onPurchase) {
        onPurchase(item);
      } else {
        console.log('Purchase:', item.title);
      }
    }
  }, [item, onPurchase]);

  // Handle play now
  const handlePlayNow = useCallback(() => {
    if (item) {
      if (onPlayNow) {
        onPlayNow(item);
      } else {
        navigate(`/store/${item.id}`);
        onClose();
      }
    }
  }, [item, onPlayNow, navigate, onClose]);

  // Navigate to previous item
  const handlePrevItem = useCallback(() => {
    if (hasPrev && allItems[currentIndex - 1]) {
      onNavigate?.(allItems[currentIndex - 1]);
    }
  }, [hasPrev, currentIndex, allItems, onNavigate]);

  // Navigate to next item
  const handleNextItem = useCallback(() => {
    if (hasNext && allItems[currentIndex + 1]) {
      onNavigate?.(allItems[currentIndex + 1]);
    }
  }, [hasNext, currentIndex, allItems, onNavigate]);

  // Render star rating
  const renderRating = (rating: number | undefined, reviewCount: number | undefined) => {
    if (rating === undefined) return null;

    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <svg
              key={star}
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 ${
                star <= Math.round(rating) ? 'text-warning fill-warning' : 'text-base-content/20'
              }`}
              viewBox="0 0 24 24"
              fill={star <= Math.round(rating) ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
          ))}
        </div>
        <span className="text-base-content font-medium">{rating.toFixed(1)}</span>
        {reviewCount !== undefined && (
          <span className="text-base-content/60">({reviewCount.toLocaleString()} reviews)</span>
        )}
      </div>
    );
  };

  if (!isOpen || !item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Navigation Buttons */}
      {allItems.length > 1 && (
        <>
          {/* Previous Button */}
          <button
            className={`absolute left-4 top-1/2 -translate-y-1/2 btn btn-circle btn-lg bg-base-100/80 hover:bg-base-100 ${
              !hasPrev ? 'opacity-30 cursor-not-allowed' : ''
            }`}
            onClick={(e) => {
              e.stopPropagation();
              handlePrevItem();
            }}
            disabled={!hasPrev}
            aria-label="Previous item"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Next Button */}
          <button
            className={`absolute right-4 top-1/2 -translate-y-1/2 btn btn-circle btn-lg bg-base-100/80 hover:bg-base-100 ${
              !hasNext ? 'opacity-30 cursor-not-allowed' : ''
            }`}
            onClick={(e) => {
              e.stopPropagation();
              handleNextItem();
            }}
            disabled={!hasNext}
            aria-label="Next item"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      {/* Modal Content */}
      <div
        ref={modalRef}
        className="bg-base-100 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-base-300">
          <div className="flex items-center gap-2">
            {allItems.length > 1 && (
              <span className="text-sm text-base-content/60">
                {currentIndex + 1} of {allItems.length}
              </span>
            )}
          </div>
          <button
            ref={closeButtonRef}
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close modal"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Media Section - Trailer or Thumbnail */}
          <div className="relative aspect-video bg-black">
            {item.trailerUrl ? (
              <TrailerPlayer
                src={item.trailerUrl}
                poster={item.thumbnail}
                autoPlay
                muted={false}
                loop={false}
                controls
                className="w-full h-full"
              />
            ) : (
              <img
                src={item.thumbnail}
                alt={item.title}
                className="w-full h-full object-cover"
              />
            )}

            {/* Badges overlay */}
            <div className="absolute top-4 left-4 flex flex-col gap-2">
              {item.isNew && (
                <span className="badge badge-secondary font-bold">NEW</span>
              )}
              {item.isOnSale && item.salePercentage && (
                <span className="badge badge-error font-bold">-{item.salePercentage}% OFF</span>
              )}
              {item.isFeatured && (
                <span className="badge badge-primary font-bold">FEATURED</span>
              )}
            </div>
          </div>

          {/* Info Section */}
          <div className="p-6 space-y-6">
            {/* Title and Creator */}
            <div>
              <h2 id="modal-title" className="text-3xl font-bold text-base-content mb-2">
                {item.title}
              </h2>
              <div className="flex items-center gap-3 text-base-content/70">
                <span className="font-medium">{item.creator}</span>
                <span>•</span>
                <span className="capitalize">{item.category}</span>
                <span>•</span>
                <span className="capitalize">{item.genre}</span>
              </div>
            </div>

            {/* Rating */}
            {renderRating(item.rating, item.reviewCount)}

            {/* Price and Actions */}
            <div className="flex flex-wrap items-center gap-4 py-4 border-y border-base-300">
              <PriceDisplay
                price={item.price}
                originalPrice={item.originalPrice}
                isOnSale={item.isOnSale}
                salePercentage={item.salePercentage}
                size="lg"
              />

              <div className="flex-1"></div>

              <div className="flex items-center gap-3">
                <WishlistButton
                  item={item}
                  isWishlisted={isWishlisted}
                  variant="outline"
                  size="md"
                  showLabel
                  onToggle={handleToggleWishlist}
                />

                <PurchaseButton
                  item={item}
                  variant="primary"
                  size="lg"
                  onPurchase={handlePurchase}
                  onPlayNow={handlePlayNow}
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <h3 className="text-lg font-semibold mb-2">About this game</h3>
              <p className="text-base-content/80 leading-relaxed">{item.description}</p>
            </div>

            {/* Tags */}
            {item.tags && item.tags.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <span key={tag} className="badge badge-outline">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Details Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-base-200 rounded-lg p-3">
                <div className="text-sm text-base-content/60">Release Date</div>
                <div className="font-medium">
                  {new Date(item.releaseDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
              </div>

              <div className="bg-base-200 rounded-lg p-3">
                <div className="text-sm text-base-content/60">Category</div>
                <div className="font-medium capitalize">{item.category}</div>
              </div>

              <div className="bg-base-200 rounded-lg p-3">
                <div className="text-sm text-base-content/60">Genre</div>
                <div className="font-medium capitalize">{item.genre}</div>
              </div>

              <div className="bg-base-200 rounded-lg p-3">
                <div className="text-sm text-base-content/60">Creator</div>
                <div className="font-medium">{item.creator}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-base-300 bg-base-200/50">
          <div className="flex items-center justify-between text-sm text-base-content/60">
            <span>Press Escape to close • Arrow keys to navigate</span>
            <button
              className="link link-primary"
              onClick={() => {
                navigate(`/store/${item.id}`);
                onClose();
              }}
            >
              View Full Page
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
