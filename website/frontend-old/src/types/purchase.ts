// Purchase and payment types for store commerce functionality
// Implements SPEC.md Section 3.4 - Pricing & Commerce

/**
 * Payment provider options
 */
export type PaymentProvider = 'stripe' | 'paypal';

/**
 * Purchase status states
 */
export type PurchaseStatus =
  | 'idle'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'refunded';

/**
 * Purchase result after a transaction attempt
 */
export interface PurchaseResult {
  success: boolean;
  status: PurchaseStatus;
  transactionId?: string;
  error?: string;
  message?: string;
}

/**
 * Purchase request data
 */
export interface PurchaseRequest {
  itemId: number;
  paymentProvider: PaymentProvider;
  quantity?: number;
  couponCode?: string;
}

/**
 * Review for a store item
 */
export interface Review {
  id: number;
  userId: number;
  userName: string;
  userAvatar?: string;
  itemId: number;
  rating: number; // 1-5 stars
  title?: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  helpfulCount: number;
  isVerifiedPurchase: boolean;
}

/**
 * Rating summary for a store item
 */
export interface RatingSummary {
  averageRating: number;
  totalReviews: number;
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

/**
 * New review submission data
 */
export interface ReviewSubmission {
  itemId: number;
  rating: number;
  title?: string;
  content: string;
}

/**
 * Purchased item record for user library
 */
export interface PurchasedItem {
  id: number;
  itemId: number;
  userId: number;
  purchasedAt: string;
  price: number;
  paymentProvider: PaymentProvider;
  transactionId: string;
}

/**
 * Extended store item details for the detail page
 */
export interface StoreItemDetails {
  id: number;
  title: string;
  description: string;
  fullDescription?: string;
  price: number | null;
  originalPrice?: number | null;
  thumbnail: string;
  screenshots?: string[];
  trailerUrl?: string;
  category: string;
  genre: string;
  tags: string[];
  creator: string;
  releaseDate: string;
  rating?: number;
  reviewCount?: number;
  ratingSummary?: RatingSummary;
  isOnSale?: boolean;
  salePercentage?: number;
  isFeatured?: boolean;
  isNew?: boolean;
  requirements?: {
    minimum?: string[];
    recommended?: string[];
  };
  features?: string[];
  languages?: string[];
  fileSize?: string;
  version?: string;
  lastUpdated?: string;
}
