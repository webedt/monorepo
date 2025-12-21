import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StoreItem } from '@/types/store';

export interface StoreItemCardProps {
  item: StoreItem;
  isWishlisted: boolean;
  onPlayNow?: (item: StoreItem) => void;
  onViewTrailer?: (item: StoreItem) => void;
  onToggleWishlist?: (item: StoreItem) => void;
  onClick?: (item: StoreItem) => void;
}

export default function StoreItemCard({
  item,
  isWishlisted,
  onPlayNow,
  onViewTrailer,
  onToggleWishlist,
  onClick,
}: StoreItemCardProps) {
  const navigate = useNavigate();
  const [isHovering, setIsHovering] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerLoaded, setTrailerLoaded] = useState(false);
  const [trailerError, setTrailerError] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (trailerTimeoutRef.current) {
        clearTimeout(trailerTimeoutRef.current);
      }
    };
  }, []);

  // Handle video playback when showTrailer changes
  useEffect(() => {
    if (showTrailer && videoRef.current && trailerLoaded) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked by browser
        setTrailerError(true);
      });
    } else if (!showTrailer && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [showTrailer, trailerLoaded]);

  const handleMouseEnter = useCallback(() => {
    // Delay hover state to prevent flickering
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
    }, 300);

    // Delay trailer auto-play for Netflix/YouTube style effect
    if (item.trailerUrl) {
      trailerTimeoutRef.current = setTimeout(() => {
        setShowTrailer(true);
      }, 800); // Start playing trailer after 800ms of hovering
    }
  }, [item.trailerUrl]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    if (trailerTimeoutRef.current) {
      clearTimeout(trailerTimeoutRef.current);
    }
    setIsHovering(false);
    setShowTrailer(false);
  }, []);

  const handlePlayNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPlayNow) {
      onPlayNow(item);
    } else {
      console.log('Play Now:', item.title);
    }
  };

  const handleViewTrailer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onViewTrailer) {
      onViewTrailer(item);
    } else {
      console.log('View Trailer:', item.title);
    }
  };

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleWishlist) {
      onToggleWishlist(item);
    } else {
      console.log('Toggle Wishlist:', item.title);
    }
  };

  const formatPrice = (price: number | null): string => {
    if (price === null || price === 0) {
      return 'Free';
    }
    return `$${price.toFixed(2)}`;
  };

  const isFree = item.price === null || item.price === 0;
  const hasDiscount = item.isOnSale && item.originalPrice && item.salePercentage;

  return (
    <div
      className="card bg-base-100 shadow-xl hover:shadow-2xl transition-all duration-300"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Thumbnail with hover trailer auto-play (Netflix/YouTube style) */}
      <figure
        className="relative h-48 overflow-hidden cursor-pointer group"
        onClick={() => onClick ? onClick(item) : navigate(`/item/${item.id}`)}
      >
        {/* Thumbnail Image */}
        <img
          src={item.thumbnail}
          alt={item.title}
          className={`w-full h-full object-cover transition-all duration-300 ${
            isHovering ? 'scale-110' : 'scale-100'
          } ${showTrailer && trailerLoaded && !trailerError ? 'opacity-0' : 'opacity-100'}`}
        />

        {/* Video Trailer (auto-plays on hover) */}
        {item.trailerUrl && (
          <video
            ref={videoRef}
            src={item.trailerUrl}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              showTrailer && trailerLoaded && !trailerError ? 'opacity-100' : 'opacity-0'
            }`}
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedData={() => setTrailerLoaded(true)}
            onError={() => setTrailerError(true)}
          />
        )}

        {/* Hover Overlay - shown when no trailer is playing */}
        <div
          className={`absolute inset-0 bg-black/70 transition-opacity duration-300 flex flex-col items-center justify-center ${
            isHovering && (!showTrailer || !trailerLoaded || trailerError) ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {item.trailerUrl && !trailerError ? (
            <div className="text-center text-white">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-12 w-12 mx-auto mb-2 animate-pulse"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              <p className="text-sm opacity-75">Loading trailer...</p>
            </div>
          ) : item.trailerUrl && trailerError ? (
            <div className="text-center text-white">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-12 w-12 mx-auto mb-2"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              <p className="text-sm opacity-75">Click to view trailer</p>
            </div>
          ) : (
            <div className="text-white transform scale-90 hover:scale-100 transition-transform duration-300">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-12 w-12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </div>
          )}
        </div>

        {/* Video Playing Indicator */}
        {showTrailer && trailerLoaded && !trailerError && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-1 rounded text-white text-xs">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            <span>Playing</span>
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {item.isNew && (
            <span className="badge badge-secondary badge-sm font-bold">NEW</span>
          )}
          {hasDiscount && (
            <span className="badge badge-error badge-sm font-bold">
              -{item.salePercentage}%
            </span>
          )}
          {item.isFeatured && (
            <span className="badge badge-primary badge-sm font-bold">FEATURED</span>
          )}
        </div>

        {/* Wishlist Button - Top Right */}
        <button
          className={`absolute top-2 right-2 btn btn-sm btn-circle ${
            isWishlisted ? 'btn-error' : 'btn-ghost bg-base-100/80 hover:bg-base-100'
          }`}
          onClick={handleToggleWishlist}
          title={isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill={isWishlisted ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </figure>

      <div className="card-body p-4">
        {/* Title */}
        <h2 className="card-title text-lg line-clamp-1">{item.title}</h2>

        {/* Creator and Category */}
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span>{item.creator}</span>
          <span>|</span>
          <span className="capitalize">{item.category}</span>
        </div>

        {/* Description */}
        <p className="text-sm text-base-content/70 line-clamp-2 mb-2">
          {item.description}
        </p>

        {/* Rating */}
        {item.rating !== undefined && (
          <div className="flex items-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <svg
                key={star}
                xmlns="http://www.w3.org/2000/svg"
                className={`h-4 w-4 ${
                  star <= Math.round(item.rating || 0)
                    ? 'text-warning fill-warning'
                    : 'text-base-content/30'
                }`}
                viewBox="0 0 24 24"
                fill={star <= Math.round(item.rating || 0) ? 'currentColor' : 'none'}
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
            {item.reviewCount !== undefined && (
              <span className="text-xs text-base-content/50 ml-1">
                ({item.reviewCount})
              </span>
            )}
          </div>
        )}

        {/* Price */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isFree ? (
              <span className="badge badge-success badge-lg font-bold">Free</span>
            ) : hasDiscount ? (
              <>
                <span className="text-base-content/50 line-through text-sm">
                  ${item.originalPrice?.toFixed(2)}
                </span>
                <span className="text-xl font-bold text-error">
                  {formatPrice(item.price)}
                </span>
              </>
            ) : (
              <span className="text-xl font-bold text-primary">
                {formatPrice(item.price)}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {/* Play Now Button */}
          <button className="btn btn-primary btn-sm flex-1" onClick={handlePlayNow}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 mr-1"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            Play Now
          </button>

          {/* View Trailer Button */}
          {item.trailerUrl && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleViewTrailer}
              title="View Trailer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="2" y1="7" x2="7" y2="7" />
                <line x1="2" y1="17" x2="7" y2="17" />
                <line x1="17" y1="17" x2="22" y2="17" />
                <line x1="17" y1="7" x2="22" y2="7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
