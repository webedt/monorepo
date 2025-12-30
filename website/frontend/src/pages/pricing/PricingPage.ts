/**
 * Pricing Page
 * Display pricing tiers and plan comparison
 */

import { Page } from '../base/Page';
import { Card, Button, toast } from '../../components';
import { billingApi } from '../../lib/api';
import type { PricingTier as ApiPricingTier } from '../../lib/api';
import { authStore } from '../../stores/authStore';
import { router } from '../../lib/router';
import './pricing.css';

// UI-specific tier metadata (not duplicating backend data)
const TIER_UI_CONFIG: Record<string, { highlighted?: boolean; cta: string }> = {
  FREE: { cta: 'Get Started' },
  BASIC: { highlighted: true, cta: 'Upgrade Now' },
  PRO: { cta: 'Go Pro' },
  ENTERPRISE: { cta: 'Contact Sales' },
};

interface DisplayTier extends ApiPricingTier {
  highlighted?: boolean;
  cta: string;
}

export class PricingPage extends Page {
  readonly route = '/pricing';
  readonly title = 'Pricing';
  protected requiresAuth = false;

  private cards: Card[] = [];
  private buttons: Button[] = [];
  private currentTier: string | null = null;
  private tiers: DisplayTier[] = [];
  private loading = true;

  protected render(): string {
    return `
      <div class="pricing-page">
        <header class="pricing-header">
          <h1 class="pricing-title">Choose Your Plan</h1>
          <p class="pricing-subtitle">Scale your workflow with the right plan for you</p>
        </header>

        <div class="pricing-grid" id="pricing-grid">
          ${this.loading ? `
            <div class="pricing-loading">
              <div class="spinner"></div>
              <p>Loading plans...</p>
            </div>
          ` : ''}
        </div>

        <section class="pricing-faq">
          <h2>Frequently Asked Questions</h2>
          <div class="faq-grid">
            <div class="faq-item">
              <h3>Can I change plans anytime?</h3>
              <p>Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.</p>
            </div>
            <div class="faq-item">
              <h3>What happens to my data if I downgrade?</h3>
              <p>Your data is preserved, but you won't be able to add more data until you're within your new quota.</p>
            </div>
            <div class="faq-item">
              <h3>Do you offer refunds?</h3>
              <p>We offer a 14-day money-back guarantee on all paid plans.</p>
            </div>
            <div class="faq-item">
              <h3>Is there a free trial?</h3>
              <p>Yes! Start with our Free tier and upgrade when you're ready.</p>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  async load(): Promise<void> {
    try {
      // Fetch tiers from backend API (single source of truth)
      const tiersData = await billingApi.getTiers();
      this.tiers = (tiersData?.tiers || []).map(tier => ({
        ...tier,
        ...TIER_UI_CONFIG[tier.id] || { cta: 'Select' },
      }));

      // Check if user is authenticated and get their current tier
      if (authStore.isAuthenticated()) {
        try {
          const billing = await billingApi.getCurrentPlan();
          this.currentTier = billing?.tier || 'BASIC';
        } catch {
          this.currentTier = 'BASIC';
        }
      }
    } catch (error) {
      console.error('Failed to load pricing data:', error);
      this.tiers = [];
    } finally {
      this.loading = false;
      this.update({});
    }
  }

  protected onMount(): void {
    super.onMount();
    this.renderPricingCards();
  }

  private renderPricingCards(): void {
    const grid = this.$('#pricing-grid') as HTMLElement;
    if (!grid) return;

    grid.innerHTML = '';

    if (this.tiers.length === 0 && !this.loading) {
      grid.innerHTML = '<p class="pricing-error">Failed to load pricing plans. Please try again later.</p>';
      return;
    }

    for (const tier of this.tiers) {
      const tierCard = this.createTierCard(tier);
      grid.appendChild(tierCard);
    }
  }

  private createTierCard(tier: DisplayTier): HTMLElement {
    const isCurrentPlan = this.currentTier === tier.id;
    const isAuthenticated = authStore.isAuthenticated();

    const container = document.createElement('div');
    container.className = `pricing-card ${tier.highlighted ? 'highlighted' : ''} ${isCurrentPlan ? 'current' : ''}`;

    if (tier.highlighted) {
      const badge = document.createElement('div');
      badge.className = 'pricing-badge';
      badge.textContent = 'Most Popular';
      container.appendChild(badge);
    }

    if (isCurrentPlan) {
      const currentBadge = document.createElement('div');
      currentBadge.className = 'current-badge';
      currentBadge.textContent = 'Current Plan';
      container.appendChild(currentBadge);
    }

    const header = document.createElement('div');
    header.className = 'pricing-card-header';
    header.innerHTML = `
      <h3 class="tier-name">${tier.name}</h3>
      <div class="tier-price">${tier.priceLabel}</div>
      <div class="tier-storage">${tier.formatted} storage</div>
    `;
    container.appendChild(header);

    const features = document.createElement('ul');
    features.className = 'tier-features';
    for (const feature of tier.features) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="feature-check">✓</span> ${feature}`;
      features.appendChild(li);
    }
    container.appendChild(features);

    const actions = document.createElement('div');
    actions.className = 'pricing-card-actions';

    let buttonText = tier.cta;
    let buttonVariant: 'primary' | 'secondary' | 'ghost' = tier.highlighted ? 'primary' : 'secondary';
    let buttonDisabled = false;

    if (isCurrentPlan) {
      buttonText = 'Current Plan';
      buttonVariant = 'ghost';
      buttonDisabled = true;
    } else if (!isAuthenticated) {
      buttonText = 'Sign Up';
    }

    const btn = new Button(buttonText, {
      variant: buttonVariant,
      disabled: buttonDisabled,
      onClick: () => this.handleSelectPlan(tier),
    });

    btn.mount(actions);
    this.buttons.push(btn);
    container.appendChild(actions);

    return container;
  }

  private async handleSelectPlan(tier: DisplayTier): Promise<void> {
    if (!authStore.isAuthenticated()) {
      // Redirect to login with return URL
      router.navigate(`/login?return=/pricing`);
      return;
    }

    if (tier.id === this.currentTier) {
      return;
    }

    // For enterprise, show contact message
    if (tier.id === 'ENTERPRISE') {
      toast.info('Contact sales@webedt.com for Enterprise plans');
      return;
    }

    // For free tier downgrade, show confirmation
    if (tier.id === 'FREE' && this.currentTier !== 'FREE') {
      toast.warning('Downgrading will reduce your storage quota. Please ensure your data fits within 1 GB.');
      // Proceed with the change - the backend will validate
    }

    try {
      await billingApi.changePlan(tier.id);
      this.currentTier = tier.id;
      toast.success(`Successfully changed to ${tier.name} plan`);
      this.update({});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to change plan';
      toast.error(message);
    }
  }

  protected onUnmount(): void {
    for (const card of this.cards) {
      card.unmount();
    }
    for (const btn of this.buttons) {
      btn.unmount();
    }
    this.cards = [];
    this.buttons = [];
  }
}
