import type { Config } from 'tailwindcss';
export default { content: ['./src/**/*.{ts,tsx}'], theme: { extend: { colors: {
  night: '#17121f', dusk: '#241b33', plum: '#3a2c52', blush: '#f0a3b5', cream: '#f4ecf0', ember: '#ff7a59' },
  fontFamily: { sans: ['"Figtree"', 'system-ui', 'sans-serif'] } } }, plugins: [] } satisfies Config;
