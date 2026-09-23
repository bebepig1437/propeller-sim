export interface ThrusterStateConfig {
  id: number;
  pitch: number;
  handedness: "CW" | "CCW";
  throttle: number;
}

export interface SimUrlState {
  preset?: string;
  vehicle?: string;
  pitch?: number;
  handedness?: "CW" | "CCW";
  stator?: "slotted" | "solid" | "none";
  statorAngle?: number;
  statorType?: "slotted" | "solid" | "none";
  supplyV?: number;
  tetherFt?: number;
  tetherM?: number;
  tetherAwg?: number;
  thrusterLayout?: ThrusterStateConfig[];
  [key: string]: unknown;
}

export function serializeSimStateToUrl(state: SimUrlState, baseUrl?: string): string {
  const url = new URL(baseUrl || (typeof window !== "undefined" ? window.location.href : "http://localhost:5173/"));
  const jsonString = JSON.stringify(state);
  const base64Encoded = typeof btoa === "function"
    ? btoa(jsonString)
    : (globalThis as any).Buffer?.from(jsonString, "utf-8").toString("base64") || "";
  url.searchParams.set("state", base64Encoded);
  if (state.preset) url.searchParams.set("preset", state.preset);
  if (state.vehicle) url.searchParams.set("vehicle", state.vehicle);
  if (state.pitch !== undefined) url.searchParams.set("pitch", state.pitch.toFixed(1));
  if (state.handedness) url.searchParams.set("handedness", state.handedness);
  if (state.stator) url.searchParams.set("stator", state.stator);
  if (state.statorAngle !== undefined) url.searchParams.set("stator_angle", state.statorAngle.toString());
  if (state.statorType) url.searchParams.set("stator_type", state.statorType);
  if (state.supplyV !== undefined) url.searchParams.set("supply_v", state.supplyV.toFixed(1));
  if (state.tetherFt !== undefined) url.searchParams.set("tether_ft", state.tetherFt.toString());
  if (state.tetherAwg !== undefined) url.searchParams.set("tether_awg", state.tetherAwg.toString());
  return url.toString();
}

function clampNumber(val: unknown, min: number, max: number): number | undefined {
  if (typeof val === "string") {
    const num = parseFloat(val);
    if (!Number.isFinite(num)) return undefined;
    return Math.max(min, Math.min(max, num));
  }
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.max(min, Math.min(max, val));
  }
  return undefined;
}

export function sanitizeSimUrlState(state: SimUrlState): SimUrlState {
  const clean: SimUrlState = { ...state };
  if (clean.pitch !== undefined) {
    clean.pitch = clampNumber(clean.pitch, -45, 45);
  }
  if (clean.supplyV !== undefined) {
    clean.supplyV = clampNumber(clean.supplyV, 0, 24);
  }
  if (clean.tetherFt !== undefined) {
    clean.tetherFt = clampNumber(clean.tetherFt, 0, 100);
  }
  if (clean.tetherAwg !== undefined) {
    const awg = clampNumber(clean.tetherAwg, 10, 30);
    clean.tetherAwg = awg !== undefined ? Math.round(awg) : undefined;
  }
  if (clean.statorAngle !== undefined) {
    clean.statorAngle = clampNumber(clean.statorAngle, -30, 30);
  }
  if ((clean as any).rpm !== undefined) {
    (clean as any).rpm = clampNumber((clean as any).rpm, -10000, 10000);
  }
  if ((clean as any).throttle !== undefined) {
    (clean as any).throttle = clampNumber((clean as any).throttle, -1, 1);
  }
  return clean;
}

export function parseSimStateFromUrl(searchOrUrl?: string): SimUrlState {
  let search = "";
  if (searchOrUrl !== undefined) {
    if (searchOrUrl.includes("?")) {
      search = searchOrUrl.slice(searchOrUrl.indexOf("?"));
    } else {
      search = searchOrUrl;
    }
  } else if (typeof window !== "undefined") {
    search = window.location.search;
  }

  const params = new URLSearchParams(search);
  const stateEncoded = params.get("state");
  if (stateEncoded) {
    try {
      const decodedJson = typeof atob === "function"
        ? atob(stateEncoded)
        : (globalThis as any).Buffer?.from(stateEncoded, "base64").toString("utf-8");
      if (decodedJson) {
        return sanitizeSimUrlState(JSON.parse(decodedJson) as SimUrlState);
      }
    } catch {
      return {};
    }
  }

  const state: SimUrlState = {};
  const preset = params.get("preset");
  if (preset) state.preset = preset;
  const vehicle = params.get("vehicle");
  if (vehicle) state.vehicle = vehicle;
  const pitch = params.get("pitch");
  if (pitch) {
    const val = clampNumber(pitch, -45, 45);
    if (val !== undefined) state.pitch = val;
  }
  const handedness = params.get("handedness");
  if (handedness === "CW" || handedness === "CCW") state.handedness = handedness;
  const stator = params.get("stator");
  if (stator === "slotted" || stator === "solid" || stator === "none") state.stator = stator;
  const statorAngle = params.get("stator_angle");
  if (statorAngle) {
    const val = clampNumber(statorAngle, -30, 30);
    if (val !== undefined) state.statorAngle = val;
  }
  const statorType = params.get("stator_type");
  if (statorType === "slotted" || statorType === "solid" || statorType === "none") state.statorType = statorType;
  const supplyV = params.get("supply_v");
  if (supplyV) {
    const val = clampNumber(supplyV, 0, 24);
    if (val !== undefined) state.supplyV = val;
  }
  const tetherFt = params.get("tether_ft");
  if (tetherFt) {
    const val = clampNumber(tetherFt, 0, 100);
    if (val !== undefined) state.tetherFt = val;
  }
  const tetherAwg = params.get("tether_awg");
  if (tetherAwg) {
    const val = clampNumber(tetherAwg, 10, 30);
    if (val !== undefined) state.tetherAwg = Math.round(val);
  }
  const rpm = params.get("rpm");
  if (rpm) {
    const val = clampNumber(rpm, -10000, 10000);
    if (val !== undefined) (state as any).rpm = val;
  }
  const throttle = params.get("throttle");
  if (throttle) {
    const val = clampNumber(throttle, -1, 1);
    if (val !== undefined) (state as any).throttle = val;
  }
  return state;
}
