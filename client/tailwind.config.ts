import type { Config } from 'tailwindcss';
// Design tokens. Legacy names (night/dusk/plum/blush/cream/ember) alias the new palette so older components follow the theme.
const t = { bg: '#09090B', surface: '#18181B', surface2: '#202027', primary: '#7C3AED', secondary: '#A78BFA', accent: '#F97316', ink: '#FAFAFA', muted: '#A1A1AA' };
export default { content: ['./src/**/*.{ts,tsx}'], theme: { extend: {
  colors: { ...t, night: t.bg, dusk: t.surface, plum: t.surface2, blush: t.secondary, cream: t.ink, ember: t.accent },
  fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
  borderRadius: { card: '20px' },
  boxShadow: { card: '0 10px 30px -12px rgba(0,0,0,.6)', glow: '0 8px 30px -8px rgba(124,58,237,.55)' } } }, plugins: [] } satisfies Config;
