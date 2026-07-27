import {
  ArrowLeftRight,
  Bike,
  Clock3,
  Footprints,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
  Search,
  TrainFront,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getPlaceDetails, getPlacePredictions } from "../api";
import type {
  NavigationPlan,
  PlacePrediction,
  RouteMode,
  RouteOption,
  RouteRequest,
  SearchPlace,
  UserLocation
} from "../types";

const modeOptions: Array<{
  id: RouteMode;
  label: string;
  icon: typeof Navigation;
}> = [
  { id: "two-wheeler", label: "機車", icon: Navigation },
  { id: "walk", label: "步行", icon: Footprints },
  { id: "bicycle", label: "自行車", icon: Bike },
  { id: "transit", label: "大眾運輸", icon: TrainFront }
];

type TransitMode = NonNullable<NonNullable<RouteRequest["transit"]>["modes"]>[number];
const transitModeOptions: Array<[TransitMode, string]> = [
  ["bus", "公車"],
  ["subway", "捷運"],
  ["train", "火車"],
  ["light-rail", "輕軌"]
];

interface NavigationPlannerProps {
  userLocation?: UserLocation;
  routes: RouteOption[];
  selectedRouteId?: string;
  loading: boolean;
  error: string;
  initialPlan?: NavigationPlan;
  onClose: () => void;
  onPlan: (plan: NavigationPlan) => void;
  onSelectRoute: (routeId: string) => void;
  onStart: () => void;
}

