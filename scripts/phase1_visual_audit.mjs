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
  console.log('[Phase 1 Audit] Launching Chrome headless on port', port);
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1280,800',
    '--disable-gpu-watchdog',
    '--user-data-dir=/tmp/chrome-audit-profile',
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
    console.error('[Phase 1 Audit] Page target not found:', targets);
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

  await new Promise((resolve) => ws.onopen = resolve);

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
    console.log(`[Phase 1 Audit] Saved screenshot: ${filePath} (${buffer.length} bytes)`);
    return filePath;
  }

  await send('Page.enable');
  await send('Runtime.enable');

  await sleep(2000);

  // 1. Inspect DOM Elements
  const domAudit = await evaluate(`(() => {
    const hudStrip = document.querySelector('#sim-hud');
    const rpmVal = document.querySelector('#hud-rpm-val')?.textContent?.trim();
    const allHudCells = document.querySelectorAll('.hud-stat-cell');
    const allHudReadings = document.querySelectorAll('.hud-reading');

    const header = document.querySelector('#sim-header');
    const title = document.querySelector('#app-title')?.textContent?.trim();
    const throttleVal = document.querySelector('#throttle-value')?.textContent?.trim();
    const throttleInput = document.querySelector('#throttle-slider')?.value;
    const runBtn = document.querySelector('#btn-run')?.textContent?.trim();
    const recBtn = document.querySelector('#btn-rec')?.textContent?.trim();
    const speedSelect = document.querySelector('#speed-select');
    const advFold = document.querySelector('#advanced-fold');

    return {
      hud: {
        rpmVal,
        cellCount: allHudCells.length,
        readingCount: allHudReadings.length,
        hasThrust: !!document.querySelector('#hud-thrust-val'),
        hasTorque: !!document.querySelector('#hud-torque-val'),
        hasInflow: !!document.querySelector('#hud-inflow-val'),
        hasJ: !!document.querySelector('#hud-j-val'),
        hasMach: !!document.querySelector('#hud-mach-val'),
        hasFps: !!document.querySelector('#hud-fps-val')
      },
      header: {
        title,
        throttleVal,
        throttleInput,
        runBtn,
        recBtn,
        hasSpeedSelect: !!speedSelect,
        hasAdvancedFold: !!advFold
      }
    };
  })()`);

  console.log('[Phase 1 Audit] DOM Audit:', JSON.stringify(domAudit, null, 2));

  // 2. Measure Viewport Framing of the Propeller Disc
  const framing = await evaluate(`(() => {
    const app = window.__app;
    if (!app || !app.renderer) return null;
    const camera = app.renderer.camera;
    camera.updateMatrixWorld();
    const pMat = camera.projectionMatrix.elements;
    const vMat = camera.matrixWorldInverse.elements;

    function project(x, y, z) {
      const vx = vMat[0]*x + vMat[4]*y + vMat[8]*z + vMat[12];
      const vy = vMat[1]*x + vMat[5]*y + vMat[9]*z + vMat[13];
      const vz = vMat[2]*x + vMat[6]*y + vMat[10]*z + vMat[14];
      const vw = vMat[3]*x + vMat[7]*y + vMat[11]*z + vMat[15];

      const cx = pMat[0]*vx + pMat[4]*vy + pMat[8]*vz + pMat[12]*vw;
      const cy = pMat[1]*vx + pMat[5]*vy + pMat[9]*vz + pMat[13]*vw;
      const cz = pMat[2]*vx + pMat[6]*vy + pMat[10]*vz + pMat[14]*vw;
      const cw = pMat[3]*vx + pMat[7]*vy + pMat[11]*vz + pMat[15]*vw;

      return { x: cx / cw, y: cy / cw };
    }

    const R = 0.042 / 2.0;
    const numPoints = 180;
    let minScreenY = Infinity;
    let maxScreenY = -Infinity;
    let minScreenX = Infinity;
    let maxScreenX = -Infinity;

    for (let i = 0; i < numPoints; i++) {
      const angle = (i * 2.0 * Math.PI) / numPoints;
      const pt = project(R * Math.cos(angle), R * Math.sin(angle), 0);
      if (pt.y < minScreenY) minScreenY = pt.y;
      if (pt.y > maxScreenY) maxScreenY = pt.y;
      if (pt.x < minScreenX) minScreenX = pt.x;
      if (pt.x > maxScreenX) maxScreenX = pt.x;
    }

    const heightFraction = (maxScreenY - minScreenY) / 2.0;
    const widthFraction = (maxScreenX - minScreenX) / 2.0;

    return {
      camPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      camFov: camera.fov,
      orbitTarget: { x: app.renderer.controls.target.x, y: app.renderer.controls.target.y, z: app.renderer.controls.target.z },
      orbitMinDist: app.renderer.controls.minDistance,
      orbitMaxDist: app.renderer.controls.maxDistance,
      enablePan: app.renderer.controls.enablePan,
      autoRotate: app.renderer.controls.autoRotate,
      discHeightFraction: heightFraction,
      discHeightPercent: (heightFraction * 100).toFixed(1) + '%',
      discWidthFraction: widthFraction,
      discWidthPercent: (widthFraction * 100).toFixed(1) + '%'
    };
  })()`);

  console.log('[Phase 1 Audit] Camera Framing Audit:', JSON.stringify(framing, null, 2));

  // 3. Measure FPS & Frame Times
  const perf = await evaluate(`(async () => {
    const times = [];
    let last = performance.now();
    for (let i = 0; i < 60; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    const avgFrameMs = times.reduce((a, b) => a + b, 0) / times.length;
    const fps = 1000.0 / avgFrameMs;
    return {
      avgFrameMs: avgFrameMs.toFixed(2),
      fps: fps.toFixed(1),
      minFrameMs: Math.min(...times).toFixed(2),
      maxFrameMs: Math.max(...times).toFixed(2)
    };
  })()`);

  console.log('[Phase 1 Audit] Performance:', perf);

  // 4. Capture Primary Screenshot (Default Load Framing)
  await captureScreenshot('phase1_propeller_framed.png');

  // 5. Zoom In to inspect blade leading edge and root fillet
  await evaluate(`(() => {
    const app = window.__app;
    app.renderer.camera.position.set(0.035, 0.015, 0.035);
    app.renderer.controls.update();
  })()`);
  await sleep(500);
  await captureScreenshot('phase1_blade_closeup.png');

  // Reset camera to default
  await evaluate(`(() => {
    const app = window.__app;
    app.renderer.camera.position.set(0.10, 0.04, 0.10);
    app.renderer.controls.update();
  })()`);
  await sleep(300);

  const report = {
    domAudit,
    framing,
    performance: perf
  };

  fs.writeFileSync(path.join(outDir, 'phase1_audit_report.json'), JSON.stringify(report, null, 2));
  console.log('[Phase 1 Audit] Report written to phase1_audit_report.json');

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error('[Phase 1 Audit Error]', err);
  process.exit(1);
});
