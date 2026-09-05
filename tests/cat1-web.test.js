import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SecurityGuard } from '../src/security/guard.js';
import { dispatchToolCall } from '../src/tools/registry.js';
import { webFetchTool } from '../src/tools/web_fetch.js';
import { webSearchTool } from '../src/tools/web_search.js';
import { decodeEntities, stripHtml } from '../src/utils/html.js';

/** Minimal Response-like object accepted by webFetchTool's fetch contract. */
function fakeResponse({ status = 200, body = '', contentType = 'text/html' }) {
  return {
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  };
}

describe('html utils', () => {
  test('stripHtml removes tags, script and style', () => {
    const html =
      '<html><head><style>b{}</style><script>x()</script></head><body><h1>Hi</h1><p>a b</p></body></html>';
    const text = stripHtml(html);
    assert.ok(!text.includes('<'));
    assert.ok(text.includes('Hi'));
    assert.ok(text.includes('a b'));
    assert.ok(!text.includes('x()'));
  });

  test('decodeEntities handles named and numeric refs', () => {
    assert.equal(decodeEntities('&amp;&lt;&gt;&quot;&#39;&nbsp;'), '&<>"\' ');
    assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  });
});

describe('web_fetch tool', () => {
  test('fetches and converts HTML to text', async () => {
    const fetchStub = async () => fakeResponse({ body: '<h1>Title</h1><p>Body &amp; more</p>' });
    const res = await webFetchTool({ url: 'https://example.com' }, { fetch: fetchStub });
    assert.equal(res.status, 200);
    assert.ok(res.content.includes('Title'));
    assert.ok(res.content.includes('Body & more'));
  });

  test('rejects non-http(s) schemes', async () => {
    await assert.rejects(
      () => webFetchTool({ url: 'file:///etc/passwd' }, {}),
      /http\(s\)|scheme/i,
    );
  });

  test('rejects loopback hosts (SSRF guard)', async () => {
    const urls = [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://169.254.1.1/x',
      'http://[::1]/x',
    ];
    for (const url of urls) {
      await assert.rejects(
        () => webFetchTool({ url }, { fetch: async () => fakeResponse({}) }),
        /blocked|private|loopback|local/i,
      );
    }
  });

  test('truncates long content', async () => {
    const fetchStub = async () =>
      fakeResponse({ body: 'a'.repeat(100000), contentType: 'text/plain' });
    const res = await webFetchTool(
      { url: 'https://example.com', maxBytes: 1000 },
      { fetch: fetchStub },
    );
    assert.equal(res.truncated, true);
    assert.ok(res.content.length <= 1100);
  });

  test('timeout aborts the request', async () => {
    const fetchStub = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };
    await assert.rejects(
      () => webFetchTool({ url: 'https://slow.example.com', timeoutMs: 10 }, { fetch: fetchStub }),
      /timed out|timeout|abort/i,
    );
  });

  test('registered and dispatchable', async () => {
    const out = await dispatchToolCall(
      'web_fetch',
      { url: 'https://example.com' },
      { fetch: async () => fakeResponse({ body: '<p>ok</p>' }) },
    );
    assert.equal(out.success, true);
    assert.ok(out.result.content.includes('ok'));
  });

  test('guard blocks non-http url without prompting', async () => {
    const guard = new SecurityGuard({ baseDir: process.cwd(), autoApprove: false });
    const out = await dispatchToolCall(
      'web_fetch',
      { url: 'ftp://example.com' },
      { securityGuard: guard },
    );
    assert.equal(out.error, true);
  });
});

describe('web_search tool', () => {
  const liteHtml = `
    <html><body><table>
      <tr><td><a rel="nofollow" href="https://nodejs.org/api.html">Node.js docs</a></td></tr>
      <tr><td>Official Node.js documentation site.</td></tr>
      <tr><td><a rel="nofollow" href="https://expressjs.com/">Express</a></td></tr>
      <tr><td>Fast web framework for Node.</td></tr>
    </table></body></html>`;

  test('parses DDG Lite results', async () => {
    const fetchStub = async (url) => {
      assert.ok(String(url).includes('q=node%20test') || String(url).includes('q=node+test'));
      return fakeResponse({ body: liteHtml, contentType: 'text/html' });
    };
    const res = await webSearchTool({ query: 'node test' }, { fetch: fetchStub });
    assert.equal(res.results.length, 2);
    assert.equal(res.results[0].title, 'Node.js docs');
    assert.equal(res.results[0].url, 'https://nodejs.org/api.html');
    assert.ok(res.results[0].snippet.includes('Official'));
  });

  test('empty result set is not an error', async () => {
    const fetchStub = async () => fakeResponse({ body: '<html><body>No results</body></html>' });
    const res = await webSearchTool({ query: 'zzz' }, { fetch: fetchStub });
    assert.deepEqual(res.results, []);
  });

  test('missing query throws', async () => {
    await assert.rejects(
      () => webSearchTool({}, { fetch: async () => fakeResponse({}) }),
      /query/,
    );
  });

  test('registered and dispatchable', async () => {
    const out = await dispatchToolCall(
      'web_search',
      { query: 'x' },
      { fetch: async () => fakeResponse({ body: liteHtml }) },
    );
    assert.equal(out.success, true);
    assert.equal(out.result.results.length, 2);
  });

  test('guard prompts before searching', async () => {
    let prompted = false;
    const guard = new SecurityGuard({
      baseDir: process.cwd(),
      confirmationHandler: async () => {
        prompted = true;
        return true;
      },
    });
    const out = await dispatchToolCall(
      'web_search',
      { query: 'hello' },
      { securityGuard: guard, fetch: async () => fakeResponse({ body: '' }) },
    );
    assert.equal(out.success, true);
    assert.ok(prompted);
  });
});
