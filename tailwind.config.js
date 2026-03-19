/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: '#F5F5F7',
          surface: '#FFFFFF',
          text: '#1D1D1F',
          'text-secondary': '#6E6E73',
          'text-tertiary': '#86868B',
          blue: '#0071E3',
          'blue-hover': '#0077ED',
          green: '#34C759',
          red: '#FF3B30',
          orange: '#FF9500',
          border: '#D2D2D7',
          divider: '#E8E8ED',
          'fill-secondary': '#F5F5F7',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        'apple-xs': ['11px', { lineHeight: '1.36', letterSpacing: '0.01em' }],
        'apple-sm': ['13px', { lineHeight: '1.38', letterSpacing: '-0.003em' }],
        'apple-base': ['15px', { lineHeight: '1.47', letterSpacing: '-0.009em' }],
        'apple-lg': ['17px', { lineHeight: '1.47', letterSpacing: '-0.017em' }],
        'apple-xl': ['21px', { lineHeight: '1.38', letterSpacing: '0.011em' }],
        'apple-2xl': ['28px', { lineHeight: '1.14', letterSpacing: '0.007em' }],
        'apple-3xl': ['32px', { lineHeight: '1.125', letterSpacing: '0.004em' }],
        'apple-hero': ['40px', { lineHeight: '1.1', letterSpacing: '0em' }],
      },
      borderRadius: {
        apple: '12px',
        'apple-sm': '8px',
        'apple-pill': '980px',
      },
      boxShadow: {
        apple: '0 1px 3px rgba(0, 0, 0, 0.08)',
        'apple-md': '0 4px 12px rgba(0, 0, 0, 0.12)',
        'apple-lg': '0 8px 24px rgba(0, 0, 0, 0.15)',
      },
    },
  },
  plugins: [],
};
