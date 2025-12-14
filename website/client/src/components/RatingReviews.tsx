import { useState, useCallback, useMemo } from 'react';
import type { Review, RatingSummary, ReviewSubmission } from '@/types/purchase';

export interface RatingReviewsProps {
  itemId: number;
  ratingSummary: RatingSummary;
  reviews: Review[];
  onSubmitReview?: (review: ReviewSubmission) => Promise<void>;
  onMarkHelpful?: (reviewId: number) => void;
  canReview?: boolean;
  className?: string;
}

/**
 * Star Rating Display Component
 */
function StarRating({
  rating,
  size = 'md',
  interactive = false,
  onRatingChange,
}: {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
  onRatingChange?: (rating: number) => void;
}) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const getSizeClass = () => {
    switch (size) {
      case 'sm':
        return 'h-4 w-4';
      case 'lg':
        return 'h-8 w-8';
      default:
        return 'h-5 w-5';
    }
  };

  const displayRating = hoverRating ?? rating;

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`${interactive ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}`}
          onClick={() => interactive && onRatingChange?.(star)}
          onMouseEnter={() => interactive && setHoverRating(star)}
          onMouseLeave={() => interactive && setHoverRating(null)}
          disabled={!interactive}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`${getSizeClass()} ${
              star <= displayRating ? 'text-warning fill-warning' : 'text-base-content/20'
            }`}
            viewBox="0 0 24 24"
            fill={star <= displayRating ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}

/**
 * Rating Distribution Bar
 */
function RatingBar({ stars, count, total }: { stars: number; count: number; total: number }) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-12 text-right text-base-content/70">{stars} star</span>
      <div className="flex-1 h-2 bg-base-300 rounded-full overflow-hidden">
        <div
          className="h-full bg-warning transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-8 text-base-content/60">{count}</span>
    </div>
  );
}

/**
 * Single Review Card
 */
