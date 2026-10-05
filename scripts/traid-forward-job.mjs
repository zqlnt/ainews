// Once-per-invocation scheduler client. The authenticated Sites writer owns all
// research decisions, clock/deadline checks, data acquisition and persistence.
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const ORIGINS = new Set(['https://traidfinance.com', 'https://traid-research-terminal.zain01gul.chatgpt.site']);
const STATUSES = new Set(['current', 'waiting', 'complete', 'blocked', 'halted', 'error', 'waiting_data']);
const TERMINAL = new Set(['blocked', 'halted']);
const TRANSIENT = new Set(['error', 'waiting_data']);
const MAX_BYTES = 65_536;
const TIMEOUT_MS = 120_000;
const RETRY_MS = [5_000, 20_000];
export const EXIT = Object.freeze({ ok: 0, config: 2, transport: 3, http: 4, protocol: 5, research: 6, interrupted: 143 });

class ProtocolError extends Error {}

async function boundedJSON(response) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new ProtocolError();
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new ProtocolError();
  if (!response.body) throw new ProtocolError();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new ProtocolError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    throw new ProtocolError();
  }
}

function classifyResults(payload) {
  if (!payload || !Array.isArray(payload.results) || payload.results.length > 500) throw new ProtocolError();
  const counts = {};
  const ids = new Set();
  for (const result of payload.results) {
    if (!result || typeof result.id !== 'string' || !result.id.length || result.id.length > 128 || ids.has(result.id) || !STATUSES.has(result.status)) throw new ProtocolError();
    ids.add(result.id);
    counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  return {
    counts,
    total: ids.size,
    terminal: Object.keys(counts).some(status => TERMINAL.has(status)),
    transient: Object.keys(counts).some(status => TRANSIENT.has(status)),
  };
}

// Dependency injection is for isolated tests; the CLI takes no command arguments.
export async function runForwardJob({ env = process.env, fetchImpl = globalThis.fetch, sleep = delay, log = record => console.log(JSON.stringify(record)), signal, timeoutMs = TIMEOUT_MS } = {}) {
  const origin = env.TRAID_FORWARD_ORIGIN ?? 'https://traidfinance.com';
  const token = env.TRAID_FORWARD_JOB_TOKEN;
  const emit = details => log({ event: 'traid_forward_job', ...details });
  if (!ORIGINS.has(origin) || typeof token !== 'string' || !/^[A-Za-z0-9._~-]{32,512}$/.test(token)) {
    emit({ outcome: 'invalid_configuration' });
    return EXIT.config;
  }
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > TIMEOUT_MS) {
    emit({ outcome: 'invalid_runtime' });
    return EXIT.config;
  }
  for (let attempt = 1; attempt <= RETRY_MS.length + 1; attempt++) {
    if (signal?.aborted) { emit({ outcome: 'interrupted', attempt }); return EXIT.interrupted; }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    let exitCode = EXIT.transport;
    let retryable = true;
    let outcome = 'request_failed';
    let httpStatus;
    let counts;
    try {
      const response = await fetchImpl(`${origin}/api/research/forward/job`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: '{}',
        redirect: 'manual',
        signal: controller.signal,
      });
      httpStatus = response.status;
      if (response.redirected || (httpStatus >= 300 && httpStatus < 400)) {
        await response.body?.cancel().catch(() => {});
        exitCode = EXIT.http; retryable = false; outcome = 'redirect_rejected';
      } else if (!response.ok && httpStatus !== 503) {
        await response.body?.cancel().catch(() => {});
        exitCode = EXIT.http;
        retryable = httpStatus === 429 || httpStatus >= 500;
        outcome = 'http_failure';
      } else if (httpStatus === 503 && !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel().catch(() => {});
        exitCode = EXIT.http; outcome = 'writer_unavailable';
      } else {
        const payload = await boundedJSON(response);
        // An unavailable writer can return a redacted {error} envelope before
        // any registration is loaded. Its text must never enter scheduler logs.
        if (httpStatus === 503 && payload && !Object.hasOwn(payload, 'results') && typeof payload.error === 'string') {
          exitCode = EXIT.http; outcome = 'writer_unavailable';
        } else {
          const results = classifyResults(payload);
          counts = results.counts;
          if (results.terminal || results.transient) {
            exitCode = EXIT.research;
            retryable = !results.terminal;
            outcome = results.terminal ? 'research_halted' : 'research_retry_required';
          } else if (!response.ok) {
            exitCode = EXIT.protocol; retryable = false; outcome = 'inconsistent_response';
          } else {
            emit({ outcome: results.total ? 'checked' : 'idle_no_registrations', attempt, httpStatus, counts });
            return EXIT.ok;
          }
        }
      }
    } catch (error) {
      // Do not log thrown text: fetch/proxy/provider errors may include secrets
      // or private response content. Only allowlisted categories leave here.
      if (error instanceof ProtocolError) {
        exitCode = EXIT.protocol; retryable = false; outcome = 'invalid_response';
      } else if (controller.signal.aborted) outcome = 'request_timeout';
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
    if (signal?.aborted) { emit({ outcome: 'interrupted', attempt }); return EXIT.interrupted; }
    const retry = retryable && attempt <= RETRY_MS.length;
    emit({ outcome, attempt, ...(httpStatus === undefined ? {} : { httpStatus }), ...(counts ? { counts } : {}), retry });
    if (!retry) return exitCode;
    try {
      await sleep(RETRY_MS[attempt - 1], undefined, { signal });
    } catch {
      emit({ outcome: signal?.aborted ? 'interrupted' : 'retry_wait_failed', attempt });
      return signal?.aborted ? EXIT.interrupted : EXIT.transport;
    }
  }
  return EXIT.transport;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error(JSON.stringify({ event: 'traid_forward_job', outcome: 'arguments_not_allowed' }));
    process.exitCode = EXIT.config;
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    try {
      process.exitCode = await runForwardJob({ signal: controller.signal });
    } catch {
      console.error(JSON.stringify({ event: 'traid_forward_job', outcome: 'unexpected_failure' }));
      process.exitCode = EXIT.transport;
    } finally {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
    }
  }
}
