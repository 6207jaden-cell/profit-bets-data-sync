# CHANGELOG.md

A running narrative of what shipped and why — distinct from git history,
which explains individual commits. This explains the story across them
for someone who wasn't present. Recommended in `ENGINEERING_CONSTITUTION.md`
Section 12 since the constitution was first written; this is its first
real entry.

Format per entry: date, what changed, why, files touched, verification
performed.

---

## 2026-08-05 — Stage 2, Priority 1: Fixed `evaluate-alerts.ts` authorization

**What changed:** `evaluate-alerts.ts` now verifies the caller's `apikey`
header before touching any data, returning 401 if it's missing or
incorrect.

**Why:** The endpoint had zero authorization — the handler didn't even
accept a `request` parameter, so the check its own code comment described
was never actually implemented. Anyone who discovered the URL could
trigger service-role-privileged execution with no rate limit. Found
during the Stage 1 security audit (`SECURITY_AUDIT.md` Finding 1,
`BUG_TRACKER.md` BUG-001), fixed as Stage 2's first priority per the
Critical-before-anything-else sequencing in `ROADMAP.md`.

**How it was fixed:** Rather than a one-off inline check (which is what
led to Finding 2's near-identical bug existing alongside this one —
`sync-crons.ts` checked presence but not correctness), built a shared,
unit-tested utility (`src/lib/api-auth.ts`) that both this fix and
Priority 2's fix use identically. `verifyPublicApiKey(request, expectedKey)`
is a pure function taking the expected key as an explicit parameter
specifically so it's testable without mocking environment variables.

**Files changed:**
- `src/lib/api-auth.ts` (new)
- `src/lib/__tests__/api-auth.test.ts` (new, 9 tests)
- `src/routes/api/public/evaluate-alerts.ts`
- `project-audit/SECURITY_AUDIT.md` (Finding 1 marked fixed)

**Tests added:** 9 tests covering: correct key accepted, incorrect key
rejected, missing header rejected, empty-string header rejected, the
exact BUG-002 regression pattern (any non-empty string incorrectly
passing a naive presence-only check) explicitly locked in as rejected,
case-sensitivity, whitespace handling (documented as platform/Headers-API
behavior, not application logic), and fail-safe behavior when the
server's own expected key is itself missing/misconfigured.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: clean (sandbox)
- `npx vitest run`: all passing including the new 9 (sandbox)
- Independent fresh-clone + fresh-install verification per the new
  Release Verification Rule (`ENGINEERING_CONSTITUTION.md` Section 8),
  since this change touches authentication — see verification log below.

**Remaining risk:** `sync-crons.ts` (Finding 2) still has its own,
different auth bug as of this entry — fixed next as Priority 2, using
the same shared utility. Rate limiting (Priority 3) is not yet in place,
so this endpoint — now correctly rejecting unauthorized callers — still
has no protection against a caller who *does* have the correct key
making unlimited requests.

---

## 2026-08-05 — Stage 2, Priority 2: Fixed `sync-crons.ts` authorization

**What changed:** `sync-crons.ts` now uses `verifyPublicApiKeyFromEnv()`
(the same shared utility built for Priority 1) instead of its previous
`if (!apikey)` presence-only check.

**Why:** The existing check verified the `apikey` header was non-empty
but never compared it against the real secret — any non-empty string
passed. Lower real-world severity than Priority 1's finding (the
operation is idempotent, re-registers a fixed cron list, doesn't expose
or mutate user data) but still improper access control on an
admin-privileged action. `SECURITY_AUDIT.md` Finding 2.

**How it was fixed:** Reused the exact same tested utility from Priority
1 rather than writing a second, potentially-inconsistent inline check —
this is precisely the pattern whose absence caused Findings 1 and 2 to
exist as two different bugs in the first place.

**Files changed:**
- `src/routes/api/public/sync-crons.ts`
- `project-audit/SECURITY_AUDIT.md` (Finding 2 marked fixed)

