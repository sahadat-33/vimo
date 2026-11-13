'use client';
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body style={{ margin: 0, background: '#07061A', color: '#fff', fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
    <div style={{ maxWidth: 420, textAlign: 'center' }}>
      <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
      <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left', background: '#1A1736', padding: 12, borderRadius: 12, fontSize: 12, color: '#F97316' }}>{error.name}: {error.message}</pre>
      <button onClick={() => reset()} style={{ marginTop: 12, padding: '12px 20px', borderRadius: 12, border: 0, background: '#8A3FBB', color: '#fff', fontWeight: 600 }}>Try again</button>
    </div></body></html>;
}