export function NavigationPlanner({
  userLocation,
  routes,
  selectedRouteId,
  loading,
  error,
  initialPlan,
  onClose,
  onPlan,
  onSelectRoute,
  onStart
}: NavigationPlannerProps) {
  const [mode, setMode] = useState<RouteMode>(initialPlan?.request.mode || "two-wheeler");
  const [customOrigin, setCustomOrigin] = useState<SearchPlace | undefined>(() =>
    initialPlan && initialPlan.originLabel !== "目前位置"
      ? {
          id: "planned-origin",
          title: initialPlan.originLabel,
          address: "",
          ...initialPlan.request.origin
        }
      : undefined
  );
  const [destination, setDestination] = useState<SearchPlace | undefined>(initialPlan?.destination);
  const [avoidTolls, setAvoidTolls] = useState(Boolean(initialPlan?.request.avoid?.tolls));
  const [avoidHighways, setAvoidHighways] = useState(Boolean(initialPlan?.request.avoid?.highways));
  const [avoidFerries, setAvoidFerries] = useState(Boolean(initialPlan?.request.avoid?.ferries));
  const [transitTimeMode, setTransitTimeMode] = useState<"now" | "depart-at" | "arrive-by">(
    initialPlan?.request.transit?.timeMode || "now"
  );
  const [transitDateTime, setTransitDateTime] = useState(() => toLocalDateTime(initialPlan?.request.transit?.dateTime));
  const [transitPreference, setTransitPreference] = useState<"default" | "less-walking" | "fewer-transfers">(
    initialPlan?.request.transit?.preference || "default"
  );
  const [transitModes, setTransitModes] = useState<Set<TransitMode>>(
    () => new Set(initialPlan?.request.transit?.modes || ["bus", "subway", "train", "light-rail", "rail"])
  );
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) || routes[0];
  const originCoordinate = customOrigin?.id === "blank-origin" ? undefined : customOrigin || userLocation;
  const canPlan = Boolean(originCoordinate && destination && !loading);

  const request = useMemo<RouteRequest | undefined>(() => {
    if (!originCoordinate || !destination) {
      return undefined;
    }

    const base: RouteRequest = {
      origin: { lat: originCoordinate.lat, lon: originCoordinate.lon },
      destination: { lat: destination.lat, lon: destination.lon },
      mode,
      alternatives: true
    };

    if (mode === "two-wheeler") {
      base.avoid = {
        tolls: avoidTolls,
        highways: avoidHighways,
        ferries: avoidFerries
      };
    }

    if (mode === "transit") {
      base.transit = {
        timeMode: transitTimeMode,
        dateTime:
          transitTimeMode === "now" || !transitDateTime ? undefined : new Date(transitDateTime).toISOString(),
        preference: transitPreference,
        modes: [...transitModes]
      };
    }

    return base;
  }, [
    avoidFerries,
    avoidHighways,
    avoidTolls,
    destination,
    mode,
    originCoordinate,
    transitDateTime,
    transitModes,
    transitPreference,
    transitTimeMode
  ]);

  function submitPlan() {
    if (!request || !destination) {
      return;
    }
    onPlan({
      request,
      originLabel: customOrigin?.title || "目前位置",
      destination
    });
  }

  function swapEndpoints() {
    if (!destination) {
      return;
    }
    const nextDestination = customOrigin || currentLocationPlace(userLocation);
    if (!nextDestination) {
      return;
    }
    setCustomOrigin(destination);
    setDestination(nextDestination);
  }

  return (
    <section className="navigation-planner" aria-label="路線規劃" aria-modal="true" role="dialog">
      <header className="navigation-planner-header">
        <div>
          <p className="eyebrow">Google Routes</p>
          <h2>開始導航</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="關閉路線規劃">
          <X size={20} />
        </button>
      </header>

      <div className="navigation-mode-tabs" aria-label="交通方式">
        {modeOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button
              className={mode === option.id ? "navigation-mode active" : "navigation-mode"}
              key={option.id}
              type="button"
              aria-pressed={mode === option.id}
              onClick={() => setMode(option.id)}
            >
              <Icon size={19} />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>

      <div className="navigation-endpoints">
        <div className="navigation-endpoint-icons" aria-hidden="true">
          <LocateFixed size={17} />
          <span />
          <MapPin size={17} />
        </div>
        <div className="navigation-endpoint-fields">
          {customOrigin ? (
            <PlaceSearchField
              label="起點"
              placeholder="搜尋起點"
              value={customOrigin}
              onChange={(place) => setCustomOrigin(place || blankPlace())}
              onUseCurrent={() => setCustomOrigin(undefined)}
              allowCurrentLocation
            />
          ) : (
            <button
              className="navigation-current-origin"
              type="button"
              onClick={() => setCustomOrigin(undefined)}
              disabled={!userLocation}
            >
              <span>起點</span>
              <strong>{userLocation ? "目前位置" : "等待 GPS 定位"}</strong>
            </button>
          )}
          <PlaceSearchField
            label="目的地"
            placeholder="搜尋目的地"
            value={destination}
            onChange={setDestination}
          />
        </div>
        <button
          className="navigation-swap-button"
          type="button"
          onClick={swapEndpoints}
          disabled={!destination || (!customOrigin && !userLocation)}
          aria-label="交換起點與目的地"
        >
          <ArrowLeftRight size={18} />
        </button>
      </div>

      {!customOrigin && userLocation && (
        <button className="navigation-custom-origin-link" type="button" onClick={() => setCustomOrigin(blankPlace())}>
          改用自訂起點
        </button>
      )}

      {mode === "two-wheeler" && (
        <fieldset className="navigation-preferences">
          <legend>避開路段</legend>
          <PreferenceCheckbox checked={avoidTolls} label="收費道路" onChange={setAvoidTolls} />
          <PreferenceCheckbox checked={avoidHighways} label="高速公路" onChange={setAvoidHighways} />
          <PreferenceCheckbox checked={avoidFerries} label="渡輪" onChange={setAvoidFerries} />
        </fieldset>
      )}

      {mode === "transit" && (
        <div className="navigation-transit-options">
          <label>
            <span>時間</span>
            <select
              value={transitTimeMode}
              onChange={(event) => setTransitTimeMode(event.target.value as typeof transitTimeMode)}
            >
              <option value="now">現在出發</option>
              <option value="depart-at">指定出發</option>
              <option value="arrive-by">指定抵達</option>
            </select>
          </label>
          {transitTimeMode !== "now" && (
            <label>
              <span>日期與時間</span>
              <input
                type="datetime-local"
                value={transitDateTime}
                min={toLocalDateTime(new Date().toISOString())}
                onChange={(event) => setTransitDateTime(event.target.value)}
              />
            </label>
          )}
          <label>
            <span>偏好</span>
            <select
              value={transitPreference}
              onChange={(event) => setTransitPreference(event.target.value as typeof transitPreference)}
            >
              <option value="default">最佳路線</option>
              <option value="less-walking">少走路</option>
              <option value="fewer-transfers">少轉乘</option>
            </select>
          </label>
          <fieldset className="navigation-transit-modes">
            <legend>交通工具</legend>
            {transitModeOptions.map(([id, label]) => (
              <PreferenceCheckbox
                key={id}
                checked={transitModes.has(id)}
                label={label}
                onChange={(checked) => {
                  setTransitModes((current) => {
                    const next = new Set(current);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  });
                }}
              />
            ))}
          </fieldset>
        </div>
      )}

      {mode !== "transit" && (
        <p className="navigation-beta-warning" role="note">
          步行、自行車與機車路線仍為 Beta 版。請留意實際路況、交通規則與周遭環境。
        </p>
      )}

      <button className="navigation-plan-button" type="button" onClick={submitPlan} disabled={!canPlan}>
        <Route size={19} />
        {loading ? "正在規劃路線…" : routes.length ? "重新規劃" : "規劃路線"}
      </button>

      {error && <div className="navigation-error" role="alert">{error}</div>}

      {routes.length > 0 && (
        <div className="navigation-route-results" aria-label="可選路線">
          <div className="navigation-route-results-heading">
            <strong>選擇路線</strong>
            <small>最多顯示 3 條</small>
          </div>
          {routes.map((route, index) => (
            <button
              className={route.id === selectedRoute?.id ? "navigation-route-card active" : "navigation-route-card"}
              key={route.id}
              type="button"
              onClick={() => onSelectRoute(route.id)}
              aria-pressed={route.id === selectedRoute?.id}
            >
              <span className="navigation-route-rank">{index + 1}</span>
              <span>
                <strong>{formatDuration(route.durationSeconds)}</strong>
                <small>{routeSummary(route, mode)}</small>
              </span>
              <span className="navigation-route-distance">{formatDistance(route.distanceMeters)}</span>
            </button>
          ))}
          <button className="navigation-start-button" type="button" onClick={onStart}>
            <Navigation size={20} fill="currentColor" />
            開始
          </button>
        </div>
      )}
    </section>
  );
}