**Tests added:** None new — this fix is covered by the same 9 tests
added for Priority 1, since it calls the identical utility. The test
suite's "rejects ANY non-empty string" case is explicitly the regression
pattern this exact bug represents.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: clean (sandbox)
- `npx vitest run`: 77/77 passing (sandbox)
- Independent fresh-clone + fresh-install verification per the Release
  Verification Rule, since this touches authentication.

**Remaining risk:** Both Priority 1 and Priority 2's endpoints are now
correctly authorized but still have no rate limiting — Priority 3, next.

---

## 2026-08-05 — Stage 2, Priority 3: Application-level rate limiting

**What changed:** All 15 `/api/public/*` endpoints now enforce a rate
limit, checked after authentication succeeds. Exceeding the limit returns
429 with a `Retry-After` header.

**Why:** Zero rate limiting existed anywhere in the codebase
(`SECURITY_AUDIT.md` Finding 4). Combined with the now-fixed Findings 1
and 2, an endpoint with broken auth AND no rate limit was the worst-case
combination — even correctly-authorized endpoints had no ceiling on
request volume from a caller holding a valid (or leaked) key.

**How it was fixed:** Shared, reusable infrastructure
(`src/lib/rate-limit.ts`) rather than 15 separate implementations —
Postgres-backed (no Redis in this architecture), atomic via a row-locked
SECURITY DEFINER function to avoid a real race condition a naive
select-then-write would have under concurrent cron overlaps. Each
endpoint configures its own limit, window, and identifier strategy
(global-per-endpoint for cron-only endpoints; per-IP for the
browser-triggered `emergency-exit`; per-user for the expensive,
user-initiated `agent-backtest`) without duplicating any logic.

**Files changed:**
- `src/lib/rate-limit.ts` (new)
- `src/lib/__tests__/rate-limit.test.ts` (new, 17 tests)
- `supabase/migrations/20260805010000_rate_limiting.sql` (new — table +
  atomic increment function + cleanup function)
- `supabase/migrations/20260805010500_rate_limit_cleanup_cron.sql` (new
  — registers the cleanup cron; also registers `evaluate-alerts` as an
  actual cron job, discovered to be missing despite its own code comment
  claiming otherwise)
- All 15 route files under `src/routes/api/public/`
- `project-audit/SECURITY_AUDIT.md` (Finding 4 marked fixed)

**Tests added:** 17 — allowed/blocked at the limit boundary, window
reset (verified with a real timed wait, not simulated), bucket
independence, 3 distinct fail-open scenarios (RPC throws, RPC returns an
error field, RPC returns malformed data), the 429 response shape and
header, both bucket-key strategies, and env-var override configurability
including malformed-input handling.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox) — caught and fixed one real
  issue along the way: a variable name collision (`rl`) between the new
  rate-limit config and a pre-existing, unrelated variable in
  `generate-strategies.ts`
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 94/94 passing (17 new)
- Independent fresh-clone + fresh-install verification per the Release
  Verification Rule, since this touches database access and (via the
  route changes) authentication-adjacent request handling.

**Remaining risks:**
- Deliberately fails open on rate-limiter infrastructure errors — a
  documented tradeoff (availability of legitimate cron traffic over
  strict enforcement during a transient DB issue), not an oversight.
- Two different auth-check implementations across the 15 endpoints
  (discovered, not fixed — see `SECURITY_AUDIT.md` Finding 4 for detail
  and reasoning on why this was left for a follow-up rather than folded
  into this change).
- All Stage 2 Critical items (1–3) are now complete. Priority 4
  (dependency vulnerability remediation) remains.

---

## 2026-08-05 — Stage 2, Priority 4: Dependency vulnerability remediation

**What changed:** Applied `npm audit fix` for the 2 known high-severity
CVEs (`SECURITY_AUDIT.md` Finding 6, `BUG_TRACKER.md` BUG-005). `npm
audit --omit=dev` now reports 0 vulnerabilities.

