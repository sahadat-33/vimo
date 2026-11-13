import './globals.css';
import type { Metadata, Viewport } from 'next';
export const metadata: Metadata = { title: 'Vimo', description: 'Watch together. Better together.', manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Vimo', statusBarStyle: 'black-translucent' } };
export const viewport: Viewport = { themeColor: '#07061A', viewportFit: 'cover', width: 'device-width', initialScale: 1 };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="font-sans">{children}</body></html>;
}
