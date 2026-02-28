/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#5CF6FF',
          dark: '#2FD0DC',
          light: '#A8FBFF',
        },
        secondary: {
          DEFAULT: '#FF8A3D',
          dark: '#E06B21',
          light: '#FFB785',
        },
        accent: {
          DEFAULT: '#B8FF68',
          dark: '#84D141',
          light: '#D8FFAB',
        },
        background: '#050507',
        surface: '#0F1118',
        panel: '#151826',
        border: '#2B3143',
        text: '#F6F8FF',
        'text-muted': '#A9B0C4',
        success: '#31D0AA',
        warning: '#F1B84B',
        error: '#FF5578',
        info: '#63AAFF',
      },
      borderRadius: {
        xs: '6px',
        sm: '10px',
        md: '14px',
        lg: '20px',
        xl: '28px',
      },
      spacing: {
        0.5: '2px',
      },
    },
  },
  plugins: [],
};
