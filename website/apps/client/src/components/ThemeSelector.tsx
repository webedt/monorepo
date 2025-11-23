import { useEffect, useState } from 'react';

const THEMES = [
  'light',
  'dark',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'synthwave',
  'retro',
  'cyberpunk',
  'valentine',
  'halloween',
  'garden',
  'forest',
  'aqua',
  'lofi',
  'pastel',
  'fantasy',
  'wireframe',
  'black',
  'luxury',
  'dracula',
  'cmyk',
  'autumn',
  'business',
  'acid',
  'lemonade',
  'night',
  'coffee',
  'winter',
  'dim',
  'nord',
  'sunset',
] as const;

type Theme = typeof THEMES[number];

const THEME_EMOJIS: Record<Theme, string> = {
  light: '☀️',
  dark: '🌙',
  cupcake: '🧁',
  bumblebee: '🐝',
  emerald: '💎',
  corporate: '💼',
  synthwave: '🌃',
  retro: '👾',
  cyberpunk: '🤖',
  valentine: '💝',
  halloween: '🎃',
  garden: '🌻',
  forest: '🌲',
  aqua: '💧',
  lofi: '🎧',
  pastel: '🎨',
  fantasy: '🦄',
  wireframe: '📐',
  black: '🖤',
  luxury: '👑',
  dracula: '🧛',
  cmyk: '🖨️',
  autumn: '🍂',
  business: '📊',
  acid: '🧪',
  lemonade: '🍋',
  night: '🌌',
  coffee: '☕',
  winter: '❄️',
  dim: '🔅',
  nord: '🏔️',
  sunset: '🌅',
};

const THEME_STORAGE_KEY = 'webedt:theme';

export default function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return (stored && THEMES.includes(stored as Theme) ? stored : 'dark') as Theme;
  });
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    console.log('🎨 Setting theme to:', theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    // Log the computed styles to verify theme is applying
    const styles = getComputedStyle(document.documentElement);
    console.log('🎨 CSS Variables:', {
      '--p': styles.getPropertyValue('--p'),
      '--b1': styles.getPropertyValue('--b1'),
      '--bc': styles.getPropertyValue('--bc'),
    });
  }, [theme]);

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    setIsOpen(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.theme-dropdown')) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative theme-dropdown">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn btn-ghost btn-circle text-2xl"
        aria-label="Select theme"
        title={`Current theme: ${theme}`}
      >
        {THEME_EMOJIS[theme]}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-base-100 rounded-lg shadow-lg border border-base-300 max-h-96 overflow-y-auto z-50">
          <div className="p-2">
            <div className="px-3 py-2 text-xs font-semibold text-base-content/60 uppercase">
              Current Theme
            </div>
            <button
              onClick={() => handleThemeChange(theme)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-md bg-primary/10 text-primary font-medium"
            >
              <span className="flex items-center gap-2">
                <span className="text-lg">{THEME_EMOJIS[theme]}</span>
                <span className="capitalize">{theme}</span>
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-5 h-5"
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            <div className="mt-2 pt-2 border-t border-base-300">
              <div className="px-3 py-2 text-xs font-semibold text-base-content/60 uppercase">
                All Themes
              </div>
              <div className="space-y-1">
                {THEMES.filter((t) => t !== theme).map((t) => (
                  <button
                    key={t}
                    onClick={() => handleThemeChange(t)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-base-200 text-base-content transition-colors text-left"
                  >
                    <span className="text-lg">{THEME_EMOJIS[t]}</span>
                    <span className="capitalize">{t}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
