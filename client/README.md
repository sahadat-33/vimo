# Vimo
Better together.

1. `cd server && cp .env.example .env && npm i && npm start` (deploy to Render, health check path `/health`).
2. `cd client && cp .env.example .env.local && npm i && npm run dev` (deploy to Vercel; set `NEXT_PUBLIC_SERVER_URL`).
3. Shared video upload uses Backblaze B2. See `../SETUP_STORAGE.md`.
