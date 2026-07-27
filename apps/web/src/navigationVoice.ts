import type { RouteMode, RouteStep } from "./types";

const distancePrompts: Record<Exclude<RouteMode, "transit">, number[]> = {
  "two-wheeler": [500, 150, 30],
  bicycle: [200, 60, 15],
  walk: [80, 20]
};

export interface VoiceAnnouncement {
  key: string;
  text: string;
}

export function nextVoiceAnnouncement({
  mode,
  step,
  stepIndex,
  distanceMeters,
  arrived,
  spokenKeys
}: {
  mode: RouteMode;
  step?: RouteStep;
  stepIndex: number;
  distanceMeters: number;
  arrived: boolean;
  spokenKeys: ReadonlySet<string>;
}): VoiceAnnouncement | undefined {
  if (arrived) {
    return spokenKeys.has("arrived")
      ? undefined
      : { key: "arrived", text: "已抵達目的地，請留意周遭環境。" };
  }
  if (!step) {
    return undefined;
  }

  if (step.transit && step.travelMode !== "WALK") {
    const departureKey = `step:${stepIndex}:board`;
    if (!spokenKeys.has(departureKey)) {
      const line = step.transit.line?.shortName || step.transit.line?.name || "大眾運輸";
      const stop = step.transit.departureStop?.name;
      return {
        key: departureKey,
        text: stop ? `請在${stop}搭乘${line}。` : `請搭乘${line}。`
      };
    }

    const secondsUntilArrival = secondsUntil(step.transit.arrivalTime);
    const alightKey = `step:${stepIndex}:alight`;
    if (secondsUntilArrival !== undefined && secondsUntilArrival <= 180 && !spokenKeys.has(alightKey)) {
      return {
        key: alightKey,
        text: step.transit.arrivalStop?.name
          ? `約三分鐘後抵達${step.transit.arrivalStop.name}，請準備下車。`
          : "約三分鐘後抵達，請準備下車。"
      };
    }
    return undefined;
  }

  const promptMode = mode === "transit" ? "walk" : mode;
  const thresholds = distancePrompts[promptMode];
  const threshold = [...thresholds].reverse().find((value) => distanceMeters <= value);
  if (threshold === undefined) {
    return undefined;
  }
  const key = `step:${stepIndex}:distance:${threshold}`;
  if (spokenKeys.has(key)) {
    return undefined;
  }
  return {
    key,
    text: `${formatSpokenDistance(threshold)}後，${step.instruction}`
  };
}

export function speakNavigationAnnouncement(text: string, muted: boolean) {
  if (muted || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-TW";
  const voice = window.speechSynthesis
    .getVoices()
    .find((candidate) => candidate.lang.toLowerCase().replace("_", "-").startsWith("zh-tw"));
  if (voice) {
    utterance.voice = voice;
  }
  window.speechSynthesis.speak(utterance);
}

export function cancelNavigationSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function secondsUntil(value?: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.round((timestamp - Date.now()) / 1000)) : undefined;
}

function formatSpokenDistance(meters: number) {
  return meters >= 1000 ? `${Math.round(meters / 100) / 10}公里` : `${meters}公尺`;
}
