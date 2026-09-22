# Phase 8 — Manual Verification & Gate Record

Phase 8's acceptance list mixes things a test runner can prove and things only a
human with a GPU can certify. This document separates them, records how each gate
was verified, and states plainly which ones are **still open**.

Authority: `docs/PHASE_DOCUMENT_FINAL.md` → *Phase 8 — Performance and Robustness*.

| Gate (doc wording) | Verified by | Status |
| :--- | :--- | :--- |
| 60fps sustained at 1920×1080 default on integrated graphics | Gate A (manual, browser) | **OPEN** — no named-GPU measurement exists |
| Zero memory leakage over 10 minutes continuous run | `npm run test:long` | Automated (see Gate D) |
| Seamless recovery from WebGPU device loss and background tab state | Gates B1–B3 | B1/B3 automated, B2 manual |
| Screen recording shows zero layout shifts and zero visible resolution pops | Gate C (manual) | **OPEN** — procedure below, no recording yet |

The remaining open rows are the two "⚠️" gaps from the Phase 8 review. Both need a
human at a machine; nothing in the repository can substitute for them.

---

## Gate A — 60fps at 1920×1080 on integrated graphics

**Status: OPEN.** Do not quote a number for this gate until it is filled in.

What exists today:

- `scripts/benchmark-frames.ts` measures the **simulation-side** frame cost for the
  default grid (1024×512) and prints p50/p95/p99. Run it with
  `npx vitest run scripts/benchmark-frames.ts`. This is a budget check, **not** the
  acceptance number: it excludes rasterisation, the 3D water surface, overlays, and
  compositing.
- The in-browser procedure is printed at the end of that same run (and repeated in
  `README.md`).

To close the gate:

1. Run the browser procedure on the target machine at exactly 1920×1080, DPR 1.
2. Repeat with the **Stress Benchmark (2048×1024)** preset for the fps-floor row.
3. Record the result in `README.md` under *Performance Benchmarks* as a row of the
   form: `GPU model | date | p50 frame ms | p95 frame ms | FPS`.

Until then the README labels those rows as **targets, unmeasured**, because a
target presented as a measurement is the failure mode this whole review exists to
prevent.

---

## Gate B — Device loss and backgrounding

### B1 — Tier walk (automated)

`tests/phase8.test.ts` §5:

- The coordinator walks `WebGPU → WebGL2 → CPU` using a **real** reinit probe
  (`GpuFluidSolver.reinitGpuPipeline()`), not a counter. On the test host there is
  no compute device, so the probe genuinely fails — which is the point.
- Each tier transition is asserted to reach the solver (`solver.renderTier`), not
  just a callback.
