/**
 * Theme Manager
 * Handles multiple theme switching with system preference support
 */

export const THEMES = [
  'system',
  'light',
  'dark',
  'synthwave',
  'cyberpunk',
  'dracula',
  'nord',
  'coffee',
  'forest',
  'sunset',
  'cupcake',
  'emerald',
] as const;

export type Theme = typeof THEMES[number];

export const THEME_META: Record<Theme, { emoji: string; label: string }> = {
  system: { emoji: '💻', label: 'System' },
  light: { emoji: '☀️', label: 'Light' },
  dark: { emoji: '🌙', label: 'Dark' },
  synthwave: { emoji: '🌃', label: 'Synthwave' },
  cyberpunk: { emoji: '🤖', label: 'Cyberpunk' },
  dracula: { emoji: '🧛', label: 'Dracula' },
  nord: { emoji: '🏔️', label: 'Nord' },
  coffee: { emoji: '☕', label: 'Coffee' },
  forest: { emoji: '🌲', label: 'Forest' },
  sunset: { emoji: '🌅', label: 'Sunset' },
  cupcake: { emoji: '🧁', label: 'Cupcake' },
  emerald: { emoji: '💎', label: 'Emerald' },
};

const THEME_KEY = 'webedt:theme';

class ThemeManager {
  private currentTheme: Theme = 'system';
  private mediaQuery: MediaQueryList;
  private listeners: Set<(theme: Theme, resolved: string) => void> = new Set();

  constructor() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', () => this.applyTheme());

    // Load saved theme
    const saved = localStorage.getItem(THEME_KEY);
    this.currentTheme = (saved && THEMES.includes(saved as Theme)) ? saved as Theme : 'system';
    this.applyTheme();
  }

  /**
   * Get current theme setting
   */
  getTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Get resolved theme (actual theme name, not 'system')
   */
  getResolvedTheme(): string {
    if (this.currentTheme === 'system') {
      return this.mediaQuery.matches ? 'dark' : 'light';
    }
    return this.currentTheme;
  }

  /**
   * Get all available themes
   */
  getThemes(): readonly Theme[] {
    return THEMES;
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
   * Toggle between light and dark (or cycle through if on a custom theme)
   */
  toggle(): void {
    const resolved = this.getResolvedTheme();
    if (resolved === 'light' || resolved === 'dark') {
      this.setTheme(resolved === 'light' ? 'dark' : 'light');
    } else {
      // If on a custom theme, toggle to the opposite base
      this.setTheme('light');
    }
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
      const isDark = ['dark', 'synthwave', 'cyberpunk', 'dracula', 'nord', 'coffee', 'forest', 'sunset'].includes(resolved);
      metaThemeColor.setAttribute(
        'content',
        isDark ? '#111827' : '#ffffff'
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
  onChange(callback: (theme: Theme, resolved: string) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

// Export singleton instance
export const theme = new ThemeManager();
