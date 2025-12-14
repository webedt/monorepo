// Purchase service for handling store transactions
// Implements SPEC.md Section 3.4 - Pricing & Commerce
// Placeholder for Stripe and PayPal integration

import type {
  PaymentProvider,
  PurchaseRequest,
  PurchaseResult,
  PurchasedItem,
} from '@/types/purchase';
import type { StoreItem } from '@/types/store';

const PURCHASED_ITEMS_KEY = 'purchased-items';

/**
 * Load purchased items from localStorage
 */
function loadPurchasedItems(): PurchasedItem[] {
  try {
    const stored = localStorage.getItem(PURCHASED_ITEMS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load purchased items:', e);
  }
  return [];
}

/**
 * Save purchased items to localStorage
 */
function savePurchasedItems(items: PurchasedItem[]): void {
  try {
    localStorage.setItem(PURCHASED_ITEMS_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Failed to save purchased items:', e);
  }
}

/**
 * Generate a mock transaction ID
 */
function generateTransactionId(): string {
  return `txn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Simulate payment processing delay
 */
function simulatePaymentDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

/**
 * Process a purchase for a store item
 * In production, this would integrate with Stripe or PayPal APIs
 */
export async function processPurchase(
  item: StoreItem,
  request: PurchaseRequest
): Promise<PurchaseResult> {
  try {
    // Simulate payment processing
    await simulatePaymentDelay();

    // Handle free items
    if (item.price === null || item.price === 0) {
      const transactionId = generateTransactionId();

      // Add to purchased items
      const purchasedItems = loadPurchasedItems();
      const purchasedItem: PurchasedItem = {
        id: purchasedItems.length + 1,
        itemId: item.id,
        userId: 1, // Mock user ID
        purchasedAt: new Date().toISOString(),
        price: 0,
        paymentProvider: request.paymentProvider,
        transactionId,
      };
      purchasedItems.push(purchasedItem);
      savePurchasedItems(purchasedItems);

      return {
        success: true,
        status: 'completed',
        transactionId,
        message: 'Item added to your library!',
      };
    }

    // Simulate paid purchase (mock - would integrate with Stripe/PayPal)
    const transactionId = generateTransactionId();

    // In production:
    // - For Stripe: Create a PaymentIntent and redirect to Stripe Checkout
    // - For PayPal: Create an order and redirect to PayPal

    // Add to purchased items
    const purchasedItems = loadPurchasedItems();
    const purchasedItem: PurchasedItem = {
      id: purchasedItems.length + 1,
      itemId: item.id,
      userId: 1, // Mock user ID
      purchasedAt: new Date().toISOString(),
      price: item.price,
      paymentProvider: request.paymentProvider,
      transactionId,
    };
    purchasedItems.push(purchasedItem);
    savePurchasedItems(purchasedItems);

    return {
      success: true,
      status: 'completed',
      transactionId,
      message: 'Purchase completed successfully!',
    };
  } catch (error) {
    console.error('Purchase failed:', error);
    return {
      success: false,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Purchase failed',
    };
  }
}

/**
 * Check if an item has been purchased
 */
export function isItemPurchased(itemId: number): boolean {
  const purchasedItems = loadPurchasedItems();
  return purchasedItems.some((item) => item.itemId === itemId);
}

/**
 * Get all purchased items
 */
export function getPurchasedItems(): PurchasedItem[] {
  return loadPurchasedItems();
}

/**
 * Get purchased item by item ID
 */
export function getPurchasedItem(itemId: number): PurchasedItem | undefined {
  const purchasedItems = loadPurchasedItems();
  return purchasedItems.find((item) => item.itemId === itemId);
}

/**
 * Initialize Stripe checkout session (placeholder)
 * In production, this would call the backend to create a Stripe session
 */
export async function initStripeCheckout(
  item: StoreItem
): Promise<{ sessionId: string; url: string } | null> {
  console.log('[Stripe] Creating checkout session for:', item.title);

  // Placeholder - in production, call backend to create Stripe session
  // const response = await fetch('/api/payments/stripe/checkout', {
  //   method: 'POST',
  //   body: JSON.stringify({ itemId: item.id }),
  // });
  // return response.json();

  return null;
}

/**
 * Initialize PayPal checkout (placeholder)
 * In production, this would call the PayPal SDK
 */
export async function initPayPalCheckout(
  item: StoreItem
): Promise<{ orderId: string } | null> {
  console.log('[PayPal] Creating order for:', item.title);

  // Placeholder - in production, integrate with PayPal SDK
  // paypal.Buttons({...}).render('#paypal-button');

  return null;
}

/**
 * Get payment provider display name and icon
 */
export function getPaymentProviderInfo(provider: PaymentProvider): {
  name: string;
  icon: string;
} {
  switch (provider) {
    case 'stripe':
      return { name: 'Credit Card', icon: 'credit-card' };
    case 'paypal':
      return { name: 'PayPal', icon: 'paypal' };
    default:
      return { name: 'Unknown', icon: 'unknown' };
  }
}
