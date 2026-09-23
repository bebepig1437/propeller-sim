import type { VehicleConfig, PropellerMaterial } from '../types/vehicle';

export async function loadVehicleConfig(vehicleId = 'candidateA'): Promise<VehicleConfig> {
  const url = `/vehicles/${vehicleId}.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load vehicle configuration from ${url}: ${response.statusText}`);
  }
  const data = (await response.json()) as VehicleConfig;

  // Validate critical structural fields
  if (!data.id || !data.mass || !data.motor || !data.propeller || !data.buoyancy) {
    throw new Error(`Invalid vehicle schema loaded from ${url}`);
  }

  return data;
}

export function computeVehicleDryMass(config: VehicleConfig, material: PropellerMaterial = 'rigid10k'): number {
  const propMass = config.mass.prop_g[material] * config.mass.motor_count;
  return config.mass.frame_g + config.mass.hardware_g + (config.mass.motor_unit_g * config.mass.motor_count) + propMass;
}

export function computeNetBuoyancyGrams(config: VehicleConfig, material: PropellerMaterial = 'rigid10k'): number {
  // Displaced volume in cm3 with rho = 1000 kg/m3 (1.0 g/cm3)
  const displacedGrams = config.buoyancy.displaced_cm3 * (config.buoyancy.rho_kg_m3 / 1000.0);
  const dryMassGrams = computeVehicleDryMass(config, material);
  return displacedGrams - dryMassGrams;
}
