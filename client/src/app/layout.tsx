import './globals.css';
import type { Metadata, Viewport } from 'next';
export const metadata: Metadata = { title: 'Couch Cinema', manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Couch', statusBarStyle: 'black-translucent' } };
export const viewport: Viewport = { themeColor: '#17121f', viewportFit: 'cover', width: 'device-width', initialScale: 1 };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="font-sans">{children}</body></html>;
}
