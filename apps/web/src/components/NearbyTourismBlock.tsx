import { AlertCircle, MapPin } from "lucide-react";
import type { GoogleRestaurantItem, NearbyTourismItem, NearbyTourismResponse, TourismItemType } from "../types";

interface NearbyTourismBlockProps {
  tourism?: NearbyTourismResponse;
  loading: boolean;
  error: string;
  title?: string;
  compact?: boolean;
  googleRestaurants?: GoogleRestaurantItem[];
  googleRestaurantsLoading?: boolean;
  googleRestaurantsError?: string;
}

const tourismGroups: Array<{
  key: "attractions" | "restaurants" | "activities";
  type: TourismItemType;
  label: string;
}> = [
  { key: "attractions", type: "attraction", label: "景點" },
  { key: "restaurants", type: "restaurant", label: "餐飲推薦" },
  { key: "activities", type: "activity", label: "活動" }
];

export function NearbyTourismBlock({
  tourism,
  loading,
  error,
  title = "附近玩樂",
  compact = false,
  googleRestaurants = [],
  googleRestaurantsLoading = false,
  googleRestaurantsError = ""
}: NearbyTourismBlockProps) {
  const attractionItems = tourism?.attractions ?? [];
  const tdxRestaurantItems = tourism?.restaurants ?? [];
  const restaurantItems = googleRestaurants.length ? googleRestaurants : tdxRestaurantItems;
  const activityItems = tourism?.activities ?? [];
  const hasItems = Boolean(attractionItems.length || restaurantItems.length || activityItems.length);
  const showRestaurantGroup = Boolean(restaurantItems.length || googleRestaurantsLoading || googleRestaurantsError);

  return (
    <section className={compact ? "tourism-block compact" : "tourism-block"} aria-label={title}>
      <div className="tourism-title">
        <MapPin size={17} />
        <h3>{title}</h3>
        {tourism?.origin.radiusMeters && <span>{formatDistance(tourism.origin.radiusMeters)}內</span>}
      </div>

      {loading && <p className="muted">讀取觀光署附近玩樂資訊中。</p>}

      {!loading && error && (
        <div className="status-message warning">
          <AlertCircle size={17} />
          <span>附近玩樂資訊暫時無法取得：{error}</span>
        </div>
      )}

      {!loading && !error && tourism?.sourceErrors.length ? (
        <div className="tourism-source-warning">
          <AlertCircle size={15} />
          <span>部分觀光來源延遲，已顯示可用資料。</span>
        </div>
      ) : null}

      {!loading && !error && tourism && !hasItems && !googleRestaurantsLoading && (
        <p className="muted">附近暫無景點、餐飲推薦或活動資料。</p>
      )}

      {!loading && !error && tourism && (hasItems || googleRestaurantsLoading || googleRestaurantsError) && (
        <div className="tourism-groups">
          <TourismGroup items={attractionItems} label={tourismGroups[0].label} />

          {showRestaurantGroup && (
            <div className="tourism-group">
              <div className="section-label">
                <span>{tourismGroups[1].label}</span>
                <strong>{restaurantItems.length}</strong>
              </div>
              {googleRestaurantsLoading && <p className="muted tourism-inline-note">讀取 Google 餐廳推薦中。</p>}
              {googleRestaurantsError && (
                <div className="tourism-source-warning">
                  <AlertCircle size={15} />
                  <span>{googleRestaurantsError}</span>
                </div>
              )}
              {restaurantItems.length > 0 && (
                <div className="tourism-list">
                  {restaurantItems.map((item) => (
                    <TourismItemCard item={item} key={item.id} />
                  ))}
                </div>
              )}
            </div>
          )}

          <TourismGroup items={activityItems} label={tourismGroups[2].label} />
        </div>
      )}
    </section>
  );
}

function TourismGroup({ items, label }: { items: NearbyTourismItem[]; label: string }) {
  if (!items.length) return null;

  return (
    <div className="tourism-group">
      <div className="section-label">
        <span>{label}</span>
        <strong>{items.length}</strong>
      </div>
      <div className="tourism-list">
        {items.map((item) => (
          <TourismItemCard item={item} key={item.id} />
        ))}
      </div>
    </div>
  );
}

function TourismItemCard({ item }: { item: NearbyTourismItem | GoogleRestaurantItem }) {
  const isGoogleRestaurant = isGoogleRestaurantItem(item);
  const link = tourismItemLink(item);
  const metadata = isGoogleRestaurant ? googleRestaurantMetadata(item) : formatDistance(item.distanceMeters);
  const description = isGoogleRestaurant ? item.address : item.description;

  return (
    <article className="tourism-item">
      {"imageUrl" in item && item.imageUrl && <img alt="" src={item.imageUrl} />}
      <div className="tourism-item-copy">
        <div className="tourism-item-heading">
          <span>{isGoogleRestaurant ? "Google Places" : typeLabel(item.type)}</span>
          <strong>{item.title}</strong>
        </div>
        <small>{metadata}</small>
        {description && <p>{description}</p>}
        <div className="tourism-links">
          <a href={link.href} rel="noreferrer" target="_blank">
            <MapPin size={14} />
            {link.label}
          </a>
        </div>
      </div>
    </article>
  );
}

function tourismItemLink(item: NearbyTourismItem | GoogleRestaurantItem) {
  if (isGoogleRestaurantItem(item)) {
    return { href: item.googleMapsUrl, label: "地圖查看" };
  }

  if (item.type === "activity" && isHttpUrl(item.url)) {
    return { href: item.url, label: "開啟活動" };
  }

  if (item.type === "activity") {
    return { href: googleSearchUrl(item), label: "搜尋活動" };
  }

  return { href: googleMapsUrl(item), label: "地圖查看" };
}

function isGoogleRestaurantItem(item: NearbyTourismItem | GoogleRestaurantItem): item is GoogleRestaurantItem {
  return "source" in item && item.source === "Google Places";
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function typeLabel(type: TourismItemType) {
  return {
    attraction: "景點",
    restaurant: "餐飲",
    activity: "活動"
  }[type];
}

function googleRestaurantMetadata(item: GoogleRestaurantItem) {
  return [
    formatDistance(item.distanceMeters),
    item.rating ? `評分 ${item.rating.toFixed(1)}${item.userRatingCount ? ` (${item.userRatingCount.toLocaleString("zh-TW")})` : ""}` : "",
    priceLevelLabel(item.priceLevel),
    businessStatusLabel(item.businessStatus)
  ]
    .filter(Boolean)
    .join(" · ");
}

function priceLevelLabel(value?: string) {
  const labels: Record<string, string> = {
    FREE: "免費",
    INEXPENSIVE: "$",
    MODERATE: "$$",
    EXPENSIVE: "$$$",
    VERY_EXPENSIVE: "$$$$"
  };
  return labels[value || ""];
}

function businessStatusLabel(value?: string) {
  const labels: Record<string, string> = {
    OPERATIONAL: "正常營業",
    CLOSED_TEMPORARILY: "暫時停業",
    CLOSED_PERMANENTLY: "永久停業"
  };
  return labels[value || ""];
}

function formatDistance(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} 公里`;
  }
  return `${Math.round(value)} 公尺`;
}

function googleMapsUrl(item: { lat: number; lon: number; title?: string }) {
  const query = item.title ? `${item.title} ${item.lat},${item.lon}` : `${item.lat},${item.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function googleSearchUrl(item: { title: string; address?: string }) {
  const query = [item.title, item.address, "活動"].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
