import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseSimStateFromUrl, serializeSimStateToUrl, type SimUrlState } from "../src/core/urlState";
import { CanvasRecorder } from "../src/ui/recorder";
import {
  SPEC_OPERATING_POINTS,
  MASTER_VALIDATION_LEDGER,
  generateGpuCpuDivergenceSeries,
  XROTOR_J_SWEEP
} from "../src/validation";

describe("Phase 9 — Ship, PWA, URL State & Validation Suite", () => {
  const rootDir = path.resolve(__dirname, "..");

  describe("1. PWA & Offline Readiness", () => {
    it("public/manifest.webmanifest exists and contains valid installable configuration", () => {
      const manifestPath = path.join(rootDir, "public", "manifest.webmanifest");
      expect(fs.existsSync(manifestPath)).toBe(true);

      const content = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(content);

      expect(manifest.name).toBe("SeaPerch Propeller & Vehicle Simulator");
      expect(manifest.short_name).toBe("SeaPerch Sim");
      expect(manifest.display).toBe("standalone");
      expect(manifest.theme_color).toBe("#030712");
      expect(manifest.background_color).toBe("#030712");
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    });

    it("public/sw.js exists and implements service worker caching hooks", () => {
      const swPath = path.join(rootDir, "public", "sw.js");
      expect(fs.existsSync(swPath)).toBe(true);

      const content = fs.readFileSync(swPath, "utf-8");
      expect(content).toContain("install");
      expect(content).toContain("fetch");
      expect(content).toContain("caches.open");
    });

    it("public/icon.svg exists as an SVG vector asset", () => {
      const iconPath = path.join(rootDir, "public", "icon.svg");
      expect(fs.existsSync(iconPath)).toBe(true);
      const content = fs.readFileSync(iconPath, "utf-8");
      expect(content).toContain("<svg");
    });
  });

  describe("2. URL State Encoding & Restoration", () => {
    it("serializes full state to URL query parameters", () => {
      const state: SimUrlState = {
        preset: "heavy_lift",
        vehicle: "candidateA",
        pitch: 16.5,
        handedness: "CW",
        stator: "slotted",
        supplyV: 11.5,
        tetherFt: 25,
        tetherAwg: 22
      };

      const url = serializeSimStateToUrl(state, "http://localhost:5173/");
      expect(url).toContain("preset=heavy_lift");
      expect(url).toContain("vehicle=candidateA");
      expect(url).toContain("pitch=16.5");
      expect(url).toContain("handedness=CW");
      expect(url).toContain("stator=slotted");
      expect(url).toContain("supply_v=11.5");
      expect(url).toContain("tether_ft=25");
      expect(url).toContain("tether_awg=22");
    });

    it("restores exact simulation configuration from search query string", () => {
      const search = "?preset=breakout&vehicle=candidateA&pitch=14.0&handedness=CCW&stator=solid&supply_v=12.0&tether_ft=15&tether_awg=24";
      const restored = parseSimStateFromUrl(search);

      expect(restored.preset).toBe("breakout");
      expect(restored.vehicle).toBe("candidateA");
      expect(restored.pitch).toBe(14.0);
      expect(restored.handedness).toBe("CCW");
      expect(restored.stator).toBe("solid");
      expect(restored.supplyV).toBe(12.0);
      expect(restored.tetherFt).toBe(15);
      expect(restored.tetherAwg).toBe(24);
    });

    it("handles partial or empty search strings gracefully", () => {
      const empty = parseSimStateFromUrl("");
      expect(empty.preset).toBeUndefined();
      expect(empty.pitch).toBeUndefined();

      const partial = parseSimStateFromUrl("?preset=cruise");
      expect(partial.preset).toBe("cruise");
      expect(partial.pitch).toBeUndefined();
    });

    it("handles malformed or out-of-range URL parameters without corruption", () => {
      const malformed = parseSimStateFromUrl("?rpm=99999&throttle=abc&pitch=120&supply_v=999");
      expect((malformed as any).rpm).toBe(10000);
      expect((malformed as any).throttle).toBeUndefined();
      expect(malformed.pitch).toBe(45);
      expect(malformed.supplyV).toBe(24);
    });
  });

  describe("3. Canvas Video Recorder Contract", () => {
    it("instantiates recorder with idle state", () => {
      const recorder = new CanvasRecorder();
      expect(recorder.recording).toBe(false);
    });

    it("fails safely if Canvas capture is attempted outside browser", () => {
      const recorder = new CanvasRecorder();
      const mockCanvas = {} as HTMLCanvasElement;
      const started = recorder.start(mockCanvas);
      expect(started).toBe(false);
    });
  });

  describe("4. Final Validation Suite Data & Master Ledger", () => {
    it("verifies all 5 Candidate A operating points exist with spec targets", () => {
      expect(SPEC_OPERATING_POINTS.length).toBe(5);
      const breakout = SPEC_OPERATING_POINTS.find(p => p.label === "breakout");
      expect(breakout).toBeDefined();
      expect(breakout?.specThrustN).toBe(4.73);
      expect(breakout?.specCurrentA).toBe(1.41);

      const dive = SPEC_OPERATING_POINTS.find(p => p.label === "full_dive");
      expect(dive).toBeDefined();
      expect(dive?.specThrustN).toBe(-2.82);
      expect(dive?.specCurrentA).toBe(1.18);
    });

    it("verifies XROTOR J-sweep dataset contains error bound columns", () => {
      expect(XROTOR_J_SWEEP.length).toBe(11);
      XROTOR_J_SWEEP.forEach(row => {
        expect(row.J).toBeGreaterThanOrEqual(0.0);
        expect(row.errKt).toBeGreaterThan(0.0);
      });
    });

    it("verifies Master Validation Ledger covers all physics modules with 100% pass status", () => {
      expect(MASTER_VALIDATION_LEDGER.length).toBeGreaterThanOrEqual(10);
      MASTER_VALIDATION_LEDGER.forEach(entry => {
        expect(entry.module.length).toBeGreaterThan(0);
        expect(entry.oracle.length).toBeGreaterThan(0);
        expect(entry.tolerance.length).toBeGreaterThan(0);
        expect(entry.measuredError.length).toBeGreaterThan(0);
        expect(entry.passed).toBe(true);
      });
    });

    it("generates 100-step GPU vs CPU divergence and energy series with bounded drift", () => {
      const series = generateGpuCpuDivergenceSeries(100);
      expect(series.length).toBe(101);

      series.forEach(pt => {
        expect(pt.gpuEnergy).toBeGreaterThan(0.4);
        expect(pt.cpuEnergy).toBeGreaterThan(0.4);
        expect(pt.gpuDiv).toBeLessThan(0.001);
        expect(pt.cpuDiv).toBeLessThan(0.001);
        const relDiff = Math.abs(pt.gpuEnergy - pt.cpuEnergy) / pt.cpuEnergy;
        expect(relDiff).toBeLessThan(0.02);
      });
    });
  });
});
