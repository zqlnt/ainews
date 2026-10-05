# Traid forward scheduler

Prepared 5 October 2026. This is a deployment proposal and tested runner; **no Render cron has been created or enabled by this change**. The paid `ainews` web service is separate from a new cron service. The owner must approve the additional service and its charge before creation.

## Reviewed configuration

| Setting | Value |
| --- | --- |
| Render workspace | My Workspace (`tea-d2ths2ur433s73deh120`) |
| Proposed service | `traid-forward-daily` |
| Type / runtime | Cron Job / Node, Node 24 |
| Source | `https://github.com/zqlnt/ainews`, `main`, after the runner commit is published and remote CI passes |
| Compute | Smallest supported paid cron instance; verify quoted price in the creation review |
| Build command | `node --check scripts/traid-forward-job.mjs && node --test test/traidForwardJob.test.js` |
| Run command | `node scripts/traid-forward-job.mjs` |
| Schedule, UTC | `10 5,9 * * *` |
| Plain environment | `NODE_VERSION=24`, `TRAID_FORWARD_ORIGIN=https://traidfinance.com` |
| Secret environment | `TRAID_FORWARD_JOB_TOKEN`, the same dedicated random token configured only on the Sites writer |

The first invocation is **05:10 UTC daily**, after the writer's 20:00 New York completed-data threshold in both daylight and standard time. The **09:10 UTC** invocation is a catch-up before the next regular US session opens. Running daily includes Saturday settlement for Friday and weekend preparation; the server's exchange calendar decides whether work is due. The client never creates its own trading calendar, assigns timestamps or backfills a missed signal.

Render evaluates schedules in UTC, permits one active run per cron service and delays an overlapping scheduled run until the previous one finishes. Runs have a 12-hour platform limit; cron services have no persistent disk. Billing is per active second with a **$1/month minimum per cron service**, so paying for a web service does not include this extra cron. This is a minimum, not a guaranteed monthly cap. [Render cron documentation](https://render.com/docs/cronjobs), verified 5 October 2026.

## Security and failure contract

The command sends one empty JSON POST to `/api/research/forward/job`. It accepts only the exact Traid production domain or the approved native Sites origin. There are no command arguments and no market-data keys on Render. The scoped bearer token can trigger the configured owner's writer; the caller cannot submit an owner, prices, dates, strategy parameters or fabricated observations. The writer remains responsible for authentication, durable event readback, idempotency, deadlines, simulation and research ownership.

The runner uses manual redirects and rejects every redirect without forwarding the token. Each request, including its response read, has a two-minute timeout. Response JSON is capped at 64 KiB. Network failures, HTTP 429/5xx and `error`/`waiting_data` outcomes get up to two retries after five and twenty seconds. The maximum request time is six minutes plus twenty-five seconds of backoff. A canceled process stops retrying. A retry can finish an interrupted operation, but cannot repair or hide a missed signal deadline.

`blocked` and `halted` outcomes are terminal. Authentication and other client errors, unknown statuses, malformed result envelopes, duplicate registration IDs, oversized responses and inconsistent success responses fail closed. HTTP 200 alone is insufficient for success. An empty registration list explicitly reports `idle_no_registrations`; this does not establish a working pilot.

Only fixed outcome categories, HTTP status, attempt number and counts by status are logged. Response bodies, registration IDs, reasons, prices, URLs and thrown error messages are never printed. Secrets must be configured through Render/Sites secret stores, never source, CLI arguments, build logs or an environment group shared with unrelated services. Generate at least 32 random bytes, encoded as hex or base64url; the runner accepts a 32–512 character header-safe token.

| Exit | Meaning |
| --- | --- |
| 0 | Checked safely, or explicitly idle |
| 2 | Configuration/runtime/CLI error |
| 3 | Network, timeout or retry-wait failure |
| 4 | HTTP/redirect failure |
| 5 | Invalid or inconsistent response |
| 6 | Blocked, halted or unresolved research operation |
| 143 | Interrupted by shutdown |

These exit codes are operational findings, not strategy verdicts. `waiting` and `complete` are healthy states but do not imply a fresh signal was written. The durable writer's event and attempt records must be checked during acceptance. A previously halted registration will continue to produce an attention status until the server's explicit lifecycle policy excludes it; the runner never silently ignores it.

## Activation and acceptance

1. Publish the tested runner and confirm the remote CI run for that exact commit. The existing CI calls `npm run test:all`, now including `test:forward-job`.
2. Complete Sites writer configuration and data/replay acceptance. Create a dedicated token in the two secret stores. Do not enable scheduling against a partial procedure or rewrite an existing frozen registration.
3. Obtain approval for the concrete cron service above, then create it with the minimum suitable compute plan. Configure Render job-failure notifications to the owner's existing notification destination; confirm them rather than assuming the default alerts work.
4. Trigger one manual job when no invocation is running. Render manual triggering cancels an already active run; avoid doing that during a real write. Inspect the exact deployed commit, exit code, sanitized logs and owner-scoped writer attempts/readback.
5. Verify the next two scheduled invocations and then consecutive real trading sessions: each required signal is persisted before the session open; each settlement uses the retained prior signal and the completed provider observation. Weekend `waiting`/duplicate-safe success is not a substitute for trading-session acceptance.
6. Exercise a transient failure and retry using a separate QA registration/environment, then confirm failure notification and recovery. Confirm a missing-deadline case halts instead of fabricating evidence. Do not induce a missed deadline on a real pilot registration.
7. Record deployment IDs, expected and actual UTC invocation times, writer attempt IDs, signal persistence timestamps and restore/replay evidence in the project checkpoint. Do not include the bearer token or private raw data in the checkpoint.

Cron success cannot detect a job that never started. Daily-use acceptance therefore also requires checking the writer's expected invocation receipt age (with a documented grace period), confirming a missed-heartbeat alert, and proving backup/restore separately. This runner alone is not an independent watchdog or backup system.

## Local verification

No new runtime dependencies are required; Node's built-in `fetch`, streams, abort controllers and test runner are used. `node --test test/traidForwardJob.test.js` exercises successful/idle results, exact-origin constraints, secret redaction, network and provider retry recovery, timeout, every redirect form, permanent failures, unknown/duplicate/oversized results, cancellation and CLI input rejection.

The 5 October local run passed all **16 new runner tests**. The full backend checks were also run directly with Node because this local runtime does not provide `npm`: analysis validator **15**, research contract **5**, news helpers **26**, sentiment **28**, options adapter **13**, runner **16**; **103 passed, zero failed**. No provider request, hosted invocation, deployment or remote CI run is implied by these local tests.
