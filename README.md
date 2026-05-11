# Taiwan Live Camera Web Prototype

Windows-first web prototype for a Taiwan live camera app.

## Stack

- Web: Vite + React + TypeScript + Leaflet
- Local API: Fastify
- Vercel API: root `/api` Vercel Functions
- Package manager: pnpm

## Local Setup

Copy `.env.example` to `.env.local` and fill the keys you already have:

```env
TDX_CLIENT_ID=
TDX_CLIENT_SECRET=
CWA_API_KEY=your-cwa-api-key
MOENV_API_KEY=your-moenv-api-key
API_PORT=8787
VITE_API_BASE_URL=/api
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
```

`TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` can stay empty while waiting for TDX approval. In that state `/api/cameras` returns an empty list with a source warning instead of failing the deployment.
