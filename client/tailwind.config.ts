import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
// Design tokens. Legacy names (night/dusk/plum/blush/cream/ember) alias the new palette so older components follow the theme.
const t = { bg: '#07061A', surface: '#110F26', surface2: '#1A1736', primary: '#8A3FBB', secondary: '#A76DCA', brand: '#6A5B9A', accent: '#F97316', ink: '#FFFFFF', muted: '#A9A5C4' };
export default { content: ['./src/**/*.{ts,tsx}'], theme: { extend: {
  colors: { ...t, night: t.bg, dusk: t.surface, plum: t.surface2, blush: t.secondary, cream: t.ink, ember: t.accent },
  fontFamily: { sans: ['Poppins', 'system-ui', 'sans-serif'] },
  borderRadius: { card: '20px' },
  boxShadow: { card: '0 10px 30px -12px rgba(0,0,0,.6)', glow: '0 8px 30px -8px rgba(138,63,187,.5)' } } }, plugins: [plugin(({ addVariant }) => { addVariant('touch-land', '@media (pointer: coarse) and (orientation: landscape)'); })] } satisfies Config;
