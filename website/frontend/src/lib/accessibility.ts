/**
 * Accessibility utilities for screen reader announcements
 * Provides aria-live regions for announcing status changes
 */

export type AnnouncementPoliteness = 'polite' | 'assertive';

/**
 * StatusAnnouncer provides a way to announce status changes to screen readers
 * using aria-live regions.
 *
 * Usage:
 *   import { statusAnnouncer } from './lib/accessibility';
 *   statusAnnouncer.announce('File saved successfully');
 *   statusAnnouncer.announce('Error: Connection failed', 'assertive');
 */
class StatusAnnouncer {
  private politeRegion: HTMLDivElement | null = null;
  private assertiveRegion: HTMLDivElement | null = null;
  private initialized = false;

  /**
   * Initialize the announcer by creating aria-live regions in the DOM
   * This is called automatically on first announce
   */
  private init(): void {
    if (this.initialized) return;

    // Create polite region for non-urgent announcements
    this.politeRegion = this.createRegion('polite');
    document.body.appendChild(this.politeRegion);

    // Create assertive region for urgent announcements
    this.assertiveRegion = this.createRegion('assertive');
    document.body.appendChild(this.assertiveRegion);

    this.initialized = true;
  }

  /**
   * Create an aria-live region element
   */
  private createRegion(politeness: AnnouncementPoliteness): HTMLDivElement {
    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', politeness);
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only';

    // Visually hidden but accessible to screen readers
    Object.assign(region.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    });

    return region;
  }

  /**
   * Announce a message to screen readers
   *
   * @param message - The message to announce
   * @param politeness - 'polite' (default) for non-urgent, 'assertive' for urgent
   */
  announce(message: string, politeness: AnnouncementPoliteness = 'polite'): void {
    this.init();

    const region = politeness === 'assertive' ? this.assertiveRegion : this.politeRegion;
    if (!region) return;

    // Clear the region first to ensure the announcement is made even if
    // the same message is announced twice in a row
    region.textContent = '';

    // Use requestAnimationFrame to ensure the DOM update is processed
    requestAnimationFrame(() => {
      region.textContent = message;
    });
  }

  /**
   * Clear all pending announcements
   */
  clear(): void {
    if (this.politeRegion) {
      this.politeRegion.textContent = '';
    }
    if (this.assertiveRegion) {
      this.assertiveRegion.textContent = '';
    }
  }

  /**
   * Remove the announcer from the DOM (useful for cleanup)
   */
  destroy(): void {
    if (this.politeRegion) {
      this.politeRegion.remove();
      this.politeRegion = null;
    }
    if (this.assertiveRegion) {
      this.assertiveRegion.remove();
      this.assertiveRegion = null;
    }
    this.initialized = false;
  }
}

// Export singleton instance
export const statusAnnouncer = new StatusAnnouncer();

// Also export the class for testing or custom instances
export { StatusAnnouncer };
