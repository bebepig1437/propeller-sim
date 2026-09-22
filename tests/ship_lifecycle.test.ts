import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseSimStateFromUrl,
  serializeSimStateToUrl,
  type SimUrlState
} from "../src/core/urlState";
import {
  SPEC_OPERATING_POINTS,
  MASTER_VALIDATION_LEDGER,
  generateGpuCpuDivergenceSeries,
  XROTOR_J_SWEEP,
  rk4SurgeTrajectory
} from "../src/validation";

describe("Ship Lifecycle, PWA Manifest, URL State & Validation Bounds", () => {
  const rootDir = path.resolve(__dirname, "..");

  it("url_state_roundtrip", () => {
    const initialStateVector: SimUrlState = {
      vehicle: "candidateA",
      tetherFt: 25,
      tetherAwg: 22,
      stator: "slotted",
      statorAngle: 12.5,
      statorType: "slotted",
      preset: "heavy_lift",
      supplyV: 11.5,
      thrusterLayout: [
        { id: 0, pitch: 18.0, handedness: "CW", throttle: 0.881 },
        { id: 1, pitch: 18.0, handedness: "CCW", throttle: 0.881 }
      ]
    };

    const serializedUrl = serializeSimStateToUrl(initialStateVector, "http://localhost:5173/");
    expect(serializedUrl).toContain("state=");
    expect(serializedUrl).toContain("vehicle=candidateA");
    expect(serializedUrl).toContain("tether_ft=25");

    const decodedStateVector = parseSimStateFromUrl(serializedUrl);
    expect(decodedStateVector).toEqual(initialStateVector);
  });

  it("pwa_manifest_validity", () => {
    const manifestPath = path.join(rootDir, "public", "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const rawManifest = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(rawManifest);

    expect(manifest.display).toBe("standalone");
    expect(typeof manifest.theme_color).toBe("string");
    expect(manifest.theme_color.startsWith("#")).toBe(true);
    expect(typeof manifest.background_color).toBe("string");
    expect(manifest.background_color.startsWith("#")).toBe(true);
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    for (const icon of manifest.icons) {
      expect(typeof icon.src).toBe("string");
      const relativeIconPath = icon.src.replace(/^\.\//, "");
      const resolvedIconPath = path.join(rootDir, "public", relativeIconPath);
      expect(fs.existsSync(resolvedIconPath)).toBe(true);
    }
  });

  it("validation_error_bounds", () => {
    const heavyLiftPoint = SPEC_OPERATING_POINTS.find((point) => point.label === "heavy_lift");
    expect(heavyLiftPoint).toBeDefined();
    const anchorCurrentTargetA = 1.25;
    const measuredCurrentA = heavyLiftPoint!.specCurrentA;
    const currentRelativeError = Math.abs(measuredCurrentA - anchorCurrentTargetA) / anchorCurrentTargetA;
    expect(currentRelativeError).toBeLessThanOrEqual(0.02);

    const trajectory = rk4SurgeTrajectory(1.5, 8.0, 0.01);
    expect(trajectory.length).toBeGreaterThan(10);
    const terminalVelocitySim = trajectory[trajectory.length - 1].vSim;
    const terminalVelocityRef = trajectory[trajectory.length - 1].vRef;
    const terminalVelocityRelativeError = Math.abs(terminalVelocitySim - terminalVelocityRef) / terminalVelocityRef;
    expect(terminalVelocityRelativeError).toBeLessThanOrEqual(0.05);

    const targetRiseVelocity = 0.9 * terminalVelocityRef;
    const calculateInterpolatedRiseTime = (isSim: boolean): number => {
      for (let index = 0; index < trajectory.length - 1; index++) {
        const currentVelocity = isSim ? trajectory[index].vSim : trajectory[index].vRef;
        const nextVelocity = isSim ? trajectory[index + 1].vSim : trajectory[index + 1].vRef;
        if (nextVelocity >= targetRiseVelocity) {
          const interpolationFraction = (targetRiseVelocity - currentVelocity) / (nextVelocity - currentVelocity);
          return trajectory[index].t + interpolationFraction * (trajectory[index + 1].t - trajectory[index].t);
        }
      }
      return 0;
    };

    const riseTimeSim = calculateInterpolatedRiseTime(true);
    const riseTimeRef = calculateInterpolatedRiseTime(false);
    expect(riseTimeSim).toBeGreaterThan(0);
    expect(riseTimeRef).toBeGreaterThan(0);
    const riseTimeRelativeError = Math.abs(riseTimeSim - riseTimeRef) / riseTimeRef;
    expect(riseTimeRelativeError).toBeLessThanOrEqual(0.10);

    for (const sweepPoint of XROTOR_J_SWEEP) {
      expect(sweepPoint.errKt).toBeLessThanOrEqual(0.03);
    }

    const fluidSeries = generateGpuCpuDivergenceSeries(100);
    expect(fluidSeries.length).toBe(101);
    for (const stepPoint of fluidSeries) {
      expect(stepPoint.gpuDiv).toBeLessThan(0.001);
      expect(stepPoint.cpuDiv).toBeLessThan(0.001);
      const energyRelativeDiff = Math.abs(stepPoint.gpuEnergy - stepPoint.cpuEnergy) / stepPoint.cpuEnergy;
      expect(energyRelativeDiff).toBeLessThanOrEqual(0.02);
    }

    expect(SPEC_OPERATING_POINTS.length).toBe(5);
    for (const point of SPEC_OPERATING_POINTS) {
      expect(point.specThrustN).toBeDefined();
      expect(point.specCurrentA).toBeDefined();
    }

    for (const ledgerEntry of MASTER_VALIDATION_LEDGER) {
      expect(ledgerEntry.module.length).toBeGreaterThan(0);
      expect(ledgerEntry.oracle.length).toBeGreaterThan(0);
      expect(ledgerEntry.tolerance.length).toBeGreaterThan(0);
      expect(ledgerEntry.measuredError.length).toBeGreaterThan(0);
      expect(ledgerEntry.passed).toBe(true);
    }
  });
});
