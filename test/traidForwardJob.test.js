import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runForwardJob, EXIT } from '../scripts/traid-forward-job.mjs';

const TOKEN = 'scheduler_test_secret_must_never_be_logged';
const env = { TRAID_FORWARD_JOB_TOKEN: TOKEN };
const result = (statuses = ['current'], status = 200) => Response.json({ results: statuses.map((s, i) => ({ id: `private-study-${i}`, status: s, reason: `sensitive-provider-body-${TOKEN}` })) }, { status });
const harness = (responses, options = {}) => {
  const calls = [], logs = [], delays = [];
  const run = runForwardJob({
    env,
    fetchImpl: async (...args) => { calls.push(args); const next = responses.shift(); if (next instanceof Error) throw next; return next; },
    sleep: async ms => { delays.push(ms); },
    log: row => { logs.push(row); },
    ...options,
  });
  return { run, calls, logs, delays };
};

test('uses a scoped bearer, exact approved endpoint, empty input, and no redirect following', async () => {
  const h = harness([result(['current', 'waiting', 'complete'])]);
  assert.equal(await h.run, EXIT.ok);
  assert.equal(h.calls.length, 1);
  const [url, request] = h.calls[0];
  assert.equal(url, 'https://traidfinance.com/api/research/forward/job');
  assert.deepEqual(request.headers, { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` });
  assert.equal(request.method, 'POST');
  assert.equal(request.body, '{}');
  assert.equal(request.redirect, 'manual');
  assert.deepEqual(h.logs, [{ event: 'traid_forward_job', outcome: 'checked', attempt: 1, httpStatus: 200, counts: { current: 1, waiting: 1, complete: 1 } }]);
  assert.doesNotMatch(JSON.stringify(h.logs), /private-study|sensitive-provider|scheduler_test/);
});

test('the native approved origin is accepted without accepting lookalike hosts or paths', async () => {
  const origin = 'https://traid-research-terminal.zain01gul.chatgpt.site';
  const h = harness([result()], { env: { ...env, TRAID_FORWARD_ORIGIN: origin } });
  assert.equal(await h.run, EXIT.ok);
  assert.equal(h.calls[0][0], `${origin}/api/research/forward/job`);
  for (const bad of ['http://traidfinance.com', 'https://traidfinance.com.evil.example', 'https://traidfinance.com/', 'https://traidfinance.com?token=bad', 'https://user:pass@traidfinance.com', 'https://traidfinance.com:443']) {
    const denied = harness([], { env: { ...env, TRAID_FORWARD_ORIGIN: bad } });
    assert.equal(await denied.run, EXIT.config);
    assert.equal(denied.calls.length, 0);
    assert.equal(JSON.stringify(denied.logs).includes(bad), false);
  }
});

test('missing, short and unsafe secrets fail configuration without a request or secret output', async () => {
  for (const token of [undefined, '', 'short', `${TOKEN}\r\nother: value`, TOKEN + ' ', 'x'.repeat(513)]) {
    const h = harness([], { env: { TRAID_FORWARD_JOB_TOKEN: token } });
    assert.equal(await h.run, EXIT.config);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.logs, [{ event: 'traid_forward_job', outcome: 'invalid_configuration' }]);
  }
});

test('no registrations is explicit idle, not a working-pilot claim', async () => {
  const h = harness([result([])]);
  assert.equal(await h.run, EXIT.ok);
  assert.equal(h.logs[0].outcome, 'idle_no_registrations');
});

test('network failures retry twice, then exit transport with redacted diagnostics', async () => {
  const h = harness(Array.from({ length: 3 }, () => new Error(`https://private.example/${TOKEN}`)));
  assert.equal(await h.run, EXIT.transport);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.delays, [5000, 20000]);
  assert.deepEqual(h.logs.map(r => r.retry), [true, true, false]);
  assert.doesNotMatch(JSON.stringify(h.logs), /private\.example|scheduler_test/);
});

test('timeout aborts the request and exhausts only the bounded retry allowance', async () => {
  let aborted = 0;
  const h = harness([], {
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted++; reject(new Error(TOKEN)); }, { once: true })),
  });
  assert.equal(await h.run, EXIT.transport);
  assert.equal(aborted, 3);
  assert.deepEqual(h.logs.map(r => r.outcome), ['request_timeout', 'request_timeout', 'request_timeout']);
});