**Why:** `js-yaml` (quadratic-CPU DoS vector via YAML merge-key chains)
and `postcss` (path traversal allowing arbitrary `.map` file disclosure)
were flagged in the Stage 1 audit but deliberately not applied until now
without re-verification.

**How it was fixed:** `npm audit fix` resolved both at the patch-version
level — no major version bumps: `js-yaml` 4.2.0 → 4.3.1, `postcss`
8.5.15 → 8.5.25. Checked before applying that both are transitive
build-tooling dependencies (via `@tanstack/react-start`/`eslint` and
`vite` respectively), not direct application code — lower risk than a
runtime dependency change would carry.

**Files changed:**
- `package.json`, `package-lock.json`
- `project-audit/SECURITY_AUDIT.md` (Finding 6 marked fixed)
- `project-audit/BUG_TRACKER.md` (BUG-005 marked fixed)
- `project-audit/TECHNICAL_DEBT.md` (TD-06 marked resolved)
- `project-audit/ROADMAP.md` (item 5 marked done)

**Tests added:** None new — this is a dependency version change, not new
logic. Full existing suite re-run to confirm nothing broke.

**Verification performed:**
- `npm audit --omit=dev`: 0 vulnerabilities (was 2 high)
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 94/94 passing (sandbox)
- Independent fresh-clone + fresh-install verification per the Release
  Verification Rule, since this is explicitly a dependency change.

**Remaining risk:** None specific to this change. This completes all
four Stage 2 priorities — Critical items 1–3 (auth, auth, rate limiting)
and this dependency fix. Per the explicit instruction for this stage,
Stage 3 (analytics) should not begin until this is verified complete,
which the fresh-clone check below confirms.

---

## 2026-08-05 — Stage 3, first slice: core risk-adjusted performance metrics

**What changed:** New `src/lib/performance-metrics.ts` with Sharpe ratio,
Sortino ratio, maximum drawdown, profit factor, expectancy, average
win/loss, and win rate with a real 95% Wilson-score confidence interval.
New `PerformanceMetricsPanel` dashboard in the History tab.

**Why:** `TECHNICAL_DEBT.md` TD-12 flagged this as the single most
important foundational gap — no page anywhere could answer "is this
system actually better than randomly investing in the market." This is
the first, highest-priority slice of the full Stage 3 list (Sharpe,
Sortino, Max Drawdown, Profit Factor, Expectancy, Average Win, Average
Loss, Average R, Rolling Performance, Volatility, Alpha, Beta,
Correlation to SPY, Rolling Correlation, Exposure, Holding Time, Win
Rate, Trade Distribution, Session Performance, Regime Performance,
Portfolio/Signal/Claude/Learning Attribution) — the rest remains
separate, sequenced work, not silently dropped.

**How it was built:** Every formula documented with its exact
convention (population vs. sample stdev, Sortino's total-N downside
deviation denominator, Sharpe annualization derived from actual observed
trade frequency rather than assumed daily cadence, Wilson score over the
simpler normal approximation for small-sample correctness) so there's
never ambiguity about which textbook definition is in use. Every
function returns `null` rather than `Infinity`/`NaN` for undefined cases
(no losses for profit factor, zero variance for Sharpe, etc.) — designed
to be hard to misuse downstream.

**Files changed:**
- `src/lib/performance-metrics.ts` (new)
- `src/lib/__tests__/performance-metrics.test.ts` (new, 23 tests)
- `src/features/trading/components/PerformanceMetricsPanel.tsx` (new)
- `src/features/trading/TradingDashboard.tsx` (wired into History tab)
- `project-audit/TECHNICAL_DEBT.md` (TD-12 marked partially resolved)

**Tests added:** 23, every one asserting a hand-computed expected value
— including a Sharpe/Sortino pair computed from the identical return
series to cross-check the Sortino-more-forgiving-of-upside-volatility
property directly, a Wilson CI computed by hand against the exact
"68% over 24 trades" example already used in `HYPOTHESIS_LOG.md` H4, and
an expectancy cross-check confirming `expectancy == winRate*avgWin -
lossRate*avgLoss` holds exactly, not just approximately.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 117/117 passing (23 new)

