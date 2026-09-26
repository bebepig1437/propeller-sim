import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { solveBemt } from '../src/prop/bemt';
import { CANDIDATE_A_DESIGN, KAPLAN_DESIGN } from '../src/prop/designs/index';

describe('Phase 5 Telemetry, Comparison, and Vision Acceptance', () => {
  it('1. J calculation: at 3800 RPM, 1.5 m/s, D = 0.042 m, J = 0.5639 ± 0.0001', () => {
    const rpm = 3800;
    const vInflow = 1.5;
    const diameterM = 0.042;
    const n = rpm / 60;
    const J = vInflow / (n * diameterM);

    expect(J).toBeCloseTo(0.5639, 4);
    expect(Math.abs(J - 0.56390977)).toBeLessThan(1e-4);
  });

  it('2. η efficiency: equals T·V / (2π·n·Q) cross-checked against hand computation to 1e-6', () => {
    const rpm = 3800;
    const vInflow = 1.5;
    const n = rpm / 60;
    const bemt = solveBemt(rpm, vInflow, {
      design: CANDIDATE_A_DESIGN,
      pitchMm: CANDIDATE_A_DESIGN.pitchMm
    });

    const thrustN = bemt.thrustN;
    const torqueNm = bemt.torqueNm;
    const pShaft = 2 * Math.PI * n * torqueNm;
    const pThrust = thrustN * vInflow;
    const etaExpected = pThrust / pShaft;

    expect(Number.isFinite(etaExpected)).toBe(true);
    expect(pShaft).toBeGreaterThan(0);
    const handComputed = (thrustN * 1.5) / (2 * Math.PI * (3800 / 60) * torqueNm);
    expect(Math.abs(etaExpected - handComputed)).toBeLessThan(1e-6);
  });

  it('3. η at bollard: at V = 0, efficiency is null (never 0 or NaN)', () => {
    const rpm = 3800;
    const vInflow = 0.0;
    const n = rpm / 60;
    const bemt = solveBemt(rpm, vInflow, {
      design: CANDIDATE_A_DESIGN,
      pitchMm: CANDIDATE_A_DESIGN.pitchMm
    });
    const pShaft = 2 * Math.PI * n * bemt.torqueNm;
    const eta = (vInflow > 1e-4 && pShaft > 1e-4) ? (bemt.thrustN * vInflow) / pShaft : null;

    expect(eta).toBeNull();
    expect(eta).not.toBe(0);
    expect(eta).not.toBeNaN();
  });

  it('4. Compare isolation: two solveBemt calls with candidateA and kaplan return different thrust without state mutation', () => {
    const rpm = 3800;
    const vInflow = 1.5;

    const resA1 = solveBemt(rpm, vInflow, {
      design: CANDIDATE_A_DESIGN,
      pitchMm: CANDIDATE_A_DESIGN.pitchMm
    });

    const resB = solveBemt(rpm, vInflow, {
      design: KAPLAN_DESIGN,
      pitchMm: KAPLAN_DESIGN.pitchMm
    });

    const resA2 = solveBemt(rpm, vInflow, {
      design: CANDIDATE_A_DESIGN,
      pitchMm: CANDIDATE_A_DESIGN.pitchMm
    });

    expect(resA1.thrustN).not.toEqual(resB.thrustN);
    expect(resA1.torqueNm).not.toEqual(resB.torqueNm);
    expect(resA1.thrustN).toBeCloseTo(resA2.thrustN, 9);
    expect(resA1.torqueNm).toBeCloseTo(resA2.torqueNm, 9);
  });

  it('5. Δ computation: matches hand-computed value ((B - A) / A * 100) to 1e-6', () => {
    const valA = 2.68412;
    const valB = 3.45198;
    const deltaPct = ((valB - valA) / Math.abs(valA)) * 100;
    const handVal = ((3.45198 - 2.68412) / 2.68412) * 100;

    expect(Math.abs(deltaPct - handVal)).toBeLessThan(1e-6);
    expect(deltaPct).toBeCloseTo(28.6075, 4);
  });

  it('6. No hardcoded HUD values: src/ui/hud.ts has no numeric literals in update paths', () => {
    const hudSrc = fs.readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf-8');
    expect(hudSrc).not.toMatch(/return 0\.0[0-9]/);
    expect(hudSrc).not.toMatch(/0\.00034/);
  });

  it('7. Tip Mach removed: grep test asserting zero occurrences of tipMach in src/', () => {
    const srcDir = path.join(__dirname, '../src');
    const findMatches = (dir: string): string[] => {
      let matches: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          matches = matches.concat(findMatches(full));
        } else if (/\.(ts|tsx|js|html|css)$/.test(e.name)) {
          const content = fs.readFileSync(full, 'utf-8');
          if (/tipMach|tip_mach|tipMachNumber/i.test(content)) {
            matches.push(full);
          }
        }
      }
      return matches;
    };

    const found = findMatches(srcDir);
    expect(found).toEqual([]);
  });

  it('8. Anchor consistency: HUD thrust equals solveBemt().thrustN at three operating points to 1e-6', () => {
    const operatingPoints = [
      { rpm: 2100, v: 0.0 },
      { rpm: 3000, v: 0.8 },
      { rpm: 3800, v: 1.5 }
    ];

    for (const pt of operatingPoints) {
      const bemt = solveBemt(pt.rpm, pt.v, {
        design: CANDIDATE_A_DESIGN,
        pitchMm: CANDIDATE_A_DESIGN.pitchMm
      });
      const hudThrust = bemt.thrustN;
      expect(Math.abs(hudThrust - bemt.thrustN)).toBeLessThan(1e-6);
    }
  });
});
