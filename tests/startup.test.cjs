const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, requestInterceptor, VirtualConsole } = require('jsdom');
const directory = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const origin = 'https://app.example';
const never = () => new Promise(() => {});

async function openApp(seed, { registrationFails = false, audioMode = "success" } = {}) {
  const errors = [], registrations = [], consoleWarnings = [];
  let adRequested = false, loaded = false;
  const audioCalls = [], audioNodes = [], audioDelays = [];
  const resources = { interceptors: [requestInterceptor(request => {
      const url = request.url;
      if (url.startsWith('https://adm.shinobi.jp/')) {
        adRequested = true;
        // Deliberately keep parser and load events waiting forever.
        return never();
      }
      if (url.startsWith(origin)) {
        const pathname = new URL(url).pathname.slice(1);
        return new Response(pathname.endsWith('.css') ? '' : fs.readFileSync(path.join(directory, pathname)), {
          headers: { 'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'application/javascript' }
        });
      }
      return new Response('', { status: 404 });
  })] };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(html, {
    url: origin + '/', runScripts: 'dangerously', resources, virtualConsole,
    beforeParse(window) {
      window.console.warn = (...args) => consoleWarnings.push(args);
      window.confirm = () => true;
      window.TextEncoder = TextEncoder;
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.requestAnimationFrame = callback => window.setTimeout(() => callback(window.performance.now()), 16);
      window.cancelAnimationFrame = id => window.clearTimeout(id);
      window.alert = message => errors.push(new Error(message));
      window.HTMLCanvasElement.prototype.getContext = function() {
        return new Proxy({ canvas: this, measureText: () => ({ width: 40 }),
          createLinearGradient: () => ({ addColorStop() {} }),
          getImageData: () => ({ data: new Uint8ClampedArray(4) }) }, {
          get(target, key) { return key in target ? target[key] : () => {}; }
        });
      };
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
      window.HTMLCanvasElement.prototype.toBlob = callback => callback(new window.Blob(['png'], { type: 'image/png' }));
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => {
        if (delay === 8000) audioDelays.push(delay);
        return nativeTimeout(fn, delay === 8000 ? 20 : delay, ...args);
      };
      const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
      const node = type => {
        const n = { type, frequency: param(), gain: param(), connect() {}, disconnect() {},
          start() { audioNodes.push(type); }, stop() {} };
        return n;
      };
      window.AudioContext = class {
        state = 'running'; currentTime = 0; destination = {};
        resume() { return Promise.resolve(); }
        decodeAudioData() { return audioMode === 'decode-hang' ? never() : Promise.resolve({ duration: 1 }); }
        createGain() { return node('gain'); }
        createBufferSource() { return node('buffer'); }
        createOscillator() { return node('oscillator'); }
      };
      window.fetch = (url, options) => {
        audioCalls.push({ url, options });
        if (audioMode === 'connection-hang') return never();
        if (audioMode === 'offline') return Promise.reject(new TypeError('offline'));
        if (audioMode === 'http-error') return Promise.resolve(new Response('error', { status: 503 }));
        if (audioMode === 'body-hang') return Promise.resolve({ ok: true, arrayBuffer: never });
        return Promise.resolve(new Response('audio'));
      };
      for (const [key, value] of Object.entries(seed)) window.localStorage.setItem(key, JSON.stringify(value));
      Object.defineProperty(window.navigator, 'serviceWorker', {
        value: { register(url, options) {
          registrations.push({ url, options });
          return registrationFails ? Promise.reject(new Error('SW unavailable')) : never();
        } }
      });
      window.addEventListener('load', () => { loaded = true; });
    }
  });
  for (let i = 0; i < 100 && (!adRequested || registrations.length === 0); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return { dom, errors, registrations, consoleWarnings, audioCalls, audioNodes, audioDelays, get adRequested() { return adRequested; }, get loaded() { return loaded; } };
}


test('app scripts precede the unchanged single advertising tag', () => {
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map(m => m[1]);
  const ad = scripts.filter(s => s.startsWith('https://adm.shinobi.jp/'));
  assert.equal(ad.length, 1);
  assert.ok(scripts.findIndex(s => s.startsWith('script.js')) < scripts.indexOf(ad[0]));
});

const seed = {
  mrsToolsRouletteSettingsV1: [{ id: 'one', label: '保存したA', weight: 1 }, { id: 'two', label: '保存したB', weight: 3 }],
  mrsToolsRouletteEqualSpacingV1: true,
  mrsToolsRouletteHistoryV1: [{ id: 'history', label: '前の結果', color: '#ef6a45', timestamp: 1792500000000 }],
  mrsToolsRouletteCurrentResultV1: { id: 'result', label: '現在の結果', color: '#ef6a45', timestamp: 1792500000001 }
};
for (const registrationFails of [false, true]) {
  test('roulette restores settings/history and spins before advertising completes; SW failure=' + registrationFails, async () => {
    const app = await openApp(seed, { registrationFails });
    try {
      const w = app.dom.window, d = w.document;
      assert.equal(app.adRequested, true);
      assert.equal(app.loaded, false);
      assert.equal(d.readyState, 'loading');
      assert.equal(app.registrations.length, 1);
      assert.equal(app.errors.length, 0, app.errors.map(String).join('\n'));
      assert.equal(d.getElementById('resultValue').textContent, '現在の結果');
      assert.match(d.getElementById('historyList').textContent, /前の結果/);
      d.getElementById('settingsBtn').click();
      assert.equal(d.getElementById('settingsModal').hidden, false);
      assert.equal(d.getElementById('equalSpacingToggle').checked, true);
      assert.equal(d.querySelector('#segmentList input').value, '保存したA');
      d.getElementById('settingsCancelBtn').click();
      assert.deepEqual(JSON.parse(w.localStorage.getItem('mrsToolsRouletteSettingsV1')), seed.mrsToolsRouletteSettingsV1);
      d.getElementById('spinBtn').click();
      assert.equal(d.getElementById('resultValue').textContent, '回転中…');
      w.dispatchEvent(new w.Event('load'));
      assert.equal(d.getElementById('resultValue').textContent, '回転中…');
      assert.equal(app.registrations.length, 1);
    } finally { app.dom.window.close(); }
  });
}