**Remaining risk / honest limitations, stated in the code and the UI
itself, not hidden:**
- Max drawdown is computed from a synthetic realized-P&L curve
  (sequential trade compounding), not true mark-to-market equity — this
  understates real intra-period volatility for a system where multiple
  positions can be open simultaneously. Documented directly in
  `performance-metrics.ts` and the panel's own footer text.
- The UI shows an explicit "provisional, not enough data yet" warning
  below 20 closed trades — every number is real, but not yet trustworthy
  as a stable estimate at low sample sizes.
- Alpha, Beta, and correlation-to-SPY (the actual "benchmark comparison"
  TD-12 originally called for) are NOT part of this slice — genuinely
  separate work requiring SPY return data aligned to matching trade
  windows, remains open.

---

## 2026-08-05 — Stage 3, second slice: real Alpha/Beta/Correlation-to-SPY

**What changed:** New `computeBeta`, `computeAlpha`, `computeDailyReturns`
in `performance-metrics.ts`, plus a new server function
(`getBenchmarkComparison`) that fetches real data and computes them.
Wired into `PerformanceMetricsPanel`.

**Why:** The first slice deliberately deferred the actual "benchmark
comparison" TD-12 originally called for — this closes that gap.

**How it was built:** Uses REAL daily-aligned data rather than a
synthetic approximation — `portfolio_snapshots` (already collected daily
by the existing `snapshot-portfolio` cron) matched by calendar date
against SPY's own daily closes (`fetchBars`). Beta/Alpha specifically
need genuine calendar-time alignment between two independently-sourced
series to be meaningful; the trade-sequence curve used for Sharpe/Sortino
in the first slice wouldn't have been appropriate here. Date alignment
matches by calendar day (not exact timestamp), since portfolio snapshots
and SPY bars are captured at different times by different systems —
exact-timestamp matching would have silently dropped nearly everything.

Beta = Cov(portfolio returns, SPY returns) / Var(SPY returns). Alpha =
Jensen's alpha, the excess return not explained by the portfolio's market
exposure alone. Correlation reuses the existing, already-tested
`computeCorrelation` from `indicators.ts` rather than a new formula.

**Files changed:**
- `src/lib/performance-metrics.ts` (added computeBeta, computeAlpha,
  computeDailyReturns)
- `src/lib/__tests__/performance-metrics.test.ts` (11 new tests, 34 total)
- `src/lib/benchmark-comparison.functions.ts` (new)
- `src/features/trading/components/PerformanceMetricsPanel.tsx` (wired in)
- `project-audit/TECHNICAL_DEBT.md` (TD-12 updated — core + benchmark
  comparison now resolved, remaining sub-items listed explicitly)

**Tests added:** 11 — Beta and Alpha hand-computed against the same
known return series (cross-checked together), Beta≈1 when a series is
compared against itself, Beta returning null on zero benchmark variance
(not divide-by-zero), mismatched-length series correctly truncating to
the most recent overlapping window, Alpha≈0 when a portfolio exactly
tracks its benchmark, and daily-returns computation including the
zero/negative-prior-value edge case.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 128/128 passing (11 new)

**Remaining risk / honest limitations:**
- Requires several days of `portfolio_snapshots` history to produce any
  result — a brand-new account correctly shows "not enough daily
  portfolio history yet" rather than a misleading number from too little
  data.
- Still uses the same 20-observation "provisional" floor as the rest of
  this panel, shown explicitly in the UI, not hidden.
- Rolling metrics, exposure, holding-time/trade distribution,
  regime-conditional performance, and all four attribution categories
  remain open — see `TECHNICAL_DEBT.md` TD-12 for the full remaining list.

---

## 2026-08-05 — Stage 3, third slice: Signal Attribution and Claude Attribution

**What changed:** Two of the four Stage 3 attribution categories now
exist — `computeSignalAttribution` (dollar P&L decomposition by signal)
and `computeClaudeAttribution` (Claude's actual picks vs. pure
deterministic ranking, head-to-head). New `AttributionPanel` in the
History tab.

