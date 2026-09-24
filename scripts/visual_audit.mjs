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
  console.log('[Audit] Launching Chrome headless with remote debugging on port', port);
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1280,800',
    '--disable-gpu-watchdog',
    '--user-data-dir=/tmp/chrome-audit-profile',
    'http://localhost:5173/'
  ]);

  chrome.stderr.on('data', (d) => {
    // console.log('[Chrome stderr]', d.toString().slice(0, 100));
  });

  await sleep(3000);

  console.log('[Audit] Querying DevTools targets...');
  const targetsRes = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await targetsRes.json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('5173'));
  if (!page) {
    console.error('[Audit] Page target not found:', targets);
    chrome.kill();
    process.exit(1);
  }

  console.log('[Audit] Connecting to page WebSocket:', page.webSocketDebuggerUrl);
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
    console.log(`[Audit] Saved screenshot: ${filePath} (${buffer.length} bytes)`);
    return filePath;
  }

  await send('Page.enable');
  await send('Runtime.enable');

  console.log('[Audit] Waiting 2.5s for physics and 3D scene to run...');
  await sleep(2500);

  // 1. Initial Default Screenshot
  const metrics1 = await evaluate(`({
    thrust: document.querySelector('#hud-thrust-val')?.textContent,
    torque: document.querySelector('#hud-torque-val')?.textContent,
    rpm: document.querySelector('#hud-rpm-val')?.textContent,
    inflow: document.querySelector('#hud-inflow-val')?.textContent,
    j: document.querySelector('#hud-j-val')?.textContent,
    fps: document.querySelector('#hud-fps-val')?.textContent,
    timeScale: window.__app?.clock?.timeScale
  })`);
  console.log('[Audit] Initial running state metrics:', metrics1);
  await captureScreenshot('screen_1_default_running.png');

  // 2. Slow motion 0.1x
  console.log('[Audit] Setting speed to 0.1x...');
  await evaluate(`window.__app.header.applySpeedScale(0.1)`);
  await sleep(1500);
  const metricsSlowMo = await evaluate(`({
    thrust: document.querySelector('#hud-thrust-val')?.textContent,
    torque: document.querySelector('#hud-torque-val')?.textContent,
    rpm: document.querySelector('#hud-rpm-val')?.textContent,
    rpmSuffix: document.querySelector('#hud-rpm-suffix')?.textContent,
    rpmSuffixDisplay: document.querySelector('#hud-rpm-suffix')?.style.display,
    machDisplay: document.querySelector('#hud-mach-cell')?.style.display,
    machVal: document.querySelector('#hud-mach-val')?.textContent,
    j: document.querySelector('#hud-j-val')?.textContent,
    timeScale: window.__app?.clock?.timeScale
  })`);
  console.log('[Audit] Slow-mo 0.1x metrics:', metricsSlowMo);
  await captureScreenshot('screen_2_slowmo_0_1x.png');

  // 3. Open Advanced fold and verify 9 items
  console.log('[Audit] Opening Advanced fold...');
  await evaluate(`document.querySelector('#advanced-fold').open = true`);
  await sleep(500);
  const advControls = await evaluate(`({
    inflow: !!document.querySelector('#inflow-slider'),
    voltage: !!document.querySelector('#voltage-slider'),
    design: !!document.querySelector('#design-select'),
    timescale: !!document.querySelector('#timescale-slider'),
    vizmode: !!document.querySelector('#vizmode-select'),
    wake: !!document.querySelector('#wake-toggle'),
    vector: !!document.querySelector('#vector-toggle'),
    tip: !!document.querySelector('#tip-toggle'),
    tracer: !!document.querySelector('#tracer-toggle'),
    shortcuts: document.querySelector('.keyboard-hints')?.textContent?.trim()
  })`);
  console.log('[Audit] Advanced fold controls detected:', advControls);
  await captureScreenshot('screen_3_advanced_fold.png');

  // 4. Toggle all visualization overlays on (vectors, wake envelope, dye velocity)
  console.log('[Audit] Activating velocity vectors and wake envelope...');
  await evaluate(`
    document.querySelector('#vector-toggle').checked = true;
    document.querySelector('#wake-toggle').checked = true;
    window.__app.renderer.flowViz.setVelocityVectorsVisible(true);
    window.__app.renderer.flowViz.setWakeEnvelopeVisible(true);
    document.querySelector('#advanced-fold').open = false;
  `);
  await sleep(1500);
  await captureScreenshot('screen_4_all_overlays.png');

  // 5. Measure real frame time and active overlay counts
  const finalReport = await evaluate(`({
    activeOverlays: {
      vectorsVisible: window.__app.renderer.flowViz.showVelocityVectors,
      vectorCount: window.__app.renderer.flowViz.vectorCount,
      tipVorticesVisible: window.__app.renderer.flowViz.showTipVortices,
      activeTipParticles: window.__app.renderer.flowViz.tipPool.filter(p => p.active).length,
      wakeRingsVisible: window.__app.renderer.flowViz.showWakeEnvelope,
      wakeRingCount: window.__app.renderer.flowViz.wakeRings.length,
      tracersVisible: window.__app.renderer.flowViz.showParticleTracers
    },
    physics: {
      thrustN: window.__app.metricsData.thrust_N,
      torqueNm: window.__app.metricsData.torque_Nm,
      rpm: window.__app.metricsData.rpm,
      J: window.__app.metricsData.advance_ratio_J,
      tipMach: window.__app.metricsData.tip_mach,
      timeScale: window.__app.clock.timeScale
    },
    frameTimeMs: window.__app.metricsData.frameMs,
    measuredFps: window.__app.metricsData.fps
  })`);

  console.log('[Audit] Final Verification Report:\n', JSON.stringify(finalReport, null, 2));

  fs.writeFileSync(
    path.join(outDir, 'visual_audit_report.json'),
    JSON.stringify({ metrics1, metricsSlowMo, advControls, finalReport }, null, 2)
  );

  ws.close();
  chrome.kill();
  console.log('[Audit] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Audit Error]', err);
  process.exit(1);
});
