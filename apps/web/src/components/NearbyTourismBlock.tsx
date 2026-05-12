import { AlertCircle, ExternalLink, MapPin } from "lucide-react";
import type { NearbyTourismItem, NearbyTourismResponse, TourismItemType } from "../types";

interface NearbyTourismBlockProps {
  tourism?: NearbyTourismResponse;
  loading: boolean;
  error: string;
  title?: string;
  compact?: boolean;
}

const tourismGroups: Array<{
  key: "attractions" | "restaurants" | "activities";
  type: TourismItemType;
  label: string;
}> = [
  { key: "attractions", type: "attraction", label: "景點" },
  { key: "restaurants", type: "restaurant", label: "餐飲" },
  { key: "activities", type: "activity", label: "活動" }
];

export function NearbyTourismBlock({
  tourism,
  loading,
  error,
  title = "附近玩樂",
  compact = false
}: NearbyTourismBlockProps) {
  const hasItems = tourismGroups.some((group) => (tourism?.[group.key].length ?? 0) > 0);

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

      {!loading && !error && tourism && !hasItems && <p className="muted">附近暫無觀光署景點、餐飲或活動資料。</p>}

      {!loading && !error && tourism && hasItems && (
        <div className="tourism-groups">
          {tourismGroups.map((group) => {
            const items = tourism[group.key];
            if (!items.length) return null;

            return (
              <div className="tourism-group" key={group.key}>
                <div className="section-label">
                  <span>{group.label}</span>
                  <strong>{items.length}</strong>
                </div>
                <div className="tourism-list">
                  {items.map((item) => (
                    <TourismItemCard item={item} key={item.id} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TourismItemCard({ item }: { item: NearbyTourismItem }) {
  const sourceUrl = item.url || googleMapsUrl(item);

  return (
    <article className="tourism-item">
      {item.imageUrl && <img alt="" src={item.imageUrl} />}
      <div className="tourism-item-copy">
        <div className="tourism-item-heading">
          <span>{typeLabel(item.type)}</span>
          <strong>{item.title}</strong>
        </div>
        <small>{formatDistance(item.distanceMeters)}</small>
        {item.description && <p>{item.description}</p>}
        <div className="tourism-links">
          <a href={sourceUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={14} />
            開啟來源
          </a>
          <a href={googleMapsUrl(item)} rel="noreferrer" target="_blank">
            <MapPin size={14} />
            地圖查看
          </a>
        </div>
      </div>
    </article>
  );
}

function typeLabel(type: TourismItemType) {
  return {
    attraction: "景點",
    restaurant: "餐飲",
    activity: "活動"
  }[type];
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
