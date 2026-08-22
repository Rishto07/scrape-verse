/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Apple-inspired OLED palette
        'surface': {
          0: '#000000',
          1: '#0a0a0a',
          2: '#141414',
          3: '#1c1c1e',
          4: '#2c2c2e',
        },
        // Apple blue accent
        'accent': {
          DEFAULT: '#0A84FF',
          dim: 'rgba(10, 132, 255, 0.12)',
          bright: '#409CFF',
          glow: 'rgba(10, 132, 255, 0.25)',
        },
        // Semantic colors
        'danger': '#FF453A',
        'warning': '#FFD60A',
        'success': '#32D74B',
        'circuit': '#00E5A0',
        'accent-solid': '#0A84FF',
        // Text hierarchy
        'text': {
          primary: '#FFFFFF',
          secondary: 'rgba(255, 255, 255, 0.7)',
          tertiary: 'rgba(255, 255, 255, 0.5)',
          muted: 'rgba(255, 255, 255, 0.3)',
        },
        // Glass
        'glass': {
          bg: 'rgba(255, 255, 255, 0.05)',
          border: 'rgba(255, 255, 255, 0.1)',
          highlight: 'rgba(255, 255, 255, 0.15)',
        },
      },
      fontFamily: {
        display: ['"SF Pro Display"', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        body: ['"SF Pro Text"', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['"SF Mono"', 'Menlo', 'Monaco', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        '4xl': '1.5rem',
        '5xl': '2rem',
      },
      boxShadow: {
        'glass': '0 0 0 0.5px rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.5)',
        'glass-lg': '0 0 0 0.5px rgba(255,255,255,0.1), 0 8px 40px rgba(0,0,0,0.6)',
        'glow': '0 0 40px rgba(10, 132, 255, 0.2)',
        'glow-sm': '0 0 20px rgba(10, 132, 255, 0.15)',
        'elevated': '0 4px 24px rgba(0,0,0,0.5)',
      },
      animation: {
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
        'shimmer': 'shimmer 2s linear infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
        'heal-spin': 'spin 1.5s linear infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      transitionTimingFunction: {
        'apple': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      },
    },
  },
  plugins: [],
}