- After landing on CPU, the harness asserts the solver **runs**: finite metrics for
  30 steps, `max |divergence| < 1e-3` (Phase 1's oracle), and finite `u`/`v`/`dye`.

### B2 — Live device loss (manual)

**Status: procedure defined, not yet performed on hardware.**

Triggers now wired in `App.attachDeviceLossListeners()`:

- WebGPU: `GPUDevice.lost` — feature-detected as
  `renderer.backend.device ?? renderer._device`.
- WebGL2: `webglcontextlost` on the canvas.
- Manual: **Shift+D** invokes the tier walk on demand.

Walkthrough:

1. `npm run dev`, press RUN, confirm the HUD shows no `TIER:` readout (i.e. WebGPU).
2. Press **Shift+D** once → console `[RecoveryCoordinator] WebGPU reinit failed (1/2)`;
   still WebGPU, no HUD change. The attempt budget is one.
3. Press **Shift+D** again → console `…falling back to WebGL2`; the HUD shows
   `TIER: WebGL2` in amber. Water and vehicle keep animating; numbers keep updating.
4. Press **Shift+D** a third time → `TIER: CPU` in red. Confirm the simulation is
   still numerically sane (values change, nothing goes `NaN`).
5. Reload to restore.

For a genuine (not simulated) loss, use the browser's DevTools to force it
(`chrome://gpu` → context loss, or the WebGPU `WEBGPU` device destroy in the app's
own console), then confirm the same console lines appear.

**Known limitation, stated honestly:** the tier walk re-binds the *solver* and the
reported tier. It does not hot-swap a live three.js renderer/context on an
already-mounted canvas. The app therefore degrades to correct CPU reference numbers
rather than pretending GPU execution continued.

### B3 — Tab backgrounding (automated)

`tests/phase8.test.ts` §5 asserts `visibilitychange` pauses and resumes cleanly
(`isPaused`, `onPause`, `onResume`).

---

## Gate C — 10-minute recording: no layout shifts, no resolution pops

**Status: OPEN.** Procedure below; no recording has been made.

### C1 — Layout-shift check (do this instead of eyeballing video)

The invariant is that the stage, palette, inspector, HUD strip, and RUN button
never change their bounding box during a run. That is directly measurable, and more
reliably than by watching frames:

```js
// DevTools console, during a 10-minute RUN at 1920x1080
(() => {
  const ids = ['.sim-palette', '.sim-inspector', '.sim-hud', '.sim-run-button', '#viewport'];
  const base = {}, worst = {};
  ids.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    base[sel] = el.getBoundingClientRect();
    worst[sel] = 0;
  });
  const tick = () => {
    for (const sel of Object.keys(base)) {
      const r = document.querySelector(sel).getBoundingClientRect();
      const d = Math.max(
        Math.abs(r.x - base[sel].x), Math.abs(r.y - base[sel].y),
        Math.abs(r.width - base[sel].width), Math.abs(r.height - base[sel].height)
      );
      if (d > worst[sel]) worst[sel] = d;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(() => console.log('max bounding-box drift (px):', worst), 600000);
})()
```

Pass criterion: every drift value is `0`. Anything non-zero means a layout shift and
the `contain: layout size` sweep is incomplete.

### C2 — Resolution-pop check

Resolution transitions are cross-faded over 250 ms by `WaterSurface`
(`crossfadeRemainingSec`, unit-tested in `tests/phase8.test.ts` §3). To confirm it
visually:

1. Record a 10-minute run that includes at least two scale transitions. The easiest
   way to force them is the Stress Benchmark preset followed by returning to the
   default operating point, or throttling the CPU in DevTools.
2. Record with an OS tool (QuickTime/OBS). The app has **no in-app WebM capture yet** —
   `MediaRecorder` capture is a Phase 9 deliverable, not Phase 8.
3. Diff the stage region frame-to-frame and look for a single-frame discontinuity:

```bash
# 1 fps sample of the stage region, cropped just below the HUD strip
ffmpeg -i run-10min.webm -vf "crop=1400:800:260:80,fps=1" -f image2 stage-%04d.png

# Mean absolute difference between consecutive sampled frames. A 250 ms cross-fade
# spreads the change over ~15 frames; a pop concentrates it into one spike.
ffmpeg -i run-10min.webm -vf "crop=1400:800:260:80,tblend=all_mode=difference,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null -
```

Interpretation: a smooth ramp in `YAVG` around a scale change is the cross-fade
working. A single-frame spike greater than roughly 2× the local mean is a pop.

### C3 — Adaptive-resolution stability (automated, unconditional)

The 10-minute window exists to catch the scale-down/recover limit cycle, so that
mode is asserted directly over 10 *simulated* minutes of frame times in
`tests/phase8.test.ts` §3:

- Load alternating inside the hysteresis dead band (14 ms / 16 ms) → **zero** scale
  transitions.
- A sustained overload step → exactly 2 scale-downs (1.00× → 0.50× → 0.25×), then flat.
- A sustained headroom step → exactly 2 scale-ups, then 8 further minutes with
  **zero** additional transitions.
- Shipped thresholds (17.5 ms drop / 12.0 ms restore, 10/60-frame dwell) are pinned.

---

## Gate D — 10-minute memory stability (automated)

```bash
npm run test:long
```

Runs the doc's full 36,000-frame (10-minute) window with `--expose-gc`, logging
per-minute heap deltas and KB per 1,000 frames, and asserting `< 1.0 MB` total drift.
`npm test` (and therefore CI) stays fast: the long gate is skipped unless
`PHASE8_LONG=1` is set.

Record the printed numbers here when the gate is run on a release candidate:

| Date | Frames | Heap drift | KB / 1000 frames | Result |
| :--- | :--- | :--- | :--- | :--- |
| _(fill in)_ | 36,000 | | | |

---

## Known open items after this pass

1. **Gate A** — the headline 60fps acceptance is unmeasured on any named GPU.
2. **Gate C** — no 10-minute recording, therefore no visual certification.
3. **Gate B2** — the live device-loss walkthrough has not been performed on hardware.
4. **Worker threading is a scaffold.** `SimulationWorkerBridge` is implemented and its
   in-thread fallback is tested (`tests/workerBridge.test.ts`), but the App loop does
   not activate the worker, and `simWorker.ts` runs a simplified pipeline rather than
   the real `GpuFluidSolver` + coupler + telemetry path. Activating it is real work,
   not a flag flip.
5. **Renderer hot-swap** on a live canvas is not implemented (see B2 limitation).