function PlaceSearchField({
  label,
  placeholder,
  value,
  allowCurrentLocation = false,
  onChange,
  onUseCurrent
}: {
  label: string;
  placeholder: string;
  value?: SearchPlace;
  allowCurrentLocation?: boolean;
  onChange: (place: SearchPlace | undefined) => void;
  onUseCurrent?: () => void;
}) {
  const [input, setInput] = useState(value?.title || "");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setInput(value?.title || "");
  }, [value?.id, value?.title]);

  useEffect(() => {
    const query = input.trim();
    if (value?.title === query || query.length < 2) {
      setPredictions([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      getPlacePredictions(query)
        .then((items) => {
          if (active) setPredictions(items);
        })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 260);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [input, value?.title]);

  async function choosePrediction(prediction: PlacePrediction) {
    setLoading(true);
    setError("");
    try {
      const place = await getPlaceDetails(prediction.placeId);
      onChange(place);
      setInput(place.title);
      setPredictions([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="navigation-place-field">
      <label>
        <span>{label}</span>
        <span className="navigation-place-input">
          <Search size={16} />
          <input
            type="search"
            value={input}
            placeholder={placeholder}
            onChange={(event) => {
              setInput(event.target.value);
              onChange(undefined);
            }}
          />
          {input && (
            <button
              type="button"
              aria-label={`清除${label}`}
              onClick={() => {
                setInput("");
                onChange(undefined);
                setPredictions([]);
              }}
            >
              <X size={15} />
            </button>
          )}
        </span>
      </label>
      {(predictions.length > 0 || loading || error || allowCurrentLocation) && (
        <div className="navigation-place-results">
          {allowCurrentLocation && (
            <button type="button" onClick={onUseCurrent}>
              <LocateFixed size={16} />
              <span><strong>目前位置</strong><small>使用 GPS 定位</small></span>
            </button>
          )}
          {predictions.map((prediction) => (
            <button type="button" key={prediction.placeId} onClick={() => void choosePrediction(prediction)}>
              <MapPin size={16} />
              <span>
                <strong>{prediction.mainText}</strong>
                <small>{prediction.secondaryText}</small>
              </span>
            </button>
          ))}
          {loading && <small className="navigation-place-status">搜尋地點中…</small>}
          {error && <small className="navigation-place-status error">{error}</small>}
        </div>
      )}
    </div>
  );
}

function PreferenceCheckbox({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="navigation-preference">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function currentLocationPlace(userLocation?: UserLocation): SearchPlace | undefined {
  return userLocation
    ? {
        id: "current-location",
        title: "目前位置",
        address: "GPS 定位",
        lat: userLocation.lat,
        lon: userLocation.lon
      }
    : undefined;
}

function blankPlace(): SearchPlace {
  return { id: "blank-origin", title: "", address: "", lat: 0, lon: 0 };
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} 公里` : `${Math.round(meters)} 公尺`;
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小時 ${remainder} 分` : `${hours} 小時`;
}

function routeSummary(route: RouteOption, mode: RouteMode) {
  if (mode !== "transit") {
    return route.labels.includes("DEFAULT_ROUTE") ? "建議路線" : "替代路線";
  }
  const transitLines = route.legs
    .flatMap((leg) => leg.steps)
    .map((step) => step.transit?.line?.shortName || step.transit?.line?.name)
    .filter(Boolean);
  return transitLines.length ? [...new Set(transitLines)].join(" · ") : "大眾運輸行程";
}

function toLocalDateTime(value?: string) {
  const date = value ? new Date(value) : new Date(Date.now() + 15 * 60 * 1000);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
