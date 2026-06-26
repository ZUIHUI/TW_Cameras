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
TDX_CITY_CODES=all
CWA_API_KEY=your-cwa-api-key
MOENV_API_KEY=your-moenv-api-key
GOOGLE_GEOCODING_API_KEY=your-server-side-google-geocoding-api-key
GOOGLE_MAPS_API_KEY=your-server-side-google-places-api-key
API_PORT=8787
VITE_API_BASE_URL=/api
VITE_GOOGLE_MAPS_API_KEY=your-restricted-browser-google-maps-api-key
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
- `GET /api/nearby-tourism?lat=25.033&lon=121.5654&radius=3000`
- `GET /api/environment?county=臺北市`
- `GET /api/radar`
- `GET /api/rainfall?lat=25.033&lon=121.5654&radius=15000&limit=8`
- `GET /api/google-places?kind=autocomplete&input=台北車站`
- `GET /api/google-places?kind=details&placeId=...`
- `GET /api/google-places?kind=nearby-restaurants&lat=25.033&lon=121.5654&radius=3000`
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
GOOGLE_GEOCODING_API_KEY
GOOGLE_MAPS_API_KEY
VITE_GOOGLE_MAPS_API_KEY
```

`TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` can stay empty while waiting for TDX approval for CCTV/VD metadata; those requests try TDX public reads and use the OAuth token first when credentials are present. Tourism V2.1 nearby recommendations require TDX credentials.

`TDX_CITY_CODES` defaults to `all` so the city CCTV catalog covers Taiwan. Set a comma-separated list like `Taipei,NewTaipei,Taichung` only when you want to limit TDX requests during development.

`VITE_GOOGLE_MAPS_API_KEY` is the browser key for the interactive Google map. Google Maps JavaScript API keys are visible to the browser by design, so this key must be restricted in Google Cloud Console with HTTP referrers for your Vercel domain and localhost, and API restrictions for Maps JavaScript API only.

`GOOGLE_MAPS_API_KEY` is server-side only. It powers the internal `/api/google-places` proxy for Google Places autocomplete, place details, and restaurant recommendations, so it must not use the `VITE_` prefix and must not be restricted by HTTP referrer. Restrict it in Google Cloud Console to Places API / Places API (New) usage. If you add an application restriction for server-side use, use an allowed server/network restriction that matches the deployed runtime; a browser referrer restriction will fail from Vercel Functions.

`GOOGLE_GEOCODING_API_KEY` is server-side only. It is used to add coordinates to scenic live cameras when the tourism source page does not expose coordinates. Restrict it to Geocoding API usage in Google Cloud.

## Radar Overlay

The map can show the latest CWA radar echo as a Google Maps overlay. `GET /api/radar` reads the CWA OpenData file API dataset `O-A0058-006`, normalizes the transparent radar image URL and geographic bounds, and caches the metadata briefly.

The radar layer uses the existing server-side `CWA_API_KEY`. It is optional in the UI; if the key or upstream data is unavailable, camera and nearby tourism features continue to work.

## Rainy Traffic Mode

The web app includes a rainy traffic mode that turns on the radar overlay, keeps CCTV and VD layers visible, sorts the camera list around the current observation point, and shows nearby CWA rainfall station readings. `GET /api/rainfall` uses the CWA OpenData dataset `O-A0002-001` with the existing `CWA_API_KEY`; it returns the nearest stations with 10-minute, 1-hour, 3-hour, and 24-hour rainfall totals.

If CWA rainfall or radar data is unavailable, the rainy status panel degrades to a warning state without blocking the camera map, favorites, nearby search, or tourism recommendations.

## Tourism Nearby Data

The app includes a lightweight "nearby fun" panel powered by Tourism Administration open data through TDX Tourism V2.1 APIs. It uses the TDX tourism OData service:

- Attractions: `/api/tourism/service/odata/V2/Tourism/Attraction`
- Restaurants: `/api/tourism/service/odata/V2/Tourism/Restaurant`
- Events: `/api/tourism/service/odata/V2/Tourism/Event`

The local API normalizes these sources into `GET /api/nearby-tourism`, queries a bounded TDX OData area around the selected camera, Google place, or current location, filters by exact distance, and returns up to 8 items per category. Nearby query results are cached briefly by coordinate bucket to reduce repeated upstream calls.

The web app calls the internal `/api/google-places` proxy to improve the restaurant recommendation group with Google Places. Google Places restaurants are shown first when available; if Google Places is unavailable or returns no restaurants, the UI falls back to TDX Tourism restaurant data.

Reference sources:

- Tourism Administration website nearby feature: https://www.taiwan.net.tw/m1.aspx?sNo=0000165
- Scenic spots dataset: https://data.gov.tw/dataset/7777
- Restaurants dataset: https://data.gov.tw/dataset/7779
- Activities dataset: https://data.gov.tw/dataset/7778
