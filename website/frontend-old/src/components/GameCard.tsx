import { useNavigate } from 'react-router-dom';

export interface GameItem {
  id: number;
  title: string;
  description: string;
  price: number | null; // null means free
  thumbnail: string;
  trailerUrl?: string;
  isWishlisted?: boolean;
}

interface GameCardProps {
  game: GameItem;
  onPlayNow?: (game: GameItem) => void;
  onViewTrailer?: (game: GameItem) => void;
  onToggleWishlist?: (game: GameItem) => void;
}

export default function GameCard({ game, onPlayNow, onViewTrailer, onToggleWishlist }: GameCardProps) {
  const navigate = useNavigate();

  const handlePlayNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPlayNow) {
      onPlayNow(game);
    } else {
      console.log('Play Now:', game.title);
    }
  };

  const handleViewTrailer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onViewTrailer) {
      onViewTrailer(game);
    } else {
      console.log('View Trailer:', game.title);
    }
  };

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleWishlist) {
      onToggleWishlist(game);
    } else {
      console.log('Toggle Wishlist:', game.title);
    }
  };

  const formatPrice = (price: number | null): string => {
    if (price === null || price === 0) {
      return 'Free';
    }
    return `$${price.toFixed(2)}`;
  };

  const isFree = game.price === null || game.price === 0;

  return (
    <div className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow">
      {/* Thumbnail - Clickable to Open Details */}
      <figure
        className="relative h-48 overflow-hidden cursor-pointer group"
        onClick={() => navigate(`/item/${game.id}`)}
      >
        <img
          src={game.thumbnail}
          alt={game.title}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
        />
        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <div className="text-white transform scale-90 group-hover:scale-100 transition-transform duration-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-16 w-16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </div>
        </div>
      </figure>

      <div className="card-body p-4">
        {/* Title */}
        <h2 className="card-title text-lg">{game.title}</h2>

        {/* Description */}
        <p className="text-sm text-base-content/70 line-clamp-2 mb-2">
          {game.description}
        </p>

        {/* Price Badge */}
        <div className="flex items-center justify-between mb-3">
          {isFree ? (
            <span className="badge badge-success badge-lg font-bold">Free</span>
          ) : (
            <span className="text-xl font-bold text-primary">{formatPrice(game.price)}</span>
          )}

          {/* Wishlist Button */}
          <button
            className={`btn btn-ghost btn-sm btn-circle ${game.isWishlisted ? 'text-error' : ''}`}
            onClick={handleToggleWishlist}
            title={game.isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill={game.isWishlisted ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {/* Play Now Button */}
          <button
            className="btn btn-primary btn-sm flex-1"
            onClick={handlePlayNow}
          >
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
          {game.trailerUrl && (
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
