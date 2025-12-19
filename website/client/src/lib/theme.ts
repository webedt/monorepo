/**
 * Theme Manager
 * Handles light/dark theme switching with system preference support
 */

export type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'theme';

class ThemeManager {
  private currentTheme: Theme = 'system';
  private mediaQuery: MediaQueryList;
  private listeners: Set<(theme: Theme, resolved: 'light' | 'dark') => void> = new Set();

  constructor() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', () => this.applyTheme());

    // Load saved theme
    this.currentTheme = (localStorage.getItem(THEME_KEY) as Theme) || 'system';
    this.applyTheme();
  }

  /**
   * Get current theme setting
   */
  getTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Get resolved theme (always light or dark)
   */
  getResolvedTheme(): 'light' | 'dark' {
    if (this.currentTheme === 'system') {
      return this.mediaQuery.matches ? 'dark' : 'light';
    }
    return this.currentTheme;
  }

  /**
   * Set theme
   */
  setTheme(theme: Theme): void {
    this.currentTheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    this.applyTheme();
  }

  /**
   * Toggle between light and dark
   */
  toggle(): void {
    const resolved = this.getResolvedTheme();
    this.setTheme(resolved === 'light' ? 'dark' : 'light');
  }

  /**
   * Apply theme to document
   */
  private applyTheme(): void {
    const resolved = this.getResolvedTheme();

    if (this.currentTheme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', resolved);
    }

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content',
        resolved === 'dark' ? '#111827' : '#ffffff'
      );
    }

    // Notify listeners
    for (const listener of this.listeners) {
      listener(this.currentTheme, resolved);
    }
  }

  /**
   * Subscribe to theme changes
   */
  onChange(callback: (theme: Theme, resolved: 'light' | 'dark') => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

// Export singleton instance
export const theme = new ThemeManager();
