/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // CodeAtlas 专属主题色板（Atlas Blue），深浅两套均通过 CSS 变量注入，
      // 这里仅注册语义色名，具体值见 src/theme/atlas.css
      colors: {
        atlas: {
          bg: 'var(--atlas-bg)',
          'bg-2': 'var(--atlas-bg-2)',
          border: 'var(--atlas-border)',
          text: 'var(--atlas-text)',
          'text-2': 'var(--atlas-text-2)',
          primary: 'var(--atlas-primary)',
          'primary-hover': 'var(--atlas-primary-hover)',
          success: 'var(--atlas-success)',
          warning: 'var(--atlas-warning)',
          error: 'var(--atlas-error)',
        },
      },
    },
  },
  plugins: [],
};
