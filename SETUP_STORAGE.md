# Vimo shared video storage: Backblaze B2

Vimo's "Local File" mode uploads one video straight from the browser to a private bucket. Everyone in the room then plays the same file in sync. The server only signs short-lived URLs and never touches the video bytes.

**Status: not tested against a live B2 bucket.** The signing code was checked against AWS's official presigned-URL test vector, and the URL it produces for B2 has the right shape. The B2 behavior below comes from Backblaze's documentation. Follow the checklist at the end to confirm it with your own bucket.

## 1. Create the bucket
1. Backblaze console → **B2 Cloud Storage → Buckets → Create a Bucket**.
2. Name it (for example `vimo-videos-yourname`). **Files in Bucket: Private.** Leave encryption and Object Lock off.
3. Open the bucket and note the **Endpoint**. It looks like `s3.us-west-004.backblazeb2.com`. The middle part (`us-west-004`) is your **region**. Yours may differ (`us-east-005`, `eu-central-003`, and so on).

## 2. Create an application key
1. **Application Keys → Add a New Application Key.**
2. Restrict it to **this bucket only**, type **Read and Write**.
3. Copy the **keyID** and the **applicationKey** immediately. The applicationKey is shown only once.

## 3. Set CORS (required for browser uploads)
**The B2 web page cannot do this.** Its CORS dialog only offers presets ("share with every origin", "with this one origin", and so on), and none of them includes the S3 upload permission (`s3_put`). With a preset, uploads fail in the browser with "couldn't reach storage". The rule has to be set once with the B2 command line tool or with the small script in this repo.

Rule to apply:

```json
[
  {
    "corsRuleName": "vimo-upload",
    "allowedOrigins": ["https://vimo1.vercel.app"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3600
  }
]
```

**Option A: the script (no installs).** On a computer, or in a free GitHub Codespace opened on your repo, run from the `server` folder:

```
B2_KEY_ID=<keyID> B2_APP_KEY=<applicationKey> B2_BUCKET=<bucket name> node setup-cors.js
```
The key needs `listBuckets` and `writeBuckets`. Your master application key works. A key limited to one bucket with Read and Write does not have `writeBuckets`, so create the key from Backblaze's **Application Keys** page with "Allow access to all buckets" and the right capabilities, or use the master key just for this one run, then delete or rotate it.

**Option B: the B2 command line tool** (installed and signed in):
```
b2 bucket update --cors-rules '[{"corsRuleName":"vimo-upload","allowedOrigins":["https://vimo1.vercel.app"],"allowedOperations":["s3_put","s3_get","s3_head"],"allowedHeaders":["*"],"exposeHeaders":["ETag"],"maxAgeSeconds":3600}]' <bucket name> allPrivate
```
On older versions of the tool the command is `b2 update-bucket --corsRules '[...]' <bucket name> allPrivate`.

Afterwards the B2 web page shows "There are 'custom' rules in place". That is expected. Changes take about a minute. If you test from another URL (a Vercel preview, for example), add that origin to `allowedOrigins`. Delete and HEAD-check are done by the server and do not need CORS.

## 4. Lifecycle rule (cleanup; do not skip)
B2 keeps every version of a file. When Vimo "deletes" a video, the S3 delete call only **hides** it, and the data keeps using storage until a lifecycle rule removes it. The same rule also cleans up uploads that were never finished or shared.

Bucket → **Bucket Settings → Lifecycle Settings → custom rule**:

| Field | Value |
|---|---|
| File path (prefix) | `rooms/` |
| Days from uploading to hiding | `2` |
| Days from hiding to deleting | `1` |

(Native JSON form: `[{"fileNamePrefix":"rooms/","daysFromUploadingToHiding":2,"daysFromHidingToDeleting":1}]`.)

Result: every uploaded video disappears about 2 to 3 days after upload, which suits movie nights. Raise the first number if you want longer. Backblaze recommends managing lifecycle rules one way only (console or API, not both).

