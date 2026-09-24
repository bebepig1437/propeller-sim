import * as THREE from 'three';

export type PropMaterialId = 'rigid10k' | 'pa12cf15' | 'petg';

export interface PropMaterialSpec {
  id: PropMaterialId;
  label: string;
  color: number;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenColor: number;
  transmission: number;
  thicknessM: number;
  layerLinePeriodM: number;
  layerLineStrength: number;
  speckleStrength: number;
  roughnessMultiplier: number;
}

export const PROP_MATERIALS: Record<PropMaterialId, PropMaterialSpec> = {
  rigid10k: {
    id: 'rigid10k',
    label: 'Rigid 10K (SLA)',
    color: 0xf2ece0,
    roughness: 0.18,
    metalness: 0.0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    sheen: 0.15,
    sheenColor: 0xffffff,
    transmission: 0.04,
    thicknessM: 0.002,
    layerLinePeriodM: 0.00005,
    layerLineStrength: 0.15,
    speckleStrength: 0.0,
    roughnessMultiplier: 1.0
  },
  pa12cf15: {
    id: 'pa12cf15',
    label: 'PA12-CF15 (FDM)',
    color: 0x2e3238,
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    sheen: 0.4,
    sheenColor: 0x3a3e44,
    transmission: 0.0,
    thicknessM: 0.0,
    layerLinePeriodM: 0.00008,
    layerLineStrength: 0.65,
    speckleStrength: 0.04,
    roughnessMultiplier: 1.35
  },
  petg: {
    id: 'petg',
    label: 'PETG (FDM)',
    color: 0xc8d8e0,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    sheen: 0.05,
    sheenColor: 0xffffff,
    transmission: 0.08,
    thicknessM: 0.002,
    layerLinePeriodM: 0.0002,
    layerLineStrength: 0.5,
    speckleStrength: 0.0,
    roughnessMultiplier: 1.15
  }
};

/* PRNG noise for procedural texture synthesis paper: Permutation polynomial hash, McElroy (1988) */
function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;

  /* Hermite quintic smoothstep paper: Perlin (2002) */
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = hash2D(i, j);
  const n10 = hash2D(i + 1, j);
  const n01 = hash2D(i, j + 1);
  const n11 = hash2D(i + 1, j + 1);

  const nx0 = n00 * (1 - sx) + n10 * sx;
  const nx1 = n01 * (1 - sx) + n11 * sx;

  return nx0 * (1 - sy) + nx1 * sy;
}

export function generateLayerNormalMap(spec: PropMaterialSpec, isHub = false): THREE.DataTexture {
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  const periodPx = 8;
  const amp = 0.5 * spec.layerLineStrength;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      /* Sinusoidal normal perturbation for FDM/SLA layer lines paper: Blinn (1978) */
      const coord = isHub ? x : y;
      const phase = (coord / periodPx) * 2.0 * Math.PI;
      let dN = amp * Math.sin(phase);

      if (spec.id === 'pa12cf15') {
        const grain = (smoothNoise(x * 0.15, y * 0.15) - 0.5) * 0.35;
        dN += grain;
      }

      let nx = isHub ? dN : 0.0;
      let ny = isHub ? 0.0 : dN;
      let nz = Math.sqrt(Math.max(0.01, 1.0 - nx * nx - ny * ny));

      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      data[idx + 0] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  const totalPeriods = (isHub ? 0.016 : 0.017) / spec.layerLinePeriodM;
  const numTiles = Math.max(1, Math.round(totalPeriods / (size / periodPx)));
  const repeatU = isHub ? numTiles : 2;
  const repeatV = isHub ? 2 : numTiles;

  texture.repeat.set(repeatU, repeatV);
  texture.needsUpdate = true;
  return texture;
}

export function generateSpeckleTexture(spec: PropMaterialSpec): THREE.DataTexture | null {
  if (spec.speckleStrength <= 0) return null;

  const size = 256;
  const data = new Uint8Array(size * size * 4);

  const baseR = (spec.color >> 16) & 255;
  const baseG = (spec.color >> 8) & 255;
  const baseB = spec.color & 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      /* Two-octave fractional Brownian motion for carbon-fiber speckle paper: Mandelbrot (1982) */
      const n1 = smoothNoise(x * 0.1, y * 0.1);
      const n2 = smoothNoise(x * 0.25, y * 0.25) * 0.5;
      const noiseVal = (n1 + n2) / 1.5 - 0.5;

      const factor = 1.0 + noiseVal * spec.speckleStrength * 2.0;

      data[idx + 0] = Math.min(255, Math.max(0, Math.round(baseR * factor)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(baseG * factor)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(baseB * factor)));
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.needsUpdate = true;
  return texture;
}

export function createPropellerMaterialGroup(spec: PropMaterialSpec): {
  bladeMaterial: THREE.MeshPhysicalMaterial;
  hubMaterial: THREE.MeshPhysicalMaterial;
} {
  const bladeNormalMap = generateLayerNormalMap(spec, false);
  const hubNormalMap = generateLayerNormalMap(spec, true);
  hubNormalMap.rotation = Math.PI / 2;

  const bladeSpeckle = generateSpeckleTexture(spec);
  const hubSpeckle = generateSpeckleTexture(spec);

  const bladeMaterial = new THREE.MeshPhysicalMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    sheen: spec.sheen,
    sheenColor: spec.sheenColor,
    transmission: spec.transmission,
    thickness: spec.thicknessM,
    normalMap: bladeNormalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    map: bladeSpeckle
  });

  const hubMaterial = new THREE.MeshPhysicalMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    sheen: spec.sheen,
    sheenColor: spec.sheenColor,
    transmission: spec.transmission,
    thickness: spec.thicknessM,
    normalMap: hubNormalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    map: hubSpeckle
  });

  return { bladeMaterial, hubMaterial };
}

export function applyMaterial(propellerRoot: THREE.Group, spec: PropMaterialSpec): void {
  const { bladeMaterial, hubMaterial } = createPropellerMaterialGroup(spec);

  propellerRoot.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const isBlade = child.name === 'bladeMesh' || child.geometry.attributes.position.count > 2000;
      const oldMat = child.material;

      if (isBlade) {
        child.material = bladeMaterial;
      } else {
        child.material = hubMaterial;
      }

      if (oldMat instanceof THREE.MeshStandardMaterial) {
        if (oldMat.normalMap) oldMat.normalMap.dispose();
        if (oldMat.map) oldMat.map.dispose();
        oldMat.dispose();
      } else if (oldMat instanceof THREE.Material) {
        oldMat.dispose();
      }
    }
  });

  (propellerRoot as THREE.Group & { currentSpec?: PropMaterialSpec }).currentSpec = spec;
}