**Why:** Both were natural next slices specifically because they extend
already-tested infrastructure from earlier sessions rather than starting
from scratch — Experiment 4's per-signal tracking and Experiment 1's
shadow candidate logging. Claude Attribution directly operationalizes
`HYPOTHESIS_LOG.md` H2 ("does Claude add value compared to deterministic
rules alone") using data that's already been accumulating since
Experiment 1 shipped.

**How it was built:**

Signal Attribution reads real closed-trade dollar P&L directly (not the
averaged stats in `agent_signal_weights`, since attribution needs actual
dollar amounts) and sums it per signal. Important methodological point
documented directly in the code and the UI: a trade commonly has
multiple signals active simultaneously, and each gets FULL credit for
that trade's P&L — so percentages across signals typically sum to more
than 100%, not exactly 100%. This is "credit sharing" attribution (how
much did this signal touch), not a strict partition, and arbitrarily
splitting credit across co-occurring signals would imply a precision
about individual causal contribution that isn't actually knowable from
this data.

Claude Attribution reads resolved `shadow_candidate_log` rows and splits
them into two groups: Claude's actual picks (`agree_traded` +
`disagree_claude_added`) vs. what the deterministic top-6 ranking alone
would have captured (`agree_traded` + `disagree_claude_skipped`) —
`agree_traded` rows correctly count toward BOTH groups since both
systems agreed on them. Gated at 30 resolved rows per side before
treating the comparison as meaningful, matching the threshold already
specified in `EXPERIMENT_RESULTS.md`.

Both exposed via new server functions
(`src/lib/attribution.functions.ts`) using the RLS-scoped
`context.supabase` client, not `supabaseAdmin` — both underlying tables
already have "users read own rows" policies, so no service-role access
was needed.

**Files changed:**
- `src/lib/signal-learning.ts` (added `computeSignalAttribution`)
- `src/lib/shadow-experiments.ts` (added `computeClaudeAttribution`)
- `src/lib/attribution.functions.ts` (new)
- `src/lib/__tests__/signal-attribution.test.ts` (new, 6 tests)
- `src/lib/__tests__/claude-attribution.test.ts` (new, 6 tests)
- `src/features/trading/components/AttributionPanel.tsx` (new)
- `src/features/trading/TradingDashboard.tsx` (wired into History tab)
- `project-audit/TECHNICAL_DEBT.md`, `HYPOTHESIS_LOG.md` (H2 updated)

**Tests added:** 12 — Signal Attribution's hand-computed dollar
decomposition across overlapping signals (explicitly verifying the
>100% sum is expected, not a bug), manual trades correctly excluded from
signal-level attribution but still counted in the total, divide-by-zero
guard on exactly-zero total P&L. Claude Attribution's hand-computed
head-to-head average, `agree_traded` counting toward both groups,
the 30-sample evidence floor on both sides independently, and a
negative-added-value case correctly indicating underperformance.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 140/140 passing (12 new)