function ReviewCard({
  review,
  onMarkHelpful,
}: {
  review: Review;
  onMarkHelpful?: (reviewId: number) => void;
}) {
  const formattedDate = new Date(review.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="border-b border-base-300 py-4 last:border-0">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="avatar placeholder">
          <div className="bg-base-300 text-base-content rounded-full w-10">
            {review.userAvatar ? (
              <img src={review.userAvatar} alt={review.userName} />
            ) : (
              <span className="text-lg">{review.userName.charAt(0).toUpperCase()}</span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-base-content">{review.userName}</span>
            {review.isVerifiedPurchase && (
              <span className="badge badge-success badge-sm">Verified Purchase</span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1">
            <StarRating rating={review.rating} size="sm" />
            {review.title && <span className="font-medium">{review.title}</span>}
          </div>

          <p className="text-sm text-base-content/70 mt-1">Reviewed on {formattedDate}</p>

          <p className="mt-3 text-base-content/90 whitespace-pre-wrap">{review.content}</p>

          {/* Helpful button */}
          <div className="mt-3 flex items-center gap-4">
            <button
              className="btn btn-ghost btn-xs gap-1"
              onClick={() => onMarkHelpful?.(review.id)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                />
              </svg>
              Helpful ({review.helpfulCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Review Form Component
 */
function ReviewForm({
  itemId,
  onSubmit,
  onCancel,
}: {
  itemId: number;
  onSubmit: (review: ReviewSubmission) => Promise<void>;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (rating === 0) {
      setError('Please select a rating');
      return;
    }

    if (content.trim().length < 10) {
      setError('Review must be at least 10 characters');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit({
        itemId,
        rating,
        title: title.trim() || undefined,
        content: content.trim(),
      });
      // Reset form on success
      setRating(0);
      setTitle('');
      setContent('');
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-base-200 rounded-lg p-4 mb-6">
      <h4 className="text-lg font-semibold mb-4">Write a Review</h4>

      {error && (
        <div className="alert alert-error mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Rating */}
      <div className="mb-4">
        <label className="label">
          <span className="label-text font-medium">Your Rating</span>
        </label>
        <StarRating rating={rating} size="lg" interactive onRatingChange={setRating} />
      </div>

      {/* Title */}
      <div className="mb-4">
        <label className="label">
          <span className="label-text font-medium">Review Title (optional)</span>
        </label>
        <input
          type="text"
          className="input input-bordered w-full"
          placeholder="Summarize your experience"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
        />
      </div>

      {/* Content */}
      <div className="mb-4">
        <label className="label">
          <span className="label-text font-medium">Your Review</span>
        </label>
        <textarea
          className="textarea textarea-bordered w-full h-32"
          placeholder="Share your thoughts about this item..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={2000}
        />
        <label className="label">
          <span className="label-text-alt">{content.length}/2000</span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <span className="loading loading-spinner loading-sm" />
              Submitting...
            </>
          ) : (
            'Submit Review'
          )}
        </button>
      </div>
    </form>
  );
}

/**
 * RatingReviews component for displaying and managing ratings and reviews.
 * Implements SPEC.md Section 3.6 - Ratings & Reviews
 */
export default function RatingReviews({
  itemId,
  ratingSummary,
  reviews,
  onSubmitReview,
  onMarkHelpful,
  canReview = true,
  className = '',
}: RatingReviewsProps) {
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'helpful' | 'rating'>('recent');

  // Sort reviews based on selected option
  const sortedReviews = useMemo(() => {
    const sorted = [...reviews];
    switch (sortBy) {
      case 'helpful':
        return sorted.sort((a, b) => b.helpfulCount - a.helpfulCount);
      case 'rating':
        return sorted.sort((a, b) => b.rating - a.rating);
      case 'recent':
      default:
        return sorted.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }
  }, [reviews, sortBy]);

  const handleSubmitReview = useCallback(
    async (review: ReviewSubmission) => {
      if (onSubmitReview) {
        await onSubmitReview(review);
      } else {
        // Mock submission
        console.log('Review submitted:', review);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    },
    [onSubmitReview]
  );

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Summary Section */}
      <div className="flex flex-col md:flex-row gap-8">
        {/* Overall Rating */}
        <div className="flex flex-col items-center justify-center p-6 bg-base-200 rounded-lg min-w-[200px]">
          <div className="text-5xl font-bold text-base-content mb-2">
            {ratingSummary.averageRating.toFixed(1)}
          </div>
          <StarRating rating={ratingSummary.averageRating} size="md" />
          <div className="text-sm text-base-content/60 mt-2">
            {ratingSummary.totalReviews.toLocaleString()} reviews
          </div>
        </div>

        {/* Rating Distribution */}
        <div className="flex-1 space-y-2">
          <h4 className="text-sm font-medium text-base-content/70 mb-3">Rating Distribution</h4>
          <RatingBar stars={5} count={ratingSummary.distribution[5]} total={ratingSummary.totalReviews} />
          <RatingBar stars={4} count={ratingSummary.distribution[4]} total={ratingSummary.totalReviews} />
          <RatingBar stars={3} count={ratingSummary.distribution[3]} total={ratingSummary.totalReviews} />
          <RatingBar stars={2} count={ratingSummary.distribution[2]} total={ratingSummary.totalReviews} />
          <RatingBar stars={1} count={ratingSummary.distribution[1]} total={ratingSummary.totalReviews} />
        </div>
      </div>

      {/* Write Review Button */}
      {canReview && !showReviewForm && (
        <button className="btn btn-primary" onClick={() => setShowReviewForm(true)}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          Write a Review
        </button>
      )}

      {/* Review Form */}
      {showReviewForm && (
        <ReviewForm
          itemId={itemId}
          onSubmit={handleSubmitReview}
          onCancel={() => setShowReviewForm(false)}
        />
      )}

      {/* Reviews Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Customer Reviews</h3>

          {/* Sort Dropdown */}
          <select
            className="select select-bordered select-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'helpful' | 'rating')}
          >
            <option value="recent">Most Recent</option>
            <option value="helpful">Most Helpful</option>
            <option value="rating">Highest Rated</option>
          </select>
        </div>

        {/* Reviews List */}
        {sortedReviews.length === 0 ? (
          <div className="text-center py-8 text-base-content/60">
            <svg
              className="w-16 h-16 mx-auto mb-4 opacity-30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p>No reviews yet. Be the first to review!</p>
          </div>
        ) : (
          <div className="divide-y divide-base-300">
            {sortedReviews.map((review) => (
              <ReviewCard key={review.id} review={review} onMarkHelpful={onMarkHelpful} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact rating display for use in cards and lists
 */
export function CompactRating({
  rating,
  reviewCount,
  size = 'md',
  showCount = true,
  className = '',
}: {
  rating: number | undefined;
  reviewCount?: number;
  size?: 'sm' | 'md';
  showCount?: boolean;
  className?: string;
}) {
  if (rating === undefined) return null;

  const sizeClass = size === 'sm' ? 'text-sm' : 'text-base';
  const starSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  return (
    <div className={`flex items-center gap-1 ${sizeClass} ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`${starSize} text-warning fill-warning`}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
      <span className="font-medium">{rating.toFixed(1)}</span>
      {showCount && reviewCount !== undefined && (
        <span className="text-base-content/60">({reviewCount.toLocaleString()})</span>
      )}
    </div>
  );
}
