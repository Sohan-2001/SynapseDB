/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        synapse: {
          bg: '#fafaf9',
          card: '#ffffff',
          border: '#e5e7eb',
          accent: '#2563eb',
          content: '#111827',
          muted: '#6b7280',
          dark: '#0b0f19',
          darkborder: '#1e293b',
          emerald: '#059669',
          amber: '#d97706',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
};
