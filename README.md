# Taiwan Live Camera Web Prototype

Windows-first web prototype for a Taiwan live camera app.

## Stack

- Web: Vite + React + TypeScript + Google Maps JavaScript API
- Local API: Fastify
- Vercel API: root `/api` Vercel Functions
- Package manager: pnpm

## Local Setup

Copy `.env.example` to `.env.local` and fill the keys you already have:

```env
TDX_CLIENT_ID=
TDX_CLIENT_SECRET=
TDX_CITY_CODES=Taipei
CWA_API_KEY=your-cwa-api-key
MOENV_API_KEY=your-moenv-api-key
API_PORT=8787
VITE_API_BASE_URL=/api
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

Install and run:

```powershell
pnpm install
pnpm run dev
```

Local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

## API Routes

- `GET /api/health`
- `GET /api/cameras`
- `GET /api/cameras/:id`
- `GET /api/environment?county=臺北市`
- `GET /api/sources`

## Vercel Deployment

Deploy from the repo root. Do not set Root Directory to `apps/web`, because root `/api` contains the Vercel Functions.

Vercel settings:

```text
Root Directory: ./
Framework Preset: Vite
Install Command: pnpm install --frozen-lockfile
Build Command: pnpm -w run build:vercel
Output Directory: dist
```

The root `vite.config.ts` reads `apps/web` as the Vite app root and writes the static build directly to root `dist`. The `-w` flag forces pnpm to run the build from the workspace root even if Vercel starts the command inside a workspace package.

Environment Variables:

```text
CWA_API_KEY
MOENV_API_KEY
TDX_CLIENT_ID
TDX_CLIENT_SECRET
TDX_CITY_CODES
VITE_GOOGLE_MAPS_API_KEY
```

`TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` can stay empty while waiting for TDX approval. The API will try TDX public reads for CCTV/VD metadata; when credentials are present, it uses the OAuth token first and falls back to public reads if the token is rate-limited.

`TDX_CITY_CODES` defaults to `Taipei` so the first Vercel load does not call every city CCTV endpoint and hit TDX rate limits. Set it to `all` or a comma-separated list like `Taipei,NewTaipei,Taichung` after the TDX quota is stable.

`VITE_GOOGLE_MAPS_API_KEY` is a browser key for the map. Keep the real value in `.env.local` and Vercel Environment Variables, and restrict it in Google Cloud Console to Maps JavaScript API plus your Vercel domain and localhost development URLs.
