# 台灣即時影像 Web 原型

這是一個 Windows 可先開發的 Web 原型，前端用 `Vite + React + TypeScript + Leaflet`，後端用 `Fastify` 做官方公開 API proxy。前端不保存 TDX、中央氣象署或環境部 API key。

## 功能

- 讀取真實 TDX CCTV metadata：國道、公路、縣市攝影機。
- 地圖搜尋、分類、收藏與攝影機詳情。
- 依縣市查詢天氣、AQI 與水位摘要。
- 影像串流不經後端轉存；可播放就直接播放，不可播放就提供來源開啟。

## 設定

1. 安裝 Node.js 20 以上與 pnpm。
2. 複製 `.env.example` 成 `.env.local`，填入：
   - `TDX_CLIENT_ID`
   - `TDX_CLIENT_SECRET`
   - `CWA_API_KEY`
   - `MOENV_API_KEY`
3. 安裝套件並啟動：

```powershell
pnpm install
pnpm run dev
```

前端預設在 `http://localhost:5173`，後端 API proxy 預設在 `http://localhost:8787`。

## API

- `GET /api/cameras`
- `GET /api/cameras/:id`
- `GET /api/environment?county=臺北市`
- `GET /api/sources`
- `GET /api/health`

## 部署到 Vercel

這個 repo 已包含 `vercel.json` 與 `/api` Vercel Functions。部署時請在 Vercel 使用 repo 根目錄，不要把 Root Directory 改成 `apps/web`。

建議設定：

- Framework Preset: `Vite`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm run build:vercel`
- Output Directory: `dist`

如果 Vercel 顯示找不到 `dist` 或 entrypoint，請確認 Root Directory 是 repo 根目錄 `./`，不是 `apps/web`。repo 內的 `vercel.json` 會先建置 `apps/web/dist`，再複製到根目錄 `dist` 給 Vercel 發佈。

Vercel Environment Variables 請設定：

- `CWA_API_KEY`
- `MOENV_API_KEY`
- `TDX_CLIENT_ID`：TDX 審核通過後再補
- `TDX_CLIENT_SECRET`：TDX 審核通過後再補

TDX key 尚未設定時，`/api/cameras` 會回傳空清單與來源錯誤提示，網站仍可部署與載入。

## 資料來源

- TDX 運輸資料流通服務
- 中央氣象署開放資料平台
- 環境部環境資料開放平台
- 經濟部水利署即時水位資料
