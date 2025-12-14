import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWishlist } from '@/hooks/useWishlist';
import { mockStoreItems } from '@/data/mockStoreData';
import PurchaseButton, { PriceDisplay } from '@/components/store/PurchaseButton';
import WishlistButton from '@/components/store/WishlistButton';
import TrailerPlayer from '@/components/store/TrailerPlayer';
import RatingReviews from '@/components/RatingReviews';
import { processPurchase, isItemPurchased } from '@/services/purchase';
import type { StoreItem } from '@/types/store';
import type { Review, RatingSummary, ReviewSubmission, PurchaseStatus } from '@/types/purchase';

// Mock reviews data for demonstration
const generateMockReviews = (itemId: number): Review[] => {
  const reviewData = [
    {
      userName: 'GamePlayer2025',
      rating: 5,
      title: 'Absolutely amazing!',
      content: 'This is exactly what I was looking for. The graphics are stunning and the gameplay is incredibly smooth. Highly recommend to anyone looking for a great gaming experience.',
      helpfulCount: 45,
    },
    {
      userName: 'IndieGamer',
      rating: 4,
      title: 'Great value for the price',
      content: 'Really enjoyed playing this. A few minor bugs here and there, but overall a solid experience. The developers seem very responsive to feedback.',
      helpfulCount: 23,
    },
    {
      userName: 'CasualUser',
      rating: 4,
      title: 'Good for casual gaming',
      content: 'Perfect for when you want to relax and have some fun. Not too complicated, just the right level of challenge.',
      helpfulCount: 12,
    },
    {
      userName: 'ProReviewer',
      rating: 5,
      title: 'Top tier quality',
      content: 'Having played hundreds of games, I can confidently say this is among the best. The attention to detail is remarkable. The soundtrack alone is worth the price!',
      helpfulCount: 67,
    },
    {
      userName: 'NewPlayer',
      rating: 3,
      title: 'Decent but needs work',
      content: 'The core gameplay is fun, but there are some features that feel incomplete. Looking forward to future updates that might address these issues.',
      helpfulCount: 8,
    },
  ];

  return reviewData.map((review, index) => ({
    id: itemId * 100 + index,
    userId: index + 1,
    userName: review.userName,
    itemId,
    rating: review.rating,
    title: review.title,
    content: review.content,
    createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    helpfulCount: review.helpfulCount,
    isVerifiedPurchase: Math.random() > 0.3,
  }));
};

// Generate mock rating summary based on item rating
const generateRatingSummary = (rating: number = 4, reviewCount: number = 100): RatingSummary => {
  const avgRating = rating;
  const total = reviewCount;

  // Distribute reviews based on average rating
  const distribution = {
    5: Math.round(total * (avgRating >= 4.5 ? 0.6 : avgRating >= 4 ? 0.4 : 0.2)),
    4: Math.round(total * (avgRating >= 4 ? 0.25 : 0.3)),
    3: Math.round(total * 0.1),
    2: Math.round(total * 0.03),
    1: Math.round(total * 0.02),
  };

  // Adjust to match total
  const currentTotal = Object.values(distribution).reduce((a, b) => a + b, 0);
  distribution[5] += total - currentTotal;

  return {
    averageRating: avgRating,
    totalReviews: total,
    distribution,
  };
};

/**
 * StoreItemDetail page component.
 * Displays comprehensive information about a store item including:
 * - Screenshots/trailer
 * - Description and features
 * - Purchase/wishlist functionality
 * - Ratings and reviews
 *
 * Implements SPEC.md Sections 3.4 (Commerce), 3.5 (Wishlist), 3.6 (Ratings & Reviews)
 */
