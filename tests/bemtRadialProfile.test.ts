import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { solveBemt, REVERSE_FLOW_BLEND_BAND_MS } from '../src/prop/bemt';

interface ReferenceStation {
  station: number;
  rOverR: number;
  radiusM: number;
  chordM: number;
  twistDeg: number;
  dT_dr: number;
  dQ_dr: number;
}

function loadReferenceCSV(filePath: string): ReferenceStation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const stations: ReferenceStation[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map(s => parseFloat(s.trim()));
    if (parts.length >= 7 && !isNaN(parts[0])) {
      stations.push({
        station: Math.round(parts[0]),
        rOverR: parts[1],
        radiusM: parts[2],
        chordM: parts[3],
        twistDeg: parts[4],
        dT_dr: parts[5],
        dQ_dr: parts[6]
      });
    }
  }
  return stations;
}

describe('Directive 3 — BEMT Radial Profile & Hub Loss Verification', () => {
  const fixturePath = path.resolve(__dirname, 'fixtures/candidateA_openprop_J04.csv');
  const refStations = loadReferenceCSV(fixturePath);

  it('loads 20 stations from candidateA_openprop_J04.csv fixture', () => {
    expect(refStations.length).toBe(20);
  });

  it('validates Candidate A radial loading profile against OpenProp/XROTOR reference at J=0.40', () => {
    const rpm = 4140;
    const n = rpm / 60.0;
    const D = 0.042;
    const J = 0.40;
    const Va = J * n * D; 

    const res = solveBemt(rpm, Va, {
      diameterMm: 42.0,
      hubDiameterMm: 8.0,
      blades: 3,
      pitchMm: 32.0,
      numElements: 20
    });

    expect(res.elements.length).toBe(20);

    const ktRef = 0.168;
    const etaRef = 0.451;

    const ktErr = (Math.abs(res.kt - ktRef) / ktRef) * 100.0;
    const etaErr = (Math.abs(res.efficiency - etaRef) / etaRef) * 100.0;

    console.log(`[BEMT J=0.40 Validation] Integrated Kt = ${res.kt.toFixed(4)} (ref: ${ktRef}, error: ${ktErr.toFixed(2)}%, tol: 15%)`);
    console.log(`[BEMT J=0.40 Validation] Integrated eta = ${res.efficiency.toFixed(4)} (ref: ${etaRef}, error: ${etaErr.toFixed(2)}%, tol: 10%)`);

    expect(ktErr).toBeLessThan(15.0);
    expect(etaErr).toBeLessThan(10.0);

    const R = 0.042 / 2.0;
    const Rhub = 0.008 / 2.0;
    const dr = (R - Rhub) / 20;

    for (let i = 0; i < res.elements.length; i++) {
      const elem = res.elements[i];
      const ref = refStations[i];
      const sim_dT_dr = elem.dT / dr;

      const diff = Math.abs(sim_dT_dr - ref.dT_dr);
      const percentDiff = ref.dT_dr > 1.0 ? (diff / ref.dT_dr) * 100.0 : diff;

      const isInnerSpan = elem.rOverR < 0.30;
      const stationTol = isInnerSpan ? 15.0 : 25.0;

      if (isInnerSpan) {
        console.log(`[Inner Span Station ${i}] r/R = ${elem.rOverR.toFixed(3)} | sim dT/dr = ${sim_dT_dr.toFixed(2)}, ref = ${ref.dT_dr.toFixed(2)} | error = ${percentDiff.toFixed(2)}% (tol: 15%)`);
      }

      expect(
        percentDiff,
        `Station ${i} (r/R=${elem.rOverR.toFixed(3)}) dT/dr mismatch: sim=${sim_dT_dr.toFixed(2)}, ref=${ref.dT_dr.toFixed(2)} (diff=${percentDiff.toFixed(1)}%, tol=${stationTol}%)`
      ).toBeLessThan(stationTol);
    }
  });

  it('asserts continuity across reverse-flow transition band: |dT/dr| and |dQ/dr| change < 1% per 0.001 m/s step', () => {
    const rpm = 4140;
    const bandHalf = REVERSE_FLOW_BLEND_BAND_MS; 
    const stepSize = 0.001; 

    const numSteps = Math.floor((2 * bandHalf) / stepSize);
    let prevElem: { dT: number; dQ: number } | null = null;

    for (let s = 0; s <= numSteps; s++) {
      const vInflow = -bandHalf + s * stepSize;
      const res = solveBemt(rpm, vInflow, {
        diameterMm: 42.0,
        hubDiameterMm: 8.0,
        blades: 3,
        numElements: 20
      });

      const midStation = res.elements[10];
      if (prevElem !== null) {
        const deltaT = Math.abs(midStation.dT - prevElem.dT);
        const meanT = Math.max(0.01, (Math.abs(midStation.dT) + Math.abs(prevElem.dT)) * 0.5);
        const pctChangeT = (deltaT / meanT) * 100.0;

        const deltaQ = Math.abs(midStation.dQ - prevElem.dQ);
        const meanQ = Math.max(0.0001, (Math.abs(midStation.dQ) + Math.abs(prevElem.dQ)) * 0.5);
        const pctChangeQ = (deltaQ / meanQ) * 100.0;

        expect(
          pctChangeT,
          `Discontinuity detected at vInflow=${vInflow.toFixed(3)} m/s: dT changed by ${pctChangeT.toFixed(3)}% in 0.001 m/s step`
        ).toBeLessThan(1.0);

        expect(
          pctChangeQ,
          `Discontinuity detected at vInflow=${vInflow.toFixed(3)} m/s: dQ changed by ${pctChangeQ.toFixed(3)}% in 0.001 m/s step`
        ).toBeLessThan(1.0);
      }

      prevElem = { dT: midStation.dT, dQ: midStation.dQ };
    }
  });

  it('validates no force discontinuity > 5% across U_inf sweep at 0.02, 0.05, 0.08 m/s', () => {
    const rpm = 4140;
    const testSpeeds = [0.02, 0.05, 0.08];
    const results = testSpeeds.map(v => solveBemt(rpm, v, {
      diameterMm: 42.0,
      hubDiameterMm: 8.0,
      blades: 3,
      numElements: 20
    }));

    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const curr = results[i];
      expect(Number.isFinite(curr.thrustN)).toBe(true);
      expect(Number.isFinite(curr.torqueNm)).toBe(true);

      const deltaV = testSpeeds[i] - testSpeeds[i - 1];
      const meanT = (Math.abs(curr.thrustN) + Math.abs(prev.thrustN)) * 0.5;
      const relJump = Math.abs(curr.thrustN - prev.thrustN) / meanT;

      expect(
        relJump,
        `Force jumped by ${(relJump * 100).toFixed(2)}% between U_inf=${testSpeeds[i-1]} and ${testSpeeds[i]}`
      ).toBeLessThan(0.05);
    }
  });
});
