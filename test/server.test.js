const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

const app = require('../server');
const {
  fetchFavicon,
  getBitableData,
  parseHttpUrl,
  processTableData
} = app._test;

let server;
let baseUrl;
const originalAdminToken = process.env.ADMIN_TOKEN;

before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (originalAdminToken === undefined) {
    delete process.env.ADMIN_TOKEN;
  } else {
    process.env.ADMIN_TOKEN = originalAdminToken;
  }
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test('health endpoint reports configuration without exposing values', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.feishuConfigured, 'boolean');
  assert.equal(JSON.stringify(body).includes(process.env.APP_SECRET || '__missing__'), false);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('write endpoints fail closed when admin token is not configured', async () => {
  delete process.env.ADMIN_TOKEN;
  const { response, body } = await request('/api/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Example', url: 'https://example.com', category: 'Test' })
  });
  assert.equal(response.status, 503);
  assert.equal(body.code, 'ADMIN_NOT_CONFIGURED');
});

test('admin token must contain at least six characters', async () => {
  process.env.ADMIN_TOKEN = '12345';
  const { response, body } = await request('/api/links/example', {
    method: 'DELETE',
    headers: { authorization: 'Bearer 12345' }
  });
  assert.equal(response.status, 503);
  assert.equal(body.code, 'ADMIN_NOT_CONFIGURED');
});

test('write endpoints reject an invalid admin token', async () => {
  process.env.ADMIN_TOKEN = 'Ab12x9';
  const { response, body } = await request('/api/links/example', {
    method: 'DELETE',
    headers: { authorization: 'Bearer wrong-token' }
  });
  assert.equal(response.status, 401);
  assert.equal(body.code, 'UNAUTHORIZED');
});

test('link creation only accepts HTTP and HTTPS URLs', async () => {
  process.env.ADMIN_TOKEN = 'Ab12x9';
  const { response, body } = await request('/api/links', {
    method: 'POST',
    headers: {
      authorization: 'Bearer Ab12x9',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ name: 'Unsafe', url: 'javascript:alert(1)', category: 'Test' })
  });
  assert.equal(response.status, 400);
  assert.match(body.message, /http/);
});

test('link deletion validates record IDs before calling Feishu', async () => {
  process.env.ADMIN_TOKEN = 'Ab12x9';
  const { response, body } = await request('/api/links/bad%20id', {
    method: 'DELETE',
    headers: { authorization: 'Bearer Ab12x9' }
  });
  assert.equal(response.status, 400);
  assert.match(body.message, /记录ID/);
});

test('URL parser rejects executable and data protocols', () => {
  assert.equal(parseHttpUrl('javascript:alert(1)'), null);
  assert.equal(parseHttpUrl('data:text/html,test'), null);
  assert.equal(parseHttpUrl('https://example.com/path').hostname, 'example.com');
});

test('favicon fetching falls back between providers and reuses its memory cache', async () => {
  const image = Buffer.alloc(128, 1);
  const calls = [];
  const client = {
    async get(url) {
      calls.push(url);
      if (url.includes('duckduckgo.com')) throw new Error('primary unavailable');
      return { data: image, headers: { 'content-type': 'image/png' } };
    }
  };

  const first = await fetchFavicon('fallback-test.example', 64, client);
  const second = await fetchFavicon('fallback-test.example', 64, client);

  assert.equal(first.data, image);
  assert.equal(second.data, image);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /duckduckgo\.com/);
  assert.match(calls[1], /google\.com/);
});

test('favicon fetching rejects invalid provider responses', async () => {
  const client = {
    async get() {
      return { data: Buffer.from('not an image'), headers: { 'content-type': 'text/plain' } };
    }
  };

  await assert.rejects(() => fetchFavicon('invalid-test.example', 64, client), /无效图片/);
});

test('table processing tolerates incomplete fields and prototype-like categories', () => {
  const grouped = processTableData([
    { record_id: 'one', fields: { 站点名称: 'No URL', 分类: '其它' } },
    { record_id: 'two', fields: { 站点名称: 'Safe', 网址: { link: 'https://example.com' }, 分类: '__proto__' } }
  ]);

  assert.equal(Object.getPrototypeOf(grouped), null);
  assert.equal(grouped['其它'][0].url, '');
  assert.equal(grouped['__proto__'][0].name, 'Safe');
});

test('Feishu records are read across all pages', async () => {
  const calls = [];
  const client = {
    async get(url, options) {
      calls.push(options.params);
      if (!options.params.page_token) {
        return {
          data: {
            code: 0,
            data: { items: [{ record_id: 'one' }], has_more: true, page_token: 'next' }
          }
        };
      }
      return {
        data: {
          code: 0,
          data: { items: [{ record_id: 'two' }], has_more: false }
        }
      };
    }
  };

  const items = await getBitableData('token', client);
  assert.deepEqual(items.map(item => item.record_id), ['one', 'two']);
  assert.deepEqual(calls, [{ page_size: 100 }, { page_size: 100, page_token: 'next' }]);
});
