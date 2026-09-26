import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifactDir = '/Users/home/.gemini/antigravity-ide/brain/6d0678dd-e4ca-4efe-abf3-eab0d2b1b931';
const port = 9225;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('[Phase 5 Audit] Launching Chrome headless on port', port);
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--disable-gpu-watchdog',
    '--use-gl=angle',
    '--user-data-dir=/tmp/chrome-phase5-profile',
    'http://localhost:5173/'
  ]);

  let targets = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(600);
    try {
      const targetsRes = await fetch(`http://127.0.0.1:${port}/json`);
      targets = await targetsRes.json();
      if (targets && targets.length > 0) break;
    } catch {
      // retry
    }
  }

  const page = targets?.find((t) => t.type === 'page' && t.url.includes('5173'));
  if (!page) {
    console.error('[Phase 5 Audit] Page target not found:', targets);
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

  await new Promise((resolve) => { ws.onopen = resolve; });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  }

  async function captureScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(artifactDir, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`[Screenshot saved] ${outPath}`);
    return outPath;
  }

  await sleep(2500);

  // 1. Measure camera disc fraction
  const discFraction = await evaluate(`(() => {
    const app = window.__app;
    const camera = app.renderer.camera;
    const D = 0.042;
    const dist = camera.position.distanceTo(app.renderer.controls.target);
    const vFovRad = (camera.fov * Math.PI) / 180;
    const visibleHeightAtDist = 2 * dist * Math.tan(vFovRad / 2);
    const fraction = D / visibleHeightAtDist;
    return {
      fov: camera.fov,
      dist,
      visibleHeightAtDist,
      fraction,
      fractionPercent: (fraction * 100).toFixed(1) + '%'
    };
  })()`);

  // 2. Set to Water mode, throttle 0.88, candidateA, rigid10k
  const singleWaterMetrics = await evaluate(`(async () => {
    const app = window.__app;
    app.activeThrottle = 0.88;
    app.setMedium('water');
    app.setDesignA('candidateA');
    app.setMaterialA('rigid10k');
    
    await new Promise(r => setTimeout(r, 1200));

    const hudThrust = document.getElementById('hud-thrust-val-a')?.textContent;
    const hudTorque = document.getElementById('hud-torque-val-a')?.textContent;
    const hudRpm = document.getElementById('hud-rpm-val-a')?.textContent;
    const hudInflow = document.getElementById('hud-inflow-val-a')?.textContent;
    const hudJ = document.getElementById('hud-j-val-a')?.textContent;
    const hudEta = document.getElementById('hud-eta-val-a')?.textContent;

    return {
      hudThrust,
      hudTorque,
      hudRpm,
      hudInflow,
      hudJ,
      hudEta,
      rawThrustN: app.metricsDataA.thrustN,
      rawTorqueNm: app.metricsDataA.torqueNm,
      rawRpm: app.shaft.currentRpm,
      rawInflowMs: app.metricsDataA.inflowSpeedMs,
      rawJ: app.metricsDataA.advanceRatioJ,
      rawEta: app.metricsDataA.efficiency,
      pShaftW: app.metricsDataA.pShaftW,
      pIdealW: app.metricsDataA.pIdealW
    };
  })()`);

  await captureScreenshot('phase5_single_water.png');

  // Measure single mode frame time over 120 frames
  const singleFrameTimes = await evaluate(`(async () => {
    const times = [];
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      await new Promise(r => requestAnimationFrame(r));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return {
      median: times[Math.floor(times.length / 2)],
      mean: times.reduce((a, b) => a + b, 0) / times.length,
      p95: times[Math.floor(times.length * 0.95)]
    };
  })()`);

  // 3. Air mode at 1.0 throttle
  const airModeMetrics = await evaluate(`(async () => {
    const app = window.__app;
    app.setMedium('air');
    app.activeThrottle = 1.0;
    await new Promise(r => setTimeout(r, 2500));
    return {
      rpm: app.shaft.currentRpm,
      medium: app.activeMedium,
      thrustN: app.metricsDataA.thrustN,
      torqueNm: app.metricsDataA.torqueNm,
      hudRpm: document.getElementById('hud-rpm-val-a')?.textContent
    };
  })()`);

  await captureScreenshot('phase5_single_air.png');

  // 4. Switch back to Water mode at 1.0 throttle
  const waterModeFullThrottle = await evaluate(`(async () => {
    const app = window.__app;
    app.setMedium('water');
    app.activeThrottle = 1.0;
    await new Promise(r => setTimeout(r, 2500));
    return {
      rpm: app.shaft.currentRpm,
      medium: app.activeMedium,
      thrustN: app.metricsDataA.thrustN,
      hudRpm: document.getElementById('hud-rpm-val-a')?.textContent
    };
  })()`);

  // 5. Compare Mode: candidateA vs kaplan
  const compareMetrics = await evaluate(`(async () => {
    const app = window.__app;
    app.setCompareMode(true);
    app.setDesignA('candidateA');
    app.setDesignB('kaplan');
    app.activeThrottle = 0.88;
    await new Promise(r => setTimeout(r, 2000));

    const getRow = (id) => ({
      valA: document.getElementById('tbl-' + id + '-a')?.textContent,
      valB: document.getElementById('tbl-' + id + '-b')?.textContent,
      delta: document.getElementById('tbl-' + id + '-d')?.textContent
    });

    return {
      thrust: getRow('thrust'),
      torque: getRow('torque'),
      rpm: getRow('rpm'),
      j: getRow('j'),
      eta: getRow('eta'),
      pshaft: getRow('pshaft'),
      pideal: getRow('pideal'),
      rawA: { ...app.metricsDataA },
      rawB: { ...app.metricsDataB }
    };
  })()`);

  await captureScreenshot('phase5_compare_mode.png');

  // Measure compare mode frame times
  const compareFrameTimes = await evaluate(`(async () => {
    const times = [];
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      await new Promise(r => requestAnimationFrame(r));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return {
      median: times[Math.floor(times.length / 2)],
      mean: times.reduce((a, b) => a + b, 0) / times.length,
      p95: times[Math.floor(times.length * 0.95)]
    };
  })()`);

  // 6. Test slow motion time scale ratio 1.0x vs 0.1x
  const timeScaleRatio = await evaluate(`(async () => {
    const app = window.__app;
    app.setCompareMode(false);
    app.setMedium('water');
    
    // Set 1.0x
    app.clock.setTimeScale(1.0);
    const startX1 = app.fluidSolver.grid.u[32 * 256 + 100];
    await new Promise(r => setTimeout(r, 300));
    const endX1 = app.fluidSolver.grid.u[32 * 256 + 100];
    
    // Check SimClock dt scaling
    const dt1 = app.clock.getTimeScale();
    app.clock.setTimeScale(0.1);
    const dt01 = app.clock.getTimeScale();

    return {
      scale1: dt1,
      scale01: dt01,
      ratio: dt1 / dt01
    };
  })()`);

  // Close browser and print JSON
  chrome.kill();

  console.log('--- PHASE 5 AUDIT RESULTS ---');
  console.log(JSON.stringify({
    discFraction,
    singleWaterMetrics,
    singleFrameTimes,
    airModeMetrics,
    waterModeFullThrottle,
    compareMetrics,
    compareFrameTimes,
    timeScaleRatio
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
