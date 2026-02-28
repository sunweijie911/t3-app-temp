import UnoCSS from '@unocss/postcss';

export default {
  plugins: [
    UnoCSS({
      content: ['./src/**/*.{html,js,ts,jsx,tsx}'],
    }),
  ],
};