test('timeout remains active while a response body stalls after successful headers', async () => {
  let aborted = 0;
  const h = harness([], {
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"results":'));
        signal.addEventListener('abort', () => { aborted++; controller.error(new Error(TOKEN)); }, { once: true });
      },
    }), { headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(await h.run, EXIT.transport);
  assert.equal(aborted, 3);
  assert.deepEqual(h.logs.map(r => r.outcome), ['request_timeout', 'request_timeout', 'request_timeout']);
});

test('retry can recover a transient HTTP or provider failure without changing input', async () => {
  for (const failure of [new Response(TOKEN, { status: 502 }), new Response(TOKEN, { status: 429 }), new Response(TOKEN, { status: 503 }), Response.json({ error: TOKEN }, { status: 503 }), result(['waiting_data'], 503), result(['error'], 503)]) {
    const h = harness([failure, result()]);
    assert.equal(await h.run, EXIT.ok);
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.delays, [5000]);
    assert.equal(h.calls[0][1].body, h.calls[1][1].body);
    assert.doesNotMatch(JSON.stringify(h.logs), /scheduler_test/);
  }
});

test('authentication and other client failures are terminal and bodies remain private', async () => {
  for (const status of [400, 401, 403, 404, 405, 409, 422]) {
    const h = harness([new Response(TOKEN, { status })]);
    assert.equal(await h.run, EXIT.http);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.delays, []);
    assert.equal(h.logs[0].retry, false);
    assert.doesNotMatch(JSON.stringify(h.logs), /scheduler_test/);
  }
});

test('all redirect forms terminate after exactly one credentialed request', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const h = harness([new Response(null, { status, headers: { location: `https://untrusted.example/${TOKEN}` } })]);
    assert.equal(await h.run, EXIT.http);
    assert.equal(h.calls.length, 1);
    assert.equal(h.logs[0].outcome, 'redirect_rejected');
    assert.deepEqual(h.delays, []);
  }
});

test('halted or blocked research never retries, even mixed with transient failures', async () => {
  for (const statuses of [['halted'], ['blocked'], ['current', 'waiting_data', 'halted']]) {
    const h = harness([result(statuses, 503)]);
    assert.equal(await h.run, EXIT.research);
    assert.equal(h.calls.length, 1);
    assert.equal(h.logs[0].outcome, 'research_halted');
    assert.equal(h.logs[0].retry, false);
  }
});

test('an HTTP 200 response cannot disguise unhealthy research status', async () => {
  const h = harness([result(['halted'])]);
  assert.equal(await h.run, EXIT.research);
  assert.equal(h.logs[0].outcome, 'research_halted');
});

test('malformed, unknown, duplicate, oversized and contradictory results fail closed', async () => {
  const responses = [
    new Response('<html>OK</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    Response.json(null), Response.json({}), Response.json({ results: {} }),
    Response.json({ results: [{ id: 'x', status: 'successful' }] }),
    Response.json({ results: [{ id: 'x', status: 'current' }, { id: 'x', status: 'current' }] }),
    Response.json({ results: [{ id: '', status: 'current' }] }),
    Response.json({ results: new Array(501).fill({ id: 'x', status: 'current' }) }),
    result(['current'], 503),
    new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '65537' } }),
  ];
  for (const response of responses) {
    const h = harness([response]);
    assert.equal(await h.run, EXIT.protocol);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.delays, []);
  }
});

test('cancellation before a request and during a request stops without retrying', async () => {
  const before = new AbortController(); before.abort();
  const h = harness([], { signal: before.signal });
  assert.equal(await h.run, EXIT.interrupted);
  assert.equal(h.calls.length, 0);
  const during = new AbortController();
  const live = harness([], { signal: during.signal, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error(TOKEN))); during.abort(); }) });
  assert.equal(await live.run, EXIT.interrupted);
  assert.deepEqual(live.delays, []);
  assert.equal(live.logs[0].outcome, 'interrupted');
});

test('cancellation during backoff never starts another request', async () => {
  const controller = new AbortController();
  const h = harness([new Error(TOKEN)], { signal: controller.signal, sleep: async () => { controller.abort(); throw new Error(TOKEN); } });
  assert.equal(await h.run, EXIT.interrupted);
  assert.equal(h.calls.length, 1);
  assert.equal(h.logs.at(-1).outcome, 'interrupted');
});

test('CLI rejects arguments and missing environment without echoing them', () => {
  const script = new URL('../scripts/traid-forward-job.mjs', import.meta.url);
  for (const args of [[], [TOKEN]]) {
    const cli = spawnSync(process.execPath, [script.pathname, ...args], { env: {}, encoding: 'utf8' });
    assert.equal(cli.status, EXIT.config);
    assert.doesNotMatch(cli.stdout + cli.stderr, /scheduler_test/);
  }
});
