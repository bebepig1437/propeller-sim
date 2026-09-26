import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = '/Users/home/.gemini/antigravity-ide/brain/6d0678dd-e4ca-4efe-abf3-eab0d2b1b931';
const port = 9222;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('[Phase 3 Audit] Launching Chrome headless on port', port);
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1280,800',
    '--disable-gpu-watchdog',
    '--user-data-dir=/tmp/chrome-audit-profile-phase3',
    'http://localhost:5173/'
  ]);

  let targets = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(800);
    try {
      const targetsRes = await fetch(`http://127.0.0.1:${port}/json`);
      targets = await targetsRes.json();
      if (targets && targets.length > 0) break;
    } catch {
      // retry
    }
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('5173'));
  if (!page) {
    console.error('[Phase 3 Audit] Page target not found:', targets);
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let idCounter = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise((resolve) => (ws.onopen = resolve));

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result?.value;
  }

  async function captureScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const filePath = path.join(outDir, filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`[Phase 3 Audit] Saved screenshot: ${filePath} (${buffer.length} bytes)`);
    return filePath;
  }

  await send('Page.enable');
  await send('Runtime.enable');

  await sleep(2000);

  // 1. Inspect DOM Header and HUD
  const domAudit = await evaluate(`(() => {
    const hudStrip = document.querySelector('#sim-hud');
    const rpmVal = document.querySelector('#hud-rpm-val')?.textContent?.trim();
    const speedSuffix = document.querySelector('#hud-speed-suffix');
    const allHudCells = document.querySelectorAll('.hud-stat-cell');
    const hudLabels = Array.from(document.querySelectorAll('.hud-label')).map(el => el.textContent.trim());

    const header = document.querySelector('#sim-header');
    const title = document.querySelector('#app-title')?.textContent?.trim();
    const materialSelect = document.querySelector('#material-select');
    const speedSelect = document.querySelector('#speed-select');
    const speedOptions = speedSelect ? Array.from(speedSelect.options).map(o => ({ value: o.value, text: o.text })) : [];
    const throttleVal = document.querySelector('#throttle-value')?.textContent?.trim();
    const throttleInput = document.querySelector('#throttle-slider')?.value;
    const runBtn = document.querySelector('#btn-run')?.textContent?.trim();
    const recBtn = document.querySelector('#btn-rec')?.textContent?.trim();

    return {
      hud: {
        rpmVal,
        cellCount: allHudCells.length,
        speedSuffixDisplay: speedSuffix ? window.getComputedStyle(speedSuffix).display : null,
        speedSuffixText: speedSuffix?.textContent?.trim()
      },
      header: {
        title,
        materialSelectValue: materialSelect?.value,
        speedSelectValue: speedSelect?.value,
        speedOptions,
        throttleVal,
        throttleInput,
        runBtn,
        recBtn,
        controlCount: [title, materialSelect, throttleInput, speedSelect, runBtn, recBtn].filter(Boolean).length
      }
    };
  })()`);

  console.log('[Phase 3 Audit] DOM Audit (1.0x):', JSON.stringify(domAudit, null, 2));

  // 2. Measure 120-frame performance
  async function measure120Frames() {
    return await evaluate(`(async () => {
      const times = [];
      let last = performance.now();
      for (let i = 0; i < 120; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        times.push(now - last);
        last = now;
      }
      times.sort((a, b) => a - b);
      const medianFrameMs = times[Math.floor(times.length / 2)];
      const avgFrameMs = times.reduce((a, b) => a + b, 0) / times.length;
      const fps = 1000.0 / avgFrameMs;
      return {
        medianFrameMs: Number(medianFrameMs.toFixed(2)),
        avgFrameMs: Number(avgFrameMs.toFixed(2)),
        fps: Number(fps.toFixed(1)),
        minFrameMs: Number(times[0].toFixed(2)),
        maxFrameMs: Number(times[times.length - 1].toFixed(2))
      };
    })()`);
  }

  // Allow sim to run for 2.5s at 1.0x so dye flows through pipe
  console.log('[Phase 3 Audit] Running at 1.0x speed for 2.5 seconds...');
  await sleep(2500);

  // Capture Screenshot at 1.0x
  await captureScreenshot('phase3_speed_1_0x.png');
  const perf1_0x = await measure120Frames();
  console.log('[Phase 3 Audit] 1.0x Frame Timings:', perf1_0x);

  // Switch speed to 0.1x via speed dropdown
  console.log('[Phase 3 Audit] Setting speed to 0.1x...');
  await evaluate(`(() => {
    const select = document.querySelector('#speed-select');
    if (select) {
      select.value = '0.1';
      select.dispatchEvent(new Event('change'));
    }
  })()`);
  await sleep(300);

  const domAudit0_1x = await evaluate(`(() => {
    const speedSuffix = document.querySelector('#hud-speed-suffix');
    const speedSelect = document.querySelector('#speed-select');
    const rpmVal = document.querySelector('#hud-rpm-val')?.textContent?.trim();
    return {
      rpmVal,
      speedSelectValue: speedSelect?.value,
      speedSuffixDisplay: speedSuffix ? window.getComputedStyle(speedSuffix).display : null,
      speedSuffixText: speedSuffix?.textContent?.trim()
    };
  })()`);
  console.log('[Phase 3 Audit] DOM Audit (0.1x):', JSON.stringify(domAudit0_1x, null, 2));

  // Let sim run at 0.1x for 2.5s wall-clock time
  await sleep(2500);
  await captureScreenshot('phase3_speed_0_1x.png');
  const perf0_1x = await measure120Frames();
  console.log('[Phase 3 Audit] 0.1x Frame Timings:', perf0_1x);

  // Measure BEMT invariance
  const bemtInvariance = await evaluate(`(() => {
    if (!window.__solveBemt) return null;
    const res1 = window.__solveBemt(3800, 1.5);
    const res2 = window.__solveBemt(3800, 1.5);
    return {
      thrust1: res1.thrustN,
      thrust2: res2.thrustN,
      torque1: res1.torqueNm,
      torque2: res2.torqueNm,
      thrustDiff: Math.abs(res1.thrustN - res2.thrustN),
      torqueDiff: Math.abs(res1.torqueNm - res2.torqueNm)
    };
  })()`);
  console.log('[Phase 3 Audit] BEMT Invariance:', bemtInvariance);

  // Check Pipe and Slices properties in 3D scene
  const sceneAudit = await evaluate(`(() => {
    const app = window.__app;
    if (!app || !app.renderer) return null;
    const pipe = app.renderer.pipe;
    const waterViz = app.renderer.waterViz;
    const cam = app.renderer.camera;
    const controls = app.renderer.controls;

    return {
      pipe: {
        lengthM: pipe.lengthM,
        radiusM: pipe.radiusM,
        propMountX: pipe.propMountX,
        hasInletRing: !!pipe.inletRing,
        hasOutletRing: !!pipe.outletRing,
        hasShaft: !!pipe.shaftMesh
      },
      waterViz: {
        mode: waterViz.mode,
        sliceCount: waterViz.sliceCount,
        particleCount: waterViz.particleCount,
        streamerPoolSize: waterViz.streamerPoolSize
      },
      camera: {
        fov: cam.fov,
        pos: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
        enablePan: controls.enablePan
      }
    };
  })()`);
  console.log('[Phase 3 Audit] Scene Audit:', JSON.stringify(sceneAudit, null, 2));

  const report = {
    domAudit,
    domAudit0_1x,
    perf1_0x,
    perf0_1x,
    bemtInvariance,
    sceneAudit
  };

  fs.writeFileSync(path.join(outDir, 'phase3_audit_report.json'), JSON.stringify(report, null, 2));
  console.log('[Phase 3 Audit] Full report saved to phase3_audit_report.json');

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error('[Phase 3 Audit Error]', err);
  process.exit(1);
});
