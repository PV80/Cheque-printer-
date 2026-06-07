/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ncba: {
          teal: '#008080',
          dark: '#005f5f',
          light: '#e0f5f5',
        },
        ivy: {
          gold: '#b8960c',
          light: '#fdf8e1',
        },
      },
    },
  },
  plugins: [],
};
