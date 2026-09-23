import type { VehicleConfig, PropellerMaterial } from '../types/vehicle';
import candidateAData from '../../public/vehicles/candidateA.json';

export async function loadVehicleConfig(vehicleId = 'candidateA'): Promise<VehicleConfig> {
  let data: VehicleConfig;
  if (vehicleId === 'candidateA') {
    data = candidateAData as unknown as VehicleConfig;
  } else if (typeof fetch === 'function' && typeof window !== 'undefined') {
    const url = `/vehicles/${vehicleId}.json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load vehicle configuration from ${url}: ${response.statusText}`);
    }
    data = (await response.json()) as VehicleConfig;
  } else {
    throw new Error(`Vehicle configuration not found: ${vehicleId}`);
  }

  if (!data.id || !data.mass || !data.motor || !data.propeller || !data.buoyancy || !data.stator) {
    throw new Error(`Invalid vehicle schema loaded for ${vehicleId}`);
  }

  return data;
}

export function computeVehicleDryMass(config: VehicleConfig, material: PropellerMaterial = 'rigid10k'): number {
  const propMass = config.mass.prop_g[material] * config.mass.motor_count;
  return config.mass.frame_g + config.mass.hardware_g + (config.mass.motor_unit_g * config.mass.motor_count) + propMass;
}

export function computeNetBuoyancyGrams(config: VehicleConfig, material: PropellerMaterial = 'rigid10k'): number {
  const displacedGrams = config.buoyancy.displaced_cm3 * (config.buoyancy.rho_kg_m3 / 1000.0);
  const dryMassGrams = computeVehicleDryMass(config, material);
  return displacedGrams - dryMassGrams;
}
