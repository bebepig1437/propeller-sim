import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifactDir = '/Users/home/.gemini/antigravity-ide/brain/6d0678dd-e4ca-4efe-abf3-eab0d2b1b931';
const port = 9226;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1440,900',
    '--disable-gpu-watchdog',
    '--use-gl=angle',
    '--user-data-dir=/tmp/chrome-phase5-mat-profile',
    'http://localhost:5173/'
  ]);

  let targets = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(600);
    try {
      const targetsRes = await fetch(`http://127.0.0.1:${port}/json`);
      targets = await targetsRes.json();
      if (targets && targets.length > 0) break;
    } catch {}
  }

  const page = targets?.find((t) => t.type === 'page' && t.url.includes('5173'));
  if (!page) {
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
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
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

  // Materials screenshots: rigid10k, pa12cf15, petg
  for (const mat of ['rigid10k', 'pa12cf15', 'petg']) {
    await evaluate(`(() => {
      const app = window.__app;
      app.setMaterialA('${mat}');
    })()`);
    await sleep(400);
    await captureScreenshot(`phase5_material_${mat}.png`);
  }

  // Max zoom screenshot showing root fillet, rounded tip, spinner cap
  await evaluate(`(() => {
    const app = window.__app;
    const target = app.renderer.controls.target;
    // Move camera to minDistance (0.04m = 4cm)
    app.renderer.camera.position.set(target.x - 0.02, target.y + 0.015, target.z + 0.035);
    app.renderer.camera.lookAt(target);
    app.renderer.controls.update();
  })()`);
  await sleep(500);
  await captureScreenshot('phase5_zoom_fillet_tip.png');

  chrome.kill();
  console.log('[Materials and Zoom screenshots captured successfully]');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
