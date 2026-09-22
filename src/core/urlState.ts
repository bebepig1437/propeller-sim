export interface SimUrlState {
  preset?: string;
  vehicle?: string;
  pitch?: number;
  handedness?: "CW" | "CCW";
  stator?: "slotted" | "solid" | "none";
  supplyV?: number;
  tetherFt?: number;
  tetherAwg?: number;
}

export function serializeSimStateToUrl(state: SimUrlState, baseUrl?: string): string {
  const url = new URL(baseUrl || (typeof window !== "undefined" ? window.location.href : "http://localhost:5173/"));
  if (state.preset) url.searchParams.set("preset", state.preset);
  if (state.vehicle) url.searchParams.set("vehicle", state.vehicle);
  if (state.pitch !== undefined) url.searchParams.set("pitch", state.pitch.toFixed(1));
  if (state.handedness) url.searchParams.set("handedness", state.handedness);
  if (state.stator) url.searchParams.set("stator", state.stator);
  if (state.supplyV !== undefined) url.searchParams.set("supply_v", state.supplyV.toFixed(1));
  if (state.tetherFt !== undefined) url.searchParams.set("tether_ft", state.tetherFt.toString());
  if (state.tetherAwg !== undefined) url.searchParams.set("tether_awg", state.tetherAwg.toString());
  return url.toString();
}

export function parseSimStateFromUrl(searchString?: string): SimUrlState {
  const search = searchString !== undefined
    ? searchString
    : (typeof window !== "undefined" ? window.location.search : "");
  const params = new URLSearchParams(search);
  const state: SimUrlState = {};
  const preset = params.get("preset");
  if (preset) state.preset = preset;
  const vehicle = params.get("vehicle");
  if (vehicle) state.vehicle = vehicle;
  const pitch = params.get("pitch");
  if (pitch) {
    const val = parseFloat(pitch);
    if (!isNaN(val)) state.pitch = val;
  }
  const handedness = params.get("handedness");
  if (handedness === "CW" || handedness === "CCW") state.handedness = handedness;
  const stator = params.get("stator");
  if (stator === "slotted" || stator === "solid" || stator === "none") state.stator = stator;
  const supplyV = params.get("supply_v");
  if (supplyV) {
    const val = parseFloat(supplyV);
    if (!isNaN(val)) state.supplyV = val;
  }
  const tetherFt = params.get("tether_ft");
  if (tetherFt) {
    const val = parseFloat(tetherFt);
    if (!isNaN(val)) state.tetherFt = val;
  }
  const tetherAwg = params.get("tether_awg");
  if (tetherAwg) {
    const val = parseInt(tetherAwg, 10);
    if (!isNaN(val)) state.tetherAwg = val;
  }
  return state;
}