## 5. Render environment variables
Render → your server service → **Environment**:

| Variable | Value |
|---|---|
| `S3_ENDPOINT` | `https://s3.<region>.backblazeb2.com` (for example `https://s3.us-west-004.backblazeb2.com`) |
| `S3_REGION` | the same region (for example `us-west-004`). **Not `auto`.** |
| `S3_BUCKET` | your bucket name |
| `S3_ACCESS_KEY_ID` | the keyID |
| `S3_SECRET_ACCESS_KEY` | the applicationKey |
| `MAX_UPLOAD_MB` | optional, default `2048`, hard cap `4700` |
| `CLIENT_ORIGIN` | `https://vimo1.vercel.app` (no trailing slash) |

Existing variables stay as they are: `ROOM_PASSCODE`, `DAILY_API_KEY`, `HYPERBEAM_API_KEY`, `PORT`, optional `HYPERBEAM_PROFILE`. The Vercel variable `NEXT_PUBLIC_SERVER_URL` is unchanged. Save, and Render redeploys.

Safety net: if `S3_ENDPOINT` is a Backblaze endpoint, the server takes the region from the endpoint itself and logs a warning when `S3_REGION` disagrees, because signing with the wrong region always fails.

## What the code does (and does not) do
- **Signing:** AWS Signature V4, query-string presigned URLs, path-style (`https://s3.<region>.backblazeb2.com/<bucket>/rooms/<room>/<id>.<ext>`). The same code handles PUT (upload, 6 h), GET (playback, 12 h), HEAD (check the upload finished) and DELETE.
- **Single PUT, no multipart.** B2's S3 API accepts a single upload of up to about 5 GB, so `MAX_UPLOAD_MB` is capped at 4700. Larger files would need multipart upload, which is not implemented. No incomplete-multipart cleanup is needed.
- **Delete:** the server calls DELETE when a video is replaced, removed, or the room ends. On B2 this hides the file; the lifecycle rule in step 4 frees the space.
- **Expired links:** playback URLs last 12 hours; the client asks the server for a fresh one if a link expires.

## Checklist: confirm it works
1. Open the app, start a **Local File** room, and pick a small video (under 50 MB). Progress should reach 100% and the video should play for everyone.
2. In the B2 console → **Browse Files**, you should see `rooms/<room code>/…`.
3. Click **Remove video** in the app. In Browse Files, the file should show as hidden.
4. If the upload fails in the browser console with a CORS error, recheck step 3. If it fails with a signature error, recheck `S3_REGION`, the keyID and applicationKey, and that the key is restricted to the right bucket.
5. Check the Render logs for the line `S3_REGION is "…" but the Backblaze endpoint says "…"`. If it appears, fix `S3_REGION`.

## If the upload fails
The app now shows the real reason under the picker, and the server tests the bucket itself.

1. Open `https://<your-render-url>/health?storage=1` in a browser (it re-runs the test at most once every 30 seconds). Look at the `storage` part:
   - `"ok": true` with upload, download and delete all `ok`: the region, keys, bucket and signing are right. Any remaining failure is browser CORS (step 3 of the setup).
   - `"code": "SignatureDoesNotMatch"` or `"InvalidAccessKeyId"`: wrong `S3_REGION`, keyID or applicationKey.
   - `"code": "AccessDenied"` or `"NoSuchBucket"`: the key is restricted to a different bucket, or `S3_BUCKET` is misspelled.
   - `"error": "network"`: the endpoint URL is wrong.
   - `"configured": false`: one of the `S3_*` variables is missing on Render.
2. The same result is printed in the Render logs as `[storage] {...}` about 3 seconds after each start.
3. In the app: "The browser couldn't reach storage…" means CORS (the bucket must allow PUT from `https://vimo1.vercel.app`). "Storage refused the upload (HTTP 403, …)" means the keys, region or bucket.
