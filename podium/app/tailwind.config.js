

const config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: '#fed23a',
        'brand-hover': '#e0bb35',
        'brand-dim': 'rgba(254,210,58,0.15)',
        teal: '#2bcdc1',
        'wp-blue': '#40b1d0',
        amber: '#f7a933',
        purple: '#3a204c',
        'dark-bg': '#0f1318',
        'dark-surface': '#151921',
        'dark-surface-2': '#1c2433',
        'dark-surface-3': '#243048',
        'dark-border': '#2e3243',
        'dark-border-light': '#3a4d68',
      },
      fontFamily: {
        sans: ["'Whitney HTF Medium'", "'Inter'", 'system-ui', 'sans-serif'],
        bold: ["'Whitney HTF Bold'", "'Inter'", 'system-ui', 'sans-serif'],
        mono: ["'SF Mono'", "'Cascadia Code'", 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
