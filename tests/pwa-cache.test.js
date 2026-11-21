const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const worker = fs.readFileSync('src/templates/main_sw.js', 'utf8');
const origin = 'https://example.test';

function startWorker(entries, fetch) {
  const listeners = {};
  const caches = {
    async match(request, { cacheName } = {}) {
      const url = request.url || request;
      for (const name of cacheName ? [cacheName] : Object.keys(entries)) {
        const body = entries[name]?.[url];
        if (body !== undefined) return new Response(body);
      }
    },
    async open(name) {
      return { async put(url, response) { (entries[name] ||= {})[url] = await response.text(); } };
    }
  };
  vm.runInNewContext(worker, {
    self: { registration: { scope: origin + '/' }, addEventListener: (name, fn) => { listeners[name] = fn; } },
    caches, fetch, URL, Response, AbortController, setTimeout, clearTimeout
  });
  return async function request(path, mode = 'same-origin') {
    const writes = [];
    let response;
    listeners.fetch({
      request: { url: origin + path, method: 'GET', cache: 'default', mode },
      respondWith: promise => { response = promise; },
      waitUntil: promise => { writes.push(promise); }
    });
    const body = await (await response).text();
    await Promise.all(writes);
    return body;
  };
}

test('an existing PWA replaces stale shell files online and uses the refreshed shell offline', async () => {
  const entries = { 'cx-main': { [origin + '/']: 'old HTML', [origin + '/js/app.js']: 'old JS' } };
  let online = true;
  const request = startWorker(entries, async (req, options) => {
    if (!online) throw new Error('offline');
    assert.equal(options.cache, 'no-cache');
    const response = new Response(req.mode === 'navigate' ? 'new HTML' : 'new JS');
    Object.defineProperty(response, 'type', { value: 'basic' });
    return response;
  });

  assert.equal(await request('/?open=1', 'navigate'), 'new HTML');
  assert.equal(await request('/js/app.js'), 'new JS');
  online = false;
  assert.equal(await request('/index.html', 'navigate'), 'new HTML');
  assert.equal(await request('/js/app.js'), 'new JS');
});

test('updated named training cache wins over a stale shared copy without dropping history', async () => {
  const batch = origin + '/2026-01/training.json';
  const history = origin + '/2001-01/training.json';
  const request = startWorker({
    'cx-main': { [batch]: 'old batch', [history]: 'history' },
    'cx-2026-01': { [batch]: 'new batch' }
  }, async () => { throw new Error('offline'); });

  assert.equal(await request('/2026-01/training.json'), 'new batch');
  assert.equal(await request('/2001-01/training.json'), 'history');
});
