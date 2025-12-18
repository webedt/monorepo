/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      "light",
      "dark",
      "cupcake",
      "bumblebee",
      "emerald",
      "corporate",
      "synthwave",
      "retro",
      "cyberpunk",
      "valentine",
      "halloween",
      "garden",
      "forest",
      "aqua",
      "lofi",
      "pastel",
      "fantasy",
      "wireframe",
      "black",
      "luxury",
      "dracula",
      "cmyk",
      "autumn",
      "business",
      "acid",
      "lemonade",
      "night",
      "coffee",
      "winter",
      "dim",
      "nord",
      "sunset",
      {
        biotin: {
          "color-scheme": "dark",
          "primary": "#c9a227",          // Gold
          "primary-content": "#1a1025",  // Dark purple text on gold
          "secondary": "#6b3fa0",        // Medium purple
          "secondary-content": "#e8d5a3", // Light gold text
          "accent": "#d4a84b",           // Orange-gold
          "accent-content": "#1a1025",   // Dark purple text
          "neutral": "#3d2066",          // Purple
          "neutral-content": "#d4b896",  // Gold text
          "base-100": "#2d1b4e",         // Deep purple background
          "base-200": "#3d2566",         // Lighter purple
          "base-300": "#4d3080",         // Even lighter purple
          "base-content": "#d4a855",     // Gold text
          "info": "#3abff8",
          "success": "#36d399",
          "warning": "#c9a227",          // Gold warning
          "error": "#f87272",
        },
      },
    ],
    darkTheme: "dark",
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
}