**Remaining risk / honest limitations:**
- Both panels correctly show "not enough data yet" states — Claude
  Attribution needs resolved shadow-log data (1–4 day horizon), Signal
  Attribution needs closed trades with `entry_signals` populated (only
  since Stage 2's signal-learning work began tracking it).
- Portfolio Attribution and Learning Attribution remain open. Learning
  Attribution specifically already has real infrastructure sitting
  behind it too (Experiment 2's `shadow_weighting_comparison`) — not yet
  surfaced as a proper attribution analysis, a natural next slice.

---

## 2026-08-05 — Stage 3, fourth slice: Learning Attribution

**What changed:** `computeLearningAttribution` (new, `shadow-experiments.ts`)
— the 3rd of 4 Stage 3 attribution categories. Wired into
`AttributionPanel`.

**Why:** Directly operationalizes `HYPOTHESIS_LOG.md` H3 ("does adaptive
signal weighting improve returns") using Experiment 2's
`shadow_weighting_comparison` data, which has been collecting since
commit `c892f06`. Only Portfolio Attribution remains of the original
four attribution categories after this.

**How it was built:** Splits resolved rows by `rank_delta` sign —
"promoted" (adaptive weighting ranked the candidate higher than neutral
weighting would have) vs. "demoted" (ranked lower) — and compares their
average resolved returns. This is literally the exact comparison
`EXPERIMENTS.md` E-02 and `EXPERIMENT_RESULTS.md`'s "how to read
results" section for Experiment 2 already described; this function is
that description turned into code, not a new analysis design. Gated at
30 resolved rows per side, same threshold as Claude Attribution.

**Files changed:**
- `src/lib/shadow-experiments.ts` (added `computeLearningAttribution`)
- `src/lib/attribution.functions.ts` (added `getLearningAttribution`)
- `src/lib/__tests__/learning-attribution.test.ts` (new, 6 tests)
- `src/features/trading/components/AttributionPanel.tsx` (wired in)
- `project-audit/TECHNICAL_DEBT.md`, `HYPOTHESIS_LOG.md` (H3 updated)

**Tests added:** 6 — hand-computed promoted/demoted average return
comparison, `rank_delta === 0` correctly excluded from both groups (not
silently included in one), the 30-sample floor checked independently on
each side, and a negative-added-value case explicitly framed as
supporting the multiple-comparisons/noise concern rather than disproving
adaptive learning's value — the honest interpretation either direction
of this result could show.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 146/146 passing (6 new)

**Remaining risk / honest limitations:**
- Correctly shows "not enough data yet" for brand-new accounts.
- As already documented for the underlying experiment: most signals are
  still near-neutral early on (few have crossed the 15-trade Kelly
  threshold), so meaningful promotion/demotion is expected to be rare at
  first — the UI's provisional warning specifically calls this out
  rather than letting a near-empty comparison look conclusive either way.
- Only Portfolio Attribution remains of the original four attribution
  categories; rolling metrics, exposure, holding-time distribution, and
  regime-conditional performance remain open per `TECHNICAL_DEBT.md` TD-12.

---

## 2026-08-05 — Stage 3, fifth slice: Portfolio Attribution (all 4 categories complete)

**What changed:** `computePortfolioAttribution` (new
`src/lib/portfolio-attribution.ts`) — the 4th and last of the four Stage
3 attribution categories. Wired into `AttributionPanel`.

**Why:** Closes the attribution set. Answers a genuinely different
question than the other three: not "which signal/Claude/learning
mechanism was involved," but "which specific assets and asset classes is
the P&L actually coming from."

**How it was built:** Decomposes realized P&L by symbol and by asset
class (stock/etf/crypto/options, with all four options instrument
variants — call/put/call_spread/put_spread — collapsed into one
"options" bucket). Reads the same `paper_trades` dollar-P&L data source
as Signal Attribution, for consistency — both should always sum to the
identical total. Worth stating explicitly as a deliberate contrast: this
IS a true partition (every trade has exactly one symbol and one asset
class), so percentages sum to exactly 100%, unlike Signal Attribution's
deliberate >100% credit-sharing for co-occurring signals.

**Files changed:**
- `src/lib/portfolio-attribution.ts` (new)
- `src/lib/__tests__/portfolio-attribution.test.ts` (new, 7 tests)
- `src/lib/attribution.functions.ts` (added `getPortfolioAttribution`)
- `src/features/trading/components/AttributionPanel.tsx` (wired in)
- `project-audit/TECHNICAL_DEBT.md` (TD-12 — all 4 attribution categories now complete)

**Tests added:** 7 — hand-computed multi-symbol/multi-asset-class
decomposition, the exact-100% partition check (explicitly contrasted
against Signal Attribution's >100% case), every documented instrument
type correctly classified (including all 4 options variants collapsing
into one bucket), null-instrument fallback to "stock" matching the same
convention already used in `estimateFees`, and the zero-total
divide-by-zero guard.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 153/153 passing (7 new)

**This completes all four Stage 3 attribution categories** (Signal,
Claude, Learning, Portfolio). What remains of the full Stage 3 list:
rolling metrics (rolling Sharpe, rolling correlation over time),
exposure, holding-time/trade distribution, and regime-conditional
performance — tracked in `TECHNICAL_DEBT.md` TD-12.

---

## 2026-08-05 — Stage 3, sixth slice: rolling metrics

**What changed:** `computeRollingMetrics` and `computeRollingTrend`
(new, `performance-metrics.ts`) — rolling Sharpe, Sortino, and win rate
over a trailing 10-trade window. Shown as a trend chart in
`PerformanceMetricsPanel`, only once at least 5 rolling points exist (14+
total trades) so it shows an actual trend rather than 1-2 isolated dots.

**Why:** A single aggregate Sharpe/win-rate number can hide whether a
strategy is currently improving or deteriorating — a great overall
figure could still be smoothing over a recent decline. This answers "is
it getting better or worse right now," not just "what has it been
historically."

**How it was built:** Deliberately reuses `computeSharpeRatio` and
`computeSortinoRatio` directly rather than re-deriving the formulas for
a windowed context — one tested implementation applied to sliding
windows instead of the whole history. `computeRollingTrend` compares
only the two most recent windows, giving a direct "vs. prior window"
delta shown next to the chart.

**Files changed:**
- `src/lib/performance-metrics.ts` (added `computeRollingMetrics`,
  `computeRollingTrend`)
- `src/lib/__tests__/performance-metrics.test.ts` (8 new tests, 42 total)
- `src/features/trading/components/PerformanceMetricsPanel.tsx` (wired
  in as a rolling win-rate trend chart)
- `project-audit/TECHNICAL_DEBT.md` (TD-12 updated)

**Tests added:** 8 — hand-computed rolling win rate over a known
6-trade/window-3 sequence (4 expected windows, each verified by hand),
empty result for fewer trades than the window size, empty result for an
invalid window size, chronological sorting applied regardless of input
order (verified by shuffling the same trades and confirming an
identical result), each point's date matching the last trade in its
window, and the trend delta correctly signed in both directions.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 161/161 passing (8 new)

**Remaining risk / honest limitations:**
- Only win-rate/Sharpe/Sortino roll over time so far — rolling
  correlation/Beta/Alpha (comparing the trend of market exposure itself,
  not just risk-adjusted return) is a separate, not-yet-built piece.
- The 10-trade window and "needs 5 points" thresholds are reasonable
  defaults, not empirically tuned — worth revisiting once real trade
  volume exists to see if they're the right granularity.
- Exposure, holding-time/trade distribution, and regime-conditional
  performance remain open per `TECHNICAL_DEBT.md` TD-12.

---

## 2026-08-05 — Stage 3, seventh slice: trade distribution histograms

**What changed:** `computeReturnDistribution` and
`computeHoldingTimeDistribution` (new, `performance-metrics.ts`) — two
histograms shown in `PerformanceMetricsPanel`: how trade returns are
distributed across fixed ranges, and how long trades are actually held.

**Why:** An aggregate expectancy or win-rate number can't show whether
results cluster tightly or are driven by a few fat-tail outliers, and
can't show whether this is genuinely a scalp-dominated system or
positions are lingering far longer than intended.

**How it was built:** Both use fixed, documented bucket boundaries
(returns: <-10%, -10 to -5%, -5 to -2%, -2 to 0%, 0 to 2%, 2 to 5%, 5 to
10%, >10%; holding time: <1hr, 1-4hr, 4-24hr, 1-3 days, 3-7 days, >7
days) rather than dynamically-computed bins — a histogram with
data-dependent bin edges can't be compared meaningfully across different
report runs or different users. A boundary value itself (e.g. exactly
-5% or exactly 24 hours) is documented to fall into the LOWER bucket,
verified by a dedicated test for each function. Both are true partitions
— bucket percentages sum to exactly 100%.

**Files changed:**
- `src/lib/performance-metrics.ts` (added `computeReturnDistribution`,
  `computeHoldingTimeDistribution`)
- `src/lib/__tests__/performance-metrics.test.ts` (8 new tests, 50 total)
- `src/features/trading/components/PerformanceMetricsPanel.tsx` (wired
  in as two bar-chart histograms, loss-side buckets colored distinctly
  from win-side buckets in the return distribution)
- `project-audit/TECHNICAL_DEBT.md` (TD-12 updated)

**Tests added:** 8 — every one of the 8 return buckets and all 6 holding-
time buckets hand-verified with a value landing in each, the boundary-
value-falls-in-lower-bucket rule explicitly tested for both functions,
empty-input handling, and the exactly-100% partition check for both.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 169/169 passing (8 new)

**Remaining risk / honest limitations:**
- Bucket boundaries are reasonable defaults, not empirically tuned to
  this system's actual typical trade sizes — worth revisiting once real
  volume exists.
- Rolling correlation/Beta/Alpha, exposure (cash vs. deployed,
  concentration), and regime-conditional performance remain open per
  `TECHNICAL_DEBT.md` TD-12 — the last three items of the full Stage 3
  list.

---

## 2026-08-05 — Stage 3, eighth slice: Exposure

**What changed:** `computeExposure` (new, `src/lib/exposure.ts`) — cash
vs. deployed capital, position concentration via the Herfindahl-Hirschman
Index, and exposure by asset class. New `ExposurePanel`, placed at the
top of the History tab.

**Why:** A genuinely different question than everything else built in
Stage 3 so far: not "how did past trades perform" but "how much capital
is actually at risk right now, and how concentrated is it." Reads
CURRENT open positions and current portfolio balance — a different data
shape than the historical closed-trade analysis every other Stage 3
piece has used.

**How it was built:** Concentration uses the Herfindahl-Hirschman Index
— sum of each position's squared percentage share of deployed capital,
the same standard formula used in antitrust economics for market
concentration, applied here to position sizing (0 = infinitely
diversified, 10000 = a single position holding everything). Position
size uses ENTRY VALUE (quantity × entry_price), not live mark-to-market
value — a deliberate, documented tradeoff: computing live value would
require a quote fetch for every open position on every panel load, and
entry-basis sizing more directly reflects the actual risk-allocation
decision made at entry rather than day-to-day price noise. Reuses
`classifyAssetClass` from Portfolio Attribution (now exported) rather
than duplicating the instrument-classification logic.

**Files changed:**
- `src/lib/exposure.ts` (new)
- `src/lib/exposure.functions.ts` (new, server function)
- `src/lib/portfolio-attribution.ts` (exported `classifyAssetClass` for reuse)
- `src/lib/__tests__/exposure.test.ts` (new, 6 tests)
- `src/features/trading/components/ExposurePanel.tsx` (new)
- `src/features/trading/TradingDashboard.tsx` (wired in at the top of the History tab)
- `project-audit/TECHNICAL_DEBT.md` (TD-12 updated)

**Tests added:** 6 — the full hand-computed cash/deployed/HHI/largest-
position example, HHI=10000 exactly for maximum concentration (single
position), HHI=1000 for 10 equally-sized positions (diversified case),
null concentration fields (not zero) when there are no open positions,
asset-class grouping, and a null portfolio row handled gracefully.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 175/175 passing (6 new)

**Remaining risk / honest limitations:**
- Entry-value position sizing means this can drift from true current
  exposure as prices move — stated directly in the code and the panel's
  own subtitle text, not hidden.
- The HHI concentration thresholds shown (unconcentrated/moderate/
  concentrated) are borrowed from antitrust economics as a reference
  point, not empirically validated for this system specifically.
- Rolling correlation/Beta/Alpha and regime-conditional performance
  remain open — the last two items of the full Stage 3 list, tracked in
  `TECHNICAL_DEBT.md` TD-12.

