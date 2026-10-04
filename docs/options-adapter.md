# Options snapshot boundary

4 October 2026. Release candidate; confirm the live commit in Render before treating these fixes as deployed. No paid vendor request was used for verification.

`lib/polygonSnapshot.js` collects the provider's paginated snapshot within a 40-page and 60-second budget. Incomplete pagination, failed pages, repeated cursors and duplicate contracts are explicit failures of complete coverage. Continuation URLs are restricted to the same options snapshot path on the two provider API hosts; credentials use the Authorization header and redirects are rejected.

The retained legacy scope is standard 100-share contracts with more than zero and at most 30 calendar days until the provider expiration date interpreted at midnight UTC. This is an explicitly approximate date convention, not an exchange exercise or settlement timestamp. Nonstandard contracts are excluded and prevent complete-scope aggregate output. The adapter does not provide historical point-in-time data.

Spot comes only from an underlying observation with a provider timestamp. Previous stock close is no longer substituted for current spot. Quote, trade, daily-bar and underlying timestamps remain distinct from collection time. Nanosecond provider timestamps are exposed at millisecond precision. Missing numbers remain null; crossed quotes are unavailable. Open interest is previous-trading-day data with no fabricated exact observation time.

`dataTimestamp` is the latest known contract observation, not a common chain timestamp. Collection is not atomic. Its meaning, oldest observation, per-row timestamps, exclusions, coverage and quality flags are returned separately. A failed refresh can return a labelled stale cache while preserving original timestamps. Removing or changing the configured credential prevents reuse of that credential's cache.

Incomplete collections are prevented from feeding full-scope calculations. Missing IV/OI suppress dependent weighted metrics, and the server checks aggregate eligibility before its additional gamma/skew calculations. Quoted straddle cost requires valid bid/ask observations; there is no trade-price fallback. The regression fixture has call and put midpoints of 2.5 each: a straddle cost of 5, or 5/101 of the observed spot, rounded to the legacy displayed 5.0%.

## Verification and limitations

13 deterministic provider tests use mock responses, a fixed clock and a non-secret test credential. They cover pagination beyond three pages, budgets, failures, URL allowlisting, cycles, duplicates, observation times, missing values, contract exclusions, cache isolation, stale fallback, unknown spot and the hand-calculated straddle fixture. Existing analysis, evidence-contract, news and sentiment suites also pass (87 tests in total).

These tests validate the provider boundary, not all legacy metric formulae or production integration. Gamma/dealer-position assumptions, zero-gamma estimation, vanna units, expiry calendars, executable spreads, data entitlements and licence rights still require review before options-edge claims. `usableForAggregates` indicates required inputs and collection coverage, not historical availability, executable liquidity or validity of a trading signal. Render is confirmed to deploy `zqlnt/ainews` on `main`; Supabase owner isolation and native consumption remain unverified. CI checks both the deployed Node 20 runtime and the local Node 24 runtime.

Provider references inspected during implementation: [options chain snapshot](https://massive.com/docs/rest/options/snapshots/option-chain-snapshot) and [REST authentication](https://massive.com/docs/rest/quickstart). No vendor plan was purchased or terms accepted.
