import type { SourceInfo } from "./types.js";

export const sources: SourceInfo[] = [
  {
    id: "tdx-cctv",
    name: "TDX 運輸資料流通服務 CCTV",
    url: "https://tdx.transportdata.tw/",
    licenseUrl: "https://data.gov.tw/license",
    cadence: "依各交通資料提供機關更新",
    notes: "本原型讀取 CCTV metadata；影像串流由來源 URL 直接播放。"
  },
  {
    id: "cwa-weather",
    name: "中央氣象署開放資料平台",
    url: "https://opendata.cwa.gov.tw/",
    licenseUrl: "https://data.gov.tw/license",
    cadence: "依資料集公告更新",
    notes: "使用縣市天氣預報做攝影機詳情的輔助資訊。"
  },
  {
    id: "cwa-rainfall",
    name: "中央氣象署自動雨量站資料",
    url: "https://opendata.cwa.gov.tw/dataset/all/O-A0002-001",
    licenseUrl: "https://data.gov.tw/license",
    cadence: "約 10 分鐘",
    notes: "雨天路況模式用最近雨量站顯示短時累積雨量。"
  },
  {
    id: "cwa-radar",
    name: "中央氣象署雷達整合回波透明圖層",
    url: "https://opendata.cwa.gov.tw/dataset/observation/O-A0058-006",
    licenseUrl: "https://data.gov.tw/license",
    cadence: "約 10 分鐘",
    notes: "以透明圖層疊在地圖上，提供雨區視覺判斷。"
  },
  {
    id: "moenv-aqi",
    name: "環境部空氣品質指標 AQI",
    url: "https://data.moenv.gov.tw/dataset/detail/AQX_P_432",
    licenseUrl: "https://data.gov.tw/license",
    cadence: "每小時",
    notes: "以縣市測站彙整平均與最高 AQI。"
  },
  {
    id: "wra-water",
    name: "經濟部水利署即時水位資料",
    url: "https://data.gov.tw/dataset/25768",
    licenseUrl: "https://data.gov.tw/license",
    cadence: "約 10 至 60 分鐘",
    notes: "即時原始資料可能未經完整檢核，原型會在 UI 顯示提醒。"
  },
  {
    id: "tourism-livecam",
    name: "交通部觀光署即時影像",
    url: "https://www.taiwan.net.tw/m1.aspx?sNo=0042331",
    licenseUrl: "https://data.gov.tw/license",
    cadence: "依觀光署公開頁面更新",
    notes: "解析官方即時影像頁面作為風景區攝影機來源；座標缺漏時可用 Google Geocoding 補足。"
  }
];
