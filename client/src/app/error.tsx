'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // After a new deployment an old cached page can point at files that no longer exist. One automatic reload fixes that.
    const stale = /ChunkLoadError|Loading chunk|dynamically imported module/i.test(`${error.name} ${error.message}`);
    try { if (stale && !sessionStorage.getItem('chunk-reload')) { sessionStorage.setItem('chunk-reload', '1'); location.reload(); } } catch {}
  }, [error]);
  return <main className="bg-cinema grid min-h-[100dvh] place-items-center p-5">
    <div className="w-full max-w-md space-y-4 rounded-card border border-white/5 bg-surface p-6 text-center shadow-card">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">Vimo hit an unexpected error. Try again, and if it keeps happening, send the message below to whoever runs this site.</p>
      <pre className="whitespace-pre-wrap break-words rounded-xl bg-surface2 p-3 text-left text-xs text-accent">{error.name}: {error.message}{error.digest ? `\n(digest ${error.digest})` : ''}</pre>
      <Button onClick={() => reset()}>Try again</Button>
      <a href="/" className="block text-sm text-secondary underline">Back to start</a>
    </div></main>;
}