export default function StoreItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isWishlisted, toggleWishlist, addToWishlist, removeFromWishlist } = useWishlist();

  // Find the item from mock data
  const item = useMemo(() => {
    return mockStoreItems.find((i) => i.id === Number(id));
  }, [id]);

  // State for purchase flow
  const [purchaseStatus, setPurchaseStatus] = useState<PurchaseStatus>('idle');
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null);
  const [isPurchased, setIsPurchased] = useState(() => item ? isItemPurchased(item.id) : false);

  // Selected media tab (screenshots/trailer)
  const [activeMedia, setActiveMedia] = useState<'trailer' | 'screenshot'>('trailer');
  const [selectedScreenshot, setSelectedScreenshot] = useState(0);

  // Generate mock data for reviews
  const reviews = useMemo(() => item ? generateMockReviews(item.id) : [], [item]);
  const ratingSummary = useMemo(
    () => item ? generateRatingSummary(item.rating, item.reviewCount) : generateRatingSummary(),
    [item]
  );

  // Handle wishlist toggle
  const handleToggleWishlist = useCallback(
    (storeItem: StoreItem) => {
      toggleWishlist(storeItem.id);
    },
    [toggleWishlist]
  );

  // Handle purchase
  const handlePurchase = useCallback(
    async (storeItem: StoreItem) => {
      setPurchaseStatus('processing');
      setPurchaseMessage(null);

      const result = await processPurchase(storeItem, {
        itemId: storeItem.id,
        paymentProvider: 'stripe',
      });

      if (result.success) {
        setPurchaseStatus('completed');
        setPurchaseMessage(result.message || 'Purchase completed!');
        setIsPurchased(true);
      } else {
        setPurchaseStatus('failed');
        setPurchaseMessage(result.error || 'Purchase failed. Please try again.');
      }
    },
    []
  );

  // Handle play now (for owned items)
  const handlePlayNow = useCallback(
    (storeItem: StoreItem) => {
      // Navigate to play/library
      navigate(`/library/${storeItem.id}`);
    },
    [navigate]
  );

  // Handle review submission
  const handleSubmitReview = useCallback(async (review: ReviewSubmission) => {
    // Mock submission - in production this would call an API
    console.log('Submitting review:', review);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, []);

  // Handle marking review as helpful
  const handleMarkHelpful = useCallback((reviewId: number) => {
    console.log('Marking review as helpful:', reviewId);
  }, []);

  // Mock screenshots (using thumbnail variations for demo)
  const screenshots = useMemo(() => {
    if (!item) return [];
    return [
      item.thumbnail,
      item.thumbnail.replace('w=400', 'w=800'),
      item.thumbnail.replace('h=300', 'h=600'),
    ];
  }, [item]);

  // Item not found
  if (!item) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">
            <svg
              className="w-24 h-24 mx-auto text-base-content/30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-base-content mb-4">Item Not Found</h1>
          <p className="text-base-content/70 mb-6">
            The item you're looking for doesn't exist or has been removed.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/store')}>
            Back to Store
          </button>
        </div>
      </div>
    );
  }

  const isFree = item.price === null || item.price === 0;
  const wishlisted = isWishlisted(item.id);

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <button className="btn btn-ghost mb-6" onClick={() => navigate('/store')}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 mr-2"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Store
        </button>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Media */}
          <div className="lg:col-span-2 space-y-4">
            {/* Main Media Display */}
            <div className="bg-base-100 rounded-xl overflow-hidden shadow-lg">
              <div className="aspect-video bg-black relative">
                {item.trailerUrl && activeMedia === 'trailer' ? (
                  <TrailerPlayer
                    src={item.trailerUrl}
                    poster={item.thumbnail}
                    autoPlay={false}
                    muted={false}
                    controls
                    className="w-full h-full"
                  />
                ) : (
                  <img
                    src={screenshots[selectedScreenshot] || item.thumbnail}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                )}

                {/* Badges */}
                <div className="absolute top-4 left-4 flex flex-col gap-2">
                  {item.isNew && <span className="badge badge-secondary font-bold">NEW</span>}
                  {item.isOnSale && item.salePercentage && (
                    <span className="badge badge-error font-bold">-{item.salePercentage}% OFF</span>
                  )}
                  {item.isFeatured && (
                    <span className="badge badge-primary font-bold">FEATURED</span>
                  )}
                </div>
              </div>

              {/* Media Thumbnails */}
              <div className="p-4 bg-base-200 flex gap-2 overflow-x-auto">
                {item.trailerUrl && (
                  <button
                    className={`relative rounded-lg overflow-hidden flex-shrink-0 border-2 transition-colors ${
                      activeMedia === 'trailer' ? 'border-primary' : 'border-transparent'
                    }`}
                    onClick={() => setActiveMedia('trailer')}
                  >
                    <img
                      src={item.thumbnail}
                      alt="Trailer"
                      className="w-24 h-16 object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-8 w-8 text-white"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </button>
                )}
                {screenshots.map((screenshot, index) => (
                  <button
                    key={index}
                    className={`rounded-lg overflow-hidden flex-shrink-0 border-2 transition-colors ${
                      activeMedia === 'screenshot' && selectedScreenshot === index
                        ? 'border-primary'
                        : 'border-transparent'
                    }`}
                    onClick={() => {
                      setActiveMedia('screenshot');
                      setSelectedScreenshot(index);
                    }}
                  >
                    <img
                      src={screenshot}
                      alt={`Screenshot ${index + 1}`}
                      className="w-24 h-16 object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="bg-base-100 rounded-xl p-6 shadow-lg">
              <h2 className="text-2xl font-bold mb-4">About This Game</h2>
              <p className="text-base-content/80 leading-relaxed mb-6">{item.description}</p>

              {/* Features */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3">Features</h3>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <li className="flex items-center gap-2">
                    <svg
                      className="h-5 w-5 text-success"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Full feature access
                  </li>
                  <li className="flex items-center gap-2">
                    <svg
                      className="h-5 w-5 text-success"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Regular updates and support
                  </li>
                  <li className="flex items-center gap-2">
                    <svg
                      className="h-5 w-5 text-success"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Cloud synchronization
                  </li>
                  <li className="flex items-center gap-2">
                    <svg
                      className="h-5 w-5 text-success"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Priority customer service
                  </li>
                </ul>
              </div>

              {/* Tags */}
              {item.tags && item.tags.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {item.tags.map((tag) => (
                      <span key={tag} className="badge badge-outline">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Reviews Section */}
            <div className="bg-base-100 rounded-xl p-6 shadow-lg">
              <h2 className="text-2xl font-bold mb-6">Ratings & Reviews</h2>
              <RatingReviews
                itemId={item.id}
                ratingSummary={ratingSummary}
                reviews={reviews}
                onSubmitReview={handleSubmitReview}
                onMarkHelpful={handleMarkHelpful}
                canReview={isPurchased}
              />
            </div>
          </div>

          {/* Right Column - Purchase Info */}
          <div className="space-y-4">
            {/* Purchase Card */}
            <div className="bg-base-100 rounded-xl p-6 shadow-lg sticky top-4">
              <h1 className="text-2xl font-bold text-base-content mb-2">{item.title}</h1>

              <div className="flex items-center gap-3 text-base-content/70 mb-4">
                <span className="font-medium">{item.creator}</span>
              </div>

              {/* Rating */}
              {item.rating !== undefined && (
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg
                        key={star}
                        xmlns="http://www.w3.org/2000/svg"
                        className={`h-5 w-5 ${
                          star <= Math.round(item.rating!)
                            ? 'text-warning fill-warning'
                            : 'text-base-content/20'
                        }`}
                        viewBox="0 0 24 24"
                        fill={star <= Math.round(item.rating!) ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    ))}
                  </div>
                  <span className="font-medium">{item.rating.toFixed(1)}</span>
                  {item.reviewCount && (
                    <span className="text-base-content/60">
                      ({item.reviewCount.toLocaleString()} reviews)
                    </span>
                  )}
                </div>
              )}

              {/* Price Display */}
              <div className="mb-6">
                <PriceDisplay
                  price={item.price}
                  originalPrice={item.originalPrice}
                  isOnSale={item.isOnSale}
                  salePercentage={item.salePercentage}
                  size="lg"
                />
              </div>

              {/* Purchase Status Message */}
              {purchaseMessage && (
                <div
                  className={`alert mb-4 ${
                    purchaseStatus === 'completed' ? 'alert-success' : 'alert-error'
                  }`}
                >
                  <span>{purchaseMessage}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3">
                {isPurchased ? (
                  <button
                    className="btn btn-primary btn-block btn-lg"
                    onClick={() => handlePlayNow(item)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Play Now
                  </button>
                ) : (
                  <PurchaseButton
                    item={item}
                    variant="primary"
                    size="lg"
                    className="w-full"
                    onPurchase={handlePurchase}
                    onPlayNow={handlePlayNow}
                  />
                )}

                <WishlistButton
                  item={item}
                  isWishlisted={wishlisted}
                  variant="outline"
                  size="md"
                  showLabel
                  className="w-full"
                  onToggle={handleToggleWishlist}
                />
              </div>

              {/* Divider */}
              <div className="divider"></div>

              {/* Item Details */}
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/60">Category</span>
                  <span className="capitalize font-medium">{item.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Genre</span>
                  <span className="capitalize font-medium">{item.genre}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Release Date</span>
                  <span className="font-medium">
                    {new Date(item.releaseDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Developer</span>
                  <span className="font-medium">{item.creator}</span>
                </div>
              </div>
            </div>

            {/* Requirements Card */}
            <div className="bg-base-100 rounded-xl p-6 shadow-lg">
              <h3 className="text-lg font-semibold mb-4">Requirements</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 text-base-content/40"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  Modern web browser
                </li>
                <li className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 text-base-content/40"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                    />
                  </svg>
                  Stable internet connection
                </li>
                <li className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 text-base-content/40"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  Active account
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
