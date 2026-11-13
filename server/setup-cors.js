// One-off helper: sets the bucket's CORS rules through the B2 native API (the B2 web page cannot set the S3 upload permission).
// Run once from any computer or a GitHub Codespace. Needs Node 18+, no installs:
//   B2_KEY_ID=<keyID> B2_APP_KEY=<applicationKey> B2_BUCKET=<bucket name> node setup-cors.js
// The key must have listBuckets and writeBuckets (your master application key works; delete nothing, it only edits CORS).
// Optional: ORIGIN=https://your-site (default https://vimo1.vercel.app). Not tested against a live bucket.
const { B2_KEY_ID, B2_APP_KEY, B2_BUCKET } = process.env;
const ORIGIN = process.env.ORIGIN || 'https://vimo1.vercel.app';
if (!B2_KEY_ID || !B2_APP_KEY || !B2_BUCKET) { console.error('Set B2_KEY_ID, B2_APP_KEY and B2_BUCKET.'); process.exit(1); }
const call = async (url, opts) => {
  const r = await fetch(url, opts), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.code || ''} ${j.message || ''}`.trim());
  return j;
};
(async () => {
  const auth = await call('https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
    { headers: { Authorization: 'Basic ' + Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64') } });
  const post = (path, body) => call(`${auth.apiUrl}/b2api/v2/${path}`, { method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const { buckets } = await post('b2_list_buckets', { accountId: auth.accountId, bucketName: B2_BUCKET });
  if (!buckets.length) throw new Error('Bucket not found. Check the name, and that this key can list buckets.');
  const corsRules = [{ corsRuleName: 'vimo-upload', allowedOrigins: [ORIGIN], allowedOperations: ['s3_put', 's3_get', 's3_head'],
    allowedHeaders: ['*'], exposeHeaders: ['ETag'], maxAgeSeconds: 3600 }];
  const out = await post('b2_update_bucket', { accountId: auth.accountId, bucketId: buckets[0].bucketId, corsRules });
  console.log('CORS rules are now:\n' + JSON.stringify(out.corsRules, null, 1) + '\nWait about a minute, then try the upload again.');
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
