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
  console.log('[Phase 2 Audit] Launching Chrome headless on port', port);
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1280,800',
    '--disable-gpu-watchdog',
    '--user-data-dir=/tmp/chrome-audit-profile-phase2',
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
    console.error('[Phase 2 Audit] Page target not found:', targets);
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
    console.log(`[Phase 2 Audit] Saved screenshot: ${filePath} (${buffer.length} bytes)`);
    return filePath;
  }

  await send('Page.enable');
  await send('Runtime.enable');

  await sleep(2000);

  // 1. Inspect Header & HUD
  const domAudit = await evaluate(`(() => {
    const hudStrip = document.querySelector('#sim-hud');
    const rpmVal = document.querySelector('#hud-rpm-val')?.textContent?.trim();
    const allHudCells = document.querySelectorAll('.hud-stat-cell');
    const allHudReadings = document.querySelectorAll('.hud-reading');

    const header = document.querySelector('#sim-header');
    const title = document.querySelector('#app-title')?.textContent?.trim();
    const materialSelect = document.querySelector('#material-select');
    const materialOptions = materialSelect ? Array.from(materialSelect.options).map(o => ({ value: o.value, text: o.text })) : [];
    const throttleVal = document.querySelector('#throttle-value')?.textContent?.trim();
    const throttleInput = document.querySelector('#throttle-slider')?.value;
    const runBtn = document.querySelector('#btn-run')?.textContent?.trim();
    const recBtn = document.querySelector('#btn-rec')?.textContent?.trim();

    const hudLabels = Array.from(document.querySelectorAll('.hud-label')).map(el => el.textContent.trim());
    return {
      hud: {
        rpmVal,
        cellCount: allHudCells.length,
        readingCount: allHudReadings.length,
        hasMaterialName: hudLabels.some(l => l.includes('MATERIAL')),
        hasRoughness: hudLabels.some(l => l.includes('ROUGHNESS'))
      },
      header: {
        title,
        materialSelectValue: materialSelect?.value,
        materialOptions,
        throttleVal,
        throttleInput,
        runBtn,
        recBtn,
        controlCount: [title, materialSelect, throttleInput, runBtn, recBtn].filter(Boolean).length
      }
    };
  })()`);

  console.log('[Phase 2 Audit] DOM Audit:', JSON.stringify(domAudit, null, 2));

  // 2. Performance benchmark function
  async function measureFps() {
    return await evaluate(`(async () => {
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
        avgFrameMs: Number(avgFrameMs.toFixed(2)),
        fps: Number(fps.toFixed(1)),
        minFrameMs: Number(Math.min(...times).toFixed(2)),
        maxFrameMs: Number(Math.max(...times).toFixed(2))
      };
    })()`);
  }

  // 3. Measure BEMT thrust for the 3 materials
  const physicsAudit = await evaluate(`(() => {
    const app = window.__app;
    if (!app || !window.__solveBemt) return null;
    const bemtRigid = window.__solveBemt(3800, 1.5, { material: 'rigid10k' });
    const bemtPetg = window.__solveBemt(3800, 1.5, { material: 'petg' });
    const bemtPa12 = window.__solveBemt(3800, 1.5, { material: 'pa12cf15' });

    return {
      rigid10k: { thrustN: bemtRigid.thrustN, torqueNm: bemtRigid.torqueNm },
      petg: { thrustN: bemtPetg.thrustN, torqueNm: bemtPetg.torqueNm },
      pa12cf15: { thrustN: bemtPa12.thrustN, torqueNm: bemtPa12.torqueNm },
      deltaPetgPercent: ((bemtRigid.thrustN - bemtPetg.thrustN) / bemtRigid.thrustN * 100).toFixed(3) + '%',
      deltaPa12Percent: ((bemtRigid.thrustN - bemtPa12.thrustN) / bemtRigid.thrustN * 100).toFixed(3) + '%'
    };
  })()`);

  console.log('[Phase 2 Audit] Physics Audit:', JSON.stringify(physicsAudit, null, 2));

  // 4. Capture Screenshots for each material
  const materials = ['rigid10k', 'pa12cf15', 'petg'];
  const materialPerf = {};

  for (const mat of materials) {
    console.log(`[Phase 2 Audit] Selecting material: ${mat}`);
    await evaluate(`(() => {
      const select = document.querySelector('#material-select');
      if (select) {
        select.value = '${mat}';
        select.dispatchEvent(new Event('change'));
      }
    })()`);
    await sleep(400);

    // Frame camera for default view
    await evaluate(`(() => {
      const app = window.__app;
      app.renderer.camera.position.set(0.10, 0.04, 0.10);
      app.renderer.controls.target.set(0, 0, 0);
      app.renderer.controls.update();
    })()`);
    await sleep(300);
    await captureScreenshot(`phase2_${mat}_framed.png`);

    // Frame camera for close-up view (max zoom on blade face to inspect layer lines & finish)
    await evaluate(`(() => {
      const app = window.__app;
      app.renderer.camera.position.set(0.022, 0.008, 0.022);
      app.renderer.controls.target.set(0.008, 0.002, 0.002);
      app.renderer.controls.update();
    })()`);
    await sleep(400);
    await captureScreenshot(`phase2_${mat}_closeup.png`);

    // Measure FPS
    materialPerf[mat] = await measureFps();
    console.log(`[Phase 2 Audit] FPS for ${mat}:`, materialPerf[mat]);
  }

  // Reset camera to default
  await evaluate(`(() => {
    const app = window.__app;
    app.renderer.camera.position.set(0.10, 0.04, 0.10);
    app.renderer.controls.target.set(0, 0, 0);
    app.renderer.controls.update();
  })()`);

  const report = {
    domAudit,
    physicsAudit,
    materialPerf
  };

  fs.writeFileSync(path.join(outDir, 'phase2_audit_report.json'), JSON.stringify(report, null, 2));
  console.log('[Phase 2 Audit] Report written to phase2_audit_report.json');

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error('[Phase 2 Audit Error]', err);
  process.exit(1);
});
