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

---

## 2026-08-05 — Stage 3, ninth slice (FINAL): rolling Beta/Alpha/correlation and regime-conditional performance

**What changed:** `computeRollingBenchmarkMetrics` and
`computeRegimePerformance` (new, `performance-metrics.ts`), plus a new
`src/lib/regime-performance.functions.ts`. Both wired into
`PerformanceMetricsPanel`. **This completes the entire original Stage 3
list** — all nine slices, all independently fresh-clone verified.

**Why:** The last two items on the Stage 3 list. Rolling correlation/
Beta/Alpha extends the existing rolling-metrics infrastructure to market
exposure over time — a single aggregate Beta can hide exposure drifting
over the account's lifetime. Regime-conditional performance answers
whether this system actually performs differently in bull vs. bear vs.
sideways markets, or whether the aggregate expectancy is hiding a
strategy that only works in one regime.

**How rolling benchmark metrics were built:** Reuses `computeBeta`,
`computeAlpha`, `computeDailyReturns` (all already in this module) and
`computeCorrelation` (`indicators.ts`) directly, applied to sliding
windows of the aligned portfolio/SPY value series. Caught and documented
a real constraint while testing: `computeCorrelation` has its own
internal floor of ≥10 value points before it returns a non-null result
— a rolling window smaller than that will compute valid Beta/Alpha (no
such floor) but silently show null correlation for every point. Now
stated directly in the function's own docstring. Wired into
`benchmark-comparison.functions.ts` with a 20-day window (satisfies the
floor, matches this project's established "20 observations" trust
threshold) and shown as a rolling Beta line chart.

**How regime-conditional performance was built — the real design
decision:** Two genuine options existed here. (1) Only record regime
going forward on new trades — simpler, but would produce zero usable
results on all trade history that already exists, since nothing already
in the database has a stored regime. (2) Reconstruct regime
RETROACTIVELY from historical SPY data. Chose (2): one broad SPY history
fetch, then for each trade, slice that history to end at the trade's
entry date and re-run the exact same live `detectMarketRegime`
(`indicators.ts`) algorithm the system actually uses — not a separately-
invented classification scheme, the identical function, applied
historically. This works on trade history that already exists today,
at the cost of one broader fetch instead of a schema change. The
tradeoff, stated directly in the code: this assumes `detectMarketRegime`
hasn't changed its own definition of bull/bear/sideways since these
trades happened — true as of this writing, worth re-checking if that
function is ever revised.

**Files changed:**
- `src/lib/performance-metrics.ts` (added `computeRollingBenchmarkMetrics`,
  `computeRegimePerformance`)
- `src/lib/__tests__/performance-metrics.test.ts` (13 new tests, 60 total
  in this file)
- `src/lib/benchmark-comparison.functions.ts` (extended to also return
  `rollingPoints`)
- `src/lib/regime-performance.functions.ts` (new)
- `src/features/trading/components/PerformanceMetricsPanel.tsx` (wired
  in: rolling Beta chart, regime performance table)
- `project-audit/TECHNICAL_DEBT.md` (TD-12 marked RESOLVED — closed)
- `project-audit/ROADMAP.md` (Stage 2 and Stage 3 completion noted)

**Tests added:** 13 — rolling Beta/Alpha/correlation staying exactly
constant across every window when portfolio returns are constructed as
exactly K times the benchmark's throughout (a strong, hand-verifiable
invariant: Beta=2, Alpha=0, correlation≈1 in every single window by
construction), empty-array handling for undersized windows and inputs,
truncation to the shorter of two mismatched series, near-(-1) correlation
for an inversely-related series, regime performance's hand-computed
per-regime stats across a known mixed set, sorting by trade count,
zero-win-rate shown as exactly 0 not null, and only observed regimes
appearing in output (no zero-filled rows for regimes never seen).

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 185/185 passing (13 new)
- Independent fresh-clone + fresh-install verification to follow, per
  the Release Verification Rule.

**Remaining risk / honest limitations:**
- Regime reconstruction does one SPY history fetch per panel load
  (cached hourly client-side) — for accounts with a long trading history,
  this fetch is broader and slightly more expensive than the other
  panels' queries, a real but bounded cost.
- The retroactive-regime assumption (that `detectMarketRegime`'s
  definition hasn't changed) is stated directly in the code as the one
  thing that would need re-checking if that function is ever revised.
- **This closes out the entire original Stage 3 list.** Per the staged
  protocol, Stage 3.5 (Statistical Validation) or Stage 4 (Optimization,
  which requires evidence from Stage 3/3.5) are the natural next steps —
  neither has been started, noted honestly rather than implied done.

---

## 2026-08-06 — Correction: Stage 3 was not actually "fully" complete

**What happened:** When TD-12 was closed and Stage 3's ninth slice
committed, both `TECHNICAL_DEBT.md` and `ROADMAP.md` stated "the full
original Stage 3 list" was built. This was inaccurate. Checked against
the original 24-item request while answering a direct user question
("show me each stage and tier still to do"), three items were never
built, and this wasn't caught until asked directly rather than found
through the project's own review discipline — worth stating plainly.

**What was actually wrong:**
- **Average R** (risk-normalized return, not raw %) — never built.
- **Volatility** as a standalone reported figure — never built. It
  exists only internally inside the Sharpe/Sortino calculations, never
  surfaced as its own number.
- **Risk Attribution** — never built. The original request named FIVE
  attribution categories (Portfolio, Signal, Claude, Learning, Risk);
  only four were built, and "all four attribution categories" was
  presented as satisfying the requirement without noting a fifth had
  been named and dropped.
- **Session Performance** was correctly delivered, but via pre-existing
  `SessionPerformancePanel` from before Stage 3 started, not new Stage 3
  work — miscounted as a Stage 3 deliverable.

**What's genuinely true and unaffected by this correction:** the nine
slices that WERE built are real, tested, and independently fresh-clone
verified — that part of the record stands. Only the "this is the
complete original list" framing was wrong.

**Files changed:**
- `project-audit/TECHNICAL_DEBT.md` (TD-12 status corrected from
  RESOLVED to LARGELY RESOLVED, the three gaps listed explicitly)
- `project-audit/ROADMAP.md` (claim corrected, new item 13b added
  tracking the three missing pieces as real, open work)

**No code changed** — this is a documentation-accuracy correction, not
a feature change. No verification commands apply beyond confirming the
three claims above are actually true, which was done by checking the
built files against the original request line by line before writing
this entry.

---

## 2026-08-06 — Fixed BUG-004: `.env` untracked from git

**What changed:** `.env`/`.env.local`/`.env.*.local` added to
`.gitignore`; `.env` removed from git tracking (`git rm --cached`) while
the file itself remains present, unchanged, on disk.

**Why:** `SECURITY_AUDIT.md` Finding 5 / `BUG_TRACKER.md` BUG-004 —
`.env` was committed with no gitignore exclusion. Verified low severity
at the time of the original finding (contents are the Supabase
publishable/anon key and public project ID/URL only — not the
service-role key, not any of the genuinely secret API keys, which are
set as Lovable environment secrets server-side and never appear in this
file) — but hygiene worth fixing regardless, to prevent a future
genuinely-secret value being added to this same file and committed by
habit.

**Files changed:**
- `.gitignore`
- `.env` (untracked, not deleted from disk)
- `project-audit/SECURITY_AUDIT.md` (Finding 5 marked fixed)
- `project-audit/BUG_TRACKER.md` (BUG-004 marked fixed)

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 186/186 passing (sandbox)

**Remaining risk, stated honestly:** this sandbox cannot verify actual
Lovable Cloud deploy behavior once `.env` is untracked. The assumption
(Lovable injects real environment variables at deploy time independent
of this file) comes from the original security audit's reasoning, not
a confirmed real deploy. Worth an actual deploy-and-check in production
before treating this as fully closed end-to-end, not just in-sandbox.

---

## 2026-08-06 — Fix TD-13: consolidate auth-check implementations

**What changed:** All 15 `/api/public/*` endpoints now use the same
shared, tested `verifyPublicApiKeyFromEnv()` utility. The 5 that
previously used a different (but not broken) variant — `daily-digest`,
`evaluate-strategies`, `generate-strategies`, `resolve-signals`,
`snapshot-portfolio` — are now migrated.

**Why:** Real, undocumented drift flagged during Priority 3 (rate
limiting): 10 endpoints checked `apikey !== SUPABASE_PUBLISHABLE_KEY`
directly; 5 also fell back to `SUPABASE_ANON_KEY` and checked an
alternate `"Apikey"` header capitalization. Both worked correctly —
this was never a BUG-001/002-style hole — but it's exactly the kind of
inconsistency that let BUG-001/002 exist as two separate bugs in the
first place, left deliberately unfixed at the time to avoid scope creep.

**How it was verified before changing anything:** Two things checked
directly rather than assumed. (1) Whether the `"Apikey"` capitalized
fallback did anything — confirmed with a real `Headers` object that
`.get("apikey")` and `.get("Apikey")` return identically, since the
Fetch API spec normalizes header name lookups case-insensitively. It
was dead code. (2) Whether the `anon` variable was used anywhere besides
the auth check — found `evaluate-strategies.ts` reuses it as an outbound
header value when calling `generate-strategies.ts` after retiring a
strategy. Preserved as its own variable there rather than only inlined
into the auth check, so that call kept working.

**Files changed:** `daily-digest.ts`, `evaluate-strategies.ts`,
`generate-strategies.ts`, `resolve-signals.ts`, `snapshot-portfolio.ts`,
`TECHNICAL_DEBT.md` (TD-13 resolved), `SECURITY_AUDIT.md` (Finding 4's
sub-note resolved), `ROADMAP.md` (item 13a marked done).

**Tests added:** None new — this reuses `verifyPublicApiKeyFromEnv()`
and `unauthorizedResponse()`, both already covered by the 9 tests in
`api-auth.test.ts` from Priority 1.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 198/198 passing (sandbox)
- Independent fresh-clone + fresh-install verification, since this
  touches authentication.

**Known, accepted behavior change:** the 5 migrated endpoints previously
returned `{ ok: false, error: "unauthorized" }` (JSON) on auth failure;
now return plain text "Unauthorized", matching the other 10 endpoints.
Both are 401s. These are pg_cron-triggered background jobs, not UI-
facing endpoints whose error bodies get parsed — treated as a safe
consistency improvement, not a risk, but noted explicitly rather than
silently changed.

---

## 2026-08-06 — Correction + completion: TD-13 auth consolidation was actually incomplete

**What happened:** The previous entry claimed "all 15 endpoints now use
the same shared, tested utility." That was inaccurate — only 7 files
literally called `verifyPublicApiKeyFromEnv()`. The other 8 had their
own inline copy of the check: 7 correct (direct comparison, just not
consolidated in code), and `agent-backtest.ts` had a genuinely different,
previously-uncaught THIRD auth variant this document's own TD-13
investigation missed. Found while doing an unrelated methodology review
of `agent-backtest.ts` for the backtest-correctness item flagged since
the original audit.

**What changed:** All 8 remaining files migrated onto
`verifyPublicApiKeyFromEnv()` — `autonomous-agent`, `autonomous-exit-check`,
`autonomous-learning`, `emergency-exit`, `friday-review`,
`resolve-shadow-experiments`, `sync-robinhood-balance`, and
`agent-backtest`. A fresh sweep of every route file now confirms the
shared utility is genuinely used everywhere the apikey-header auth model
applies — the claim from the previous entry is accurate now.

**Files changed:** the 8 route files above, `TECHNICAL_DEBT.md` (TD-13
correction appended).

**Tests added:** None new — same reasoning as the original TD-13 fix,
this reuses already-tested shared functions.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 198/198 passing (sandbox)
- A fresh, direct grep sweep of every route file (not a claim taken on
  faith) confirming the shared utility is imported everywhere it should
  be, and no `SUPABASE_ANON_KEY`/`"Apikey"` fallback references remain
  anywhere.

---

## 2026-08-06 — Review: `agent-backtest.ts` methodology (3 real findings)

**What changed:** Reviewed `agent-backtest.ts` line-by-line for the
correctness issues flagged as deferred since the original Pass 1 audit
(look-ahead bias, incorrect date handling, optimistic fill assumptions).
Found three real issues, fixed one, flagged two for dedicated follow-up
work rather than rushed inline fixes.

**Finding 11 — same-bar execution bias (not fixed, flagged):** The
backtest's scoring and trade-entry logic read the identical array index:
`price = u.closes[day]` computes the momentum score, `entry =
c.u.closes[day]` is the trade's entry price — the SAME bar. This assumes
the backtest can transact at the exact closing price used to generate
the signal, with zero latency, which isn't achievable in live trading.
This systematically inflates every trade's reported return, compounding
across the whole simulation. Not fixed inline — changes every subsequent
index calculation in the loop and deserves its own careful review and
tests (`ROADMAP.md` item 6a).

**Finding 12 — misleading header comment (fixed):** The file's own
top comment claimed it "Simulates the autonomous agent's core rule
(momentum + regime alignment)." Grepped the file — "regime" appears
exactly once, in that comment. There is no regime detection or
regime-conditional logic anywhere in the actual code; the backtest is
pure momentum-vs-SMA50 ranking with equal-weight sizing, no Claude
review, no correlation/breadth/Kelly adjustments. Rewrote the comment to
accurately describe what the code does, and added an explicit pointer to
`TRADING_ENGINE_REVIEW.md` Findings 11-13 so a future reader hits the
caveats before trusting the endpoint's output.

**Finding 13 — no slippage or fee modeling (not fixed, flagged):**
Returns are raw `(exit - entry) / entry` — no cost model applied at all,
despite this project having both slippage (`src/lib/slippage.ts`) and
fees (`src/lib/cost-reality.ts`) built and already applied to every real
paper trade elsewhere. A direct, real inconsistency: the tooling to fix
this already exists, it's just never piped through this specific
endpoint. Not fixed inline — moderate, well-scoped follow-up
(`ROADMAP.md` item 6b).

**Combined assessment, stated directly:** these three findings compound.
`agent-backtest.ts`'s current output should not be treated as credible
evidence of the live system's actual edge — not because any individual
finding is severe, but because all three point the same direction
(systematically optimistic results) and none has been corrected except
the documentation. This is now stated explicitly in the code's own
header comment, not just in this changelog.

**Files changed:**
- `src/routes/api/public/agent-backtest.ts` (header comment corrected)
- `project-audit/TRADING_ENGINE_REVIEW.md` (Findings 11-13 added,
  "Not yet reviewed" section updated — this item is no longer deferred)
- `project-audit/ROADMAP.md` (item 6 marked done, new items 6a/6b
  tracking the two real unfixed issues)
- `project-audit/SYSTEM_AUDIT.md` (Pass 2 summary updated)

**Tests added:** None — this pass was a methodology review, not a code
change beyond the one-line comment correction. Findings 11 and 13 will
need real tests once actually fixed (item 6a/6b), consistent with this
project's standard for any change to trading-relevant calculations.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 198/198 passing (sandbox) — unchanged, since no
  testable logic changed
- Independent fresh-clone + fresh-install verification to follow.

**Remaining risk, stated plainly:** Findings 11 and 13 remain unfixed.
Anyone using `agent-backtest.ts`'s output to evaluate whether the
trading strategy has real edge should read `TRADING_ENGINE_REVIEW.md`
Findings 11-13 first — the numbers it currently produces are
systematically more favorable than a live version of the same rule
would actually achieve.

---

## 2026-08-06 — Fix Finding 11: `agent-backtest.ts`'s same-bar execution bias

**What changed:** `agent-backtest.ts`'s core simulation loop now enters
trades at the next trading session's open (`opens[day + 1]`) instead of
the same closing price used to generate the momentum signal
(`closes[day]`). Extracted into a new pure function, `simulateBacktestDay`
(`src/lib/backtest-simulation.ts`), rather than editing the inline loop.

**Why:** The most severe of the three findings from reviewing this
endpoint. Scoring and entry previously read the identical array index —
the backtest assumed it could transact at the exact closing price that
generated the signal, with zero latency, which isn't achievable in live
trading. This systematically inflated every trade's reported return,
compounding across the whole simulation.

**How it was fixed:** Extracted rather than patched inline, specifically
because this project's standard requires real tests for any change to
trading-relevant calculations, and this kind of off-by-one index change
is exactly the sort of thing that's easy to get subtly wrong without
them. Entry is `opens[day + 1]` (the next session's open — chosen over
next-bar-close as the more realistic of the two options considered:
you see a day's close after the fact, decide to act, and the earliest
achievable fill is the following session's open). Exit is
`closes[day + 1 + holdDays]`. A second small pure function,
`lastValidSimulationDay`, computes the correct loop boundary so the
route handler and its tests agree on the exact same off-by-one logic
rather than each computing it independently.

**Files changed:**
- `src/lib/backtest-simulation.ts` (new)
- `src/lib/__tests__/backtest-simulation.test.ts` (new, 7 tests)
- `src/routes/api/public/agent-backtest.ts` (now uses the extracted
  function; `loadAll`/`SymBars` updated to also capture `opens`, not
  just `closes`; header comment updated to mark Finding 11 fixed)
- `project-audit/TRADING_ENGINE_REVIEW.md` (Finding 11 marked fixed,
  the "combined impact" note updated to reflect only Finding 13 remains
  genuinely open)
- `project-audit/ROADMAP.md` (item 6a marked done)

**Tests added:** 7 — a full hand-computed day simulation (momentum
scoring across two symbols built so SMA50 is computable by hand, correct
symbol selection by momentum ranking, and the exact entry/exit/return
values, landing on a clean 10% return by construction), an explicit
assertion that the entry price is never equal to the scoring price (the
precise invariant this fix exists to guarantee), correct top-N selection
with more than one pick per day, graceful handling of insufficient SMA
history and missing/invalid entry prices, and the loop-boundary
function's off-by-one logic verified directly.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 205/205 passing (7 new)
- Independent fresh-clone + fresh-install verification to follow, since
  this is a trading-calculation change.

**Remaining risk:** Finding 13 (no slippage/fee modeling) is still open
— `agent-backtest.ts`'s output is now execution-timing-realistic but
still doesn't reflect real trading costs, and still tests a narrower
strategy than the full live system (documented in the file's own header
comment). Not a complete picture yet, meaningfully improved.

---

## 2026-08-06 — Fix Finding 13: `agent-backtest.ts` now applies realistic slippage

**What changed:** `simulateBacktestDay` now applies
`estimateSlippageBps`/`applySlippage` (`src/lib/slippage.ts`) to both
entry and exit, using a documented assumed order size. This is the
second and final fix from the `agent-backtest.ts` methodology review —
both findings that made the endpoint's reported numbers systematically
optimistic (Finding 11, same-bar execution; Finding 13, this one) are
now resolved.

**Why:** Returns were computed as raw `(exit - entry) / entry` with zero
cost modeling, despite this project having slippage and fee modeling
built and applied to every real paper trade elsewhere — a direct,
avoidable inconsistency.

**How it was built:** `ASSUMED_ORDER_NOTIONAL` ($10,000) is an explicit,
documented default — this backtest doesn't track real position sizing,
so there's no "real" account size to derive this from. Average daily
volume is passed as unknown for every symbol (this backtest doesn't
fetch historical volume data), correctly landing in
`estimateSlippageBps`'s conservative "unknown liquidity" tier rather
than assuming best-case liquidity. `isCryptoSymbol` (`indicators.ts`) is
reused, not reinvented, to apply the correct crypto-vs-stock slippage
tier. Fees are deliberately still NOT modeled: `estimateFees()` only
charges for options instruments, and this backtest's fixed 30-symbol
universe never includes any — documented directly in the code as the
reason, rather than silently omitted.

**Files changed:**
- `src/lib/backtest-simulation.ts` (slippage applied to entry/exit)
- `src/lib/__tests__/backtest-simulation.test.ts` (existing entry/exit
  test updated for the new slippage-adjusted values, 2 new tests added)
- `src/routes/api/public/agent-backtest.ts` (header comment updated —
  Finding 13 marked fixed)
- `project-audit/TRADING_ENGINE_REVIEW.md` (Finding 13 marked fixed,
  combined-impact note updated — both severity-affecting findings are
  now resolved)
- `project-audit/ROADMAP.md` (item 6b marked done)

**Tests added:** 2 new, plus 1 existing test updated with hand-computed
slippage-adjusted values (verified the real `estimateSlippageBps`
formula directly against source before computing expected numbers, not
assumed from memory). New tests: slippage always makes the reported
return worse than the raw return in both directions (a win shrinks, a
loss grows — never the reverse), and crypto symbols get a measurably
wider slippage adjustment than stocks, matching the real formula's
higher crypto base spread and liquidity multiplier.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 207/207 passing (sandbox)
- Independent fresh-clone + fresh-install verification to follow, since
  this is a trading-calculation change.

**Correction made during this same pass:** initially wrote "all Stage 2
Medium items are now complete" in `ROADMAP.md` — checked the actual
Medium section before leaving that claim in place and found it was
wrong; items 10 (price staleness check), 11 (cron-overlap guard), and 12
(Robinhood OAuth state hardening) remain open. Corrected immediately
rather than left standing, consistent with this project's own standard
that overclaims get fixed the moment they're found, not left for later.

**Remaining risk:** `agent-backtest.ts`'s output is now a meaningfully
more credible signal — both findings that made it systematically
optimistic are fixed — but it still only tests a narrower momentum-only
strategy than the full live system, which is now explicitly documented
rather than implied otherwise.

---

## 2026-08-06 — Fix Finding 6: price-fetch staleness check (partial, stated honestly)

**What changed:** `fetchQuotePrice` (`indicators.ts`) now checks quote
freshness for the two fallback sources that reliably expose a timestamp
— Yahoo (`meta.regularMarketTime`) and Finnhub (`t`) — and skips a stale
response in favor of continuing down the fallback chain, rather than
trusting it immediately. New pure, tested `isQuoteStale()` function.

**Why:** None of the four price sources' responses were ever checked
against a staleness threshold — a technically-valid but several-minutes-
old quote was used exactly as if it were live, which matters for scalp
entries and exit-check stop/target comparisons specifically.

**How it was scoped, honestly:** Not all four sources get the same
treatment, and that's deliberate, not an oversight. Polygon's `/prev`
endpoint is structurally the previous trading day's close — during live
market hours it's *always* "old" by design, so a live-freshness check
would defeat its purpose as a fallback. Alpha Vantage's `GLOBAL_QUOTE`
only exposes a trading date, too coarse for a minute-level check, and
it's the last fallback anyway. The check is gated by `isMarketOpen()`
for stocks (a Friday-close price is correctly old all weekend) and
always-on for crypto (24/7 trading).

**A real constraint stated directly, not glossed over:** this sandbox
has no network access to `finance.yahoo.com` or `finnhub.io`, so the
assumed field names (`regularMarketTime`, `t`) could not be confirmed
against a live API response while building this. `isQuoteStale()` is
designed defensively for exactly this reason — a missing or unparseable
timestamp is treated as "cannot determine staleness, don't reject,"
never as "assume stale." If either field name turns out to be wrong,
this degrades gracefully to the previous (unchecked) behavior for that
specific source rather than breaking quote fetching. This is flagged as
worth a real check against live traffic when convenient — not claimed
as fully verified, because it isn't.

**Files changed:**
- `src/lib/indicators.ts` (`isQuoteStale` added, `fetchQuotePrice`
  updated for the 2 sources)
- `src/lib/__tests__/indicators.test.ts` (6 new tests, 13 total in file)
- `project-audit/TRADING_ENGINE_REVIEW.md` (Finding 6 updated with full
  detail, including the verification caveat)
- `project-audit/ROADMAP.md` (item 10 marked done, same caveat carried
  through)

**Tests added:** 6 for `isQuoteStale` — within-threshold, over-threshold,
the exact boundary (age == maxAge is not yet stale), missing timestamp
(null/undefined both return false, not stale), invalid timestamp
(zero/negative/NaN), and future-timestamp clock skew not being treated
as stale. `fetchQuotePrice` itself is not unit-tested (does real network
fetches, consistent with this project's established pattern of not
testing network-calling functions directly, only their pure logic).

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 213/213 passing (6 new)
- Independent fresh-clone + fresh-install verification to follow.
- **NOT performed, stated directly:** live verification against real
  Yahoo/Finnhub API responses, since this environment's network access
  doesn't reach those domains. This is a real, named gap, not silently
  skipped.

**Remaining risk:** the field-name assumptions this fix relies on are
unverified against live traffic. Worth checking directly when there's
network access to those APIs, to confirm the staleness check actually
fires rather than silently always no-op due to a wrong field name.

---

## 2026-08-06 — Fix Finding 5: cron-overlap guard

**What changed:** New shared, reusable `src/lib/cron-lock.ts`
(`tryAcquireCronLock`/`releaseCronLock`), applied to `autonomous-agent.ts`
(locked per session type) and `autonomous-exit-check.ts` (a single
global lock). A slow-running invocation can no longer overlap with the
next scheduled one for the same session type.

**Why:** Crypto and scalp scans both fire every 30 minutes, exit-checks
every 10 minutes — if any single invocation ran long, nothing prevented
the next scheduled one from starting before it finished. This was an
unverified architectural gap, not a confirmed-safe pattern.

**How it was built:** Same atomic pattern already established for rate
limiting — a row-locked SECURITY DEFINER function
(`try_acquire_cron_lock`) rather than a naive TypeScript-side
select-then-write, which would have the exact same race condition this
table exists to close. `autonomous-agent.ts` locks per session type
(`scalp_scan`, `crypto_scan`, etc.) since different session types
running concurrently is legitimate — only the same type overlapping
with itself is the problem. `autonomous-exit-check.ts` uses one global
lock since it has only a single schedule. TTLs (10 min / 5 min) are
comfortably under each endpoint's cron interval while generous for
normal completion.

**A real scope limitation, stated directly, not glossed over:** these
are large, pre-existing route handlers (`autonomous-agent.ts` alone is
over 1600 lines) with multiple exit points. Wrapping the entire function
body in a new `try/finally` to guarantee lock release under every
possible code path would have been a much larger, riskier structural
change than this fix warranted. Instead, the lock is explicitly released
at each of the function's existing return points — verified by grepping
for every actual return statement in each file before writing the fix,
not assumed to be a fixed small number. An uncaught exception in code
that runs outside the per-user loop (which already has its own internal
error handling) before reaching one of these explicit release points
would leave the lock held until its TTL expires rather than released
immediately. Accepted as a bounded tradeoff — worst case, the next
scheduled invocation for that session type is skipped once, not
indefinitely — rather than pretending a full try/finally rewrite of a
1600-line function was consequence-free.

**Files changed:**
- `src/lib/cron-lock.ts` (new)
- `src/lib/__tests__/cron-lock.test.ts` (new, 8 tests)
- `supabase/migrations/20260806000000_cron_locks.sql` (new — table +
  atomic acquire/release functions + cleanup function)
- `supabase/migrations/20260806000500_cron_lock_cleanup_cron.sql` (new
  — registers the cleanup cron)
- `src/routes/api/public/autonomous-agent.ts` (lock acquired after
  `sessionType` is determined, released at all 3 return points)
- `src/routes/api/public/autonomous-exit-check.ts` (lock acquired after
  rate limiting, released at both return points)
- `project-audit/TRADING_ENGINE_REVIEW.md` (Finding 5 marked fixed,
  including the scope-limitation caveat)
- `project-audit/ROADMAP.md` (item 11 marked done)

**Tests added:** 8 — successful acquire, blocked acquire (the actual
overlap-prevention behavior), exact lock key/TTL passed through to the
RPC, 2 distinct fail-open scenarios (RPC throws, RPC returns an error
field — a lock-check outage must not block a scheduled trading scan),
different lock keys being independent (bypass prevention — one session
type's lock doesn't block another), and release being best-effort
(never throws, since the TTL is the real safety net regardless).

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 221/221 passing (8 new)
- Independent fresh-clone + fresh-install verification to follow, since
  this touches database access and cron-triggered trading endpoints.

**Remaining risk:** the error-path lock-release gap described above is
real, bounded, and accepted — not eliminated. Items 12 (OAuth state
hardening) and 13b (Average R, Volatility, Risk Attribution) remain the
last tracked items from this audit pass.

---

## 2026-08-06 — Fix Finding 3: Robinhood OAuth `state` hardening

**What changed:** New `generateOAuthState()`/`verifyOAuthState()`
(`mcp-oauth.server.ts`) — a genuine random anti-CSRF nonce, replacing the
previous use of the user's own ID as the OAuth `state` parameter. Stored
in a new `mcp_connections.oauth_state` column.

**Why:** OAuth's `state` parameter exists specifically as an
unguessable, random anti-CSRF nonce. Using `user_id` directly isn't
textbook-correct, even though real-world exploitability was already low
— PKCE (`code_verifier`/`code_challenge`) independently prevents the
actual token-exchange attack this would otherwise enable. This closes
the defense-in-depth gap, not an actively exploitable hole.

**A real architectural discovery made while fixing this, worth
recording plainly:** this codebase has TWO separate OAuth completion
paths for Robinhood, not one. `completeRobinhoodConnection`
(`mcp-client.functions.ts`) is the genuinely live flow — the UI has the
user paste a full callback URL after Robinhood redirects to a loopback
address, confirmed directly by `AgentPanel.tsx`'s own placeholder text.
`callback.ts` (`src/routes/api/public/mcp/robinhood/callback.ts`, the
file the original finding named) is a registered, still-reachable route
that the current initiation flow never generates a URL pointing to — it
may be legacy or unused, but "probably unreachable" isn't a reason to
leave a real gap unfixed, so both paths were updated, not just the
confirmed-live one.

**How it was built:** The new `oauth_state` column deliberately doesn't
reuse the table's existing column simply named `state` — that one
tracks connection lifecycle status (`authenticating`/`ready`/`failed`),
a completely different concept from OAuth's `state` parameter, and
reusing the name would have been a real, confusing collision, caught
before writing any code by reading the existing schema first.
`callback.ts` was additionally changed to look up its connection row BY
the nonce value directly (`eq("oauth_state", state)`) rather than by a
caller-claimed `user_id` — the more correct pattern regardless, since
the caller should never need to assert whose connection this is; only
possessing the exact nonce from the original redirect should prove that.

**Files changed:**
- `src/lib/mcp-oauth.server.ts` (`generateOAuthState`, `verifyOAuthState`)
- `src/lib/__tests__/mcp-oauth.test.ts` (new, 10 tests)
- `supabase/migrations/20260806001000_oauth_state_nonce.sql` (new)
- `src/lib/mcp-client.functions.ts` (both `initiateRobinhoodConnection`
  and `completeRobinhoodConnection` updated)
- `src/routes/api/public/mcp/robinhood/callback.ts` (lookup changed from
  `user_id` to `oauth_state`, verification added)
- `project-audit/SECURITY_AUDIT.md` (Finding 3 marked fixed, including
  the two-paths discovery)
- `project-audit/ROADMAP.md` (item 12 marked done)

**Tests added:** 10 — non-empty output, uniqueness across calls (a real
nonce must never repeat), URL-safe character set, an entropy sanity
floor, exact-match verification, mismatch rejection, missing-state
handling checked independently on BOTH sides (a callback with no state
must never match a row with no stored state, and vice versa — two
absent values are not a match), and case sensitivity.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 231/231 passing (10 new)
- Independent fresh-clone + fresh-install verification to follow, since
  this touches authentication.

**A correction made during this same pass, worth recording:** while
writing this entry's ROADMAP.md update, an early draft claimed this
"closes the last remaining item from this audit pass except item 13b
and the classifier review" — checked the actual LOW section before
leaving that in place and found it was wrong (items 13, 14, 15, and 16
are also still open). Corrected before finalizing, the same discipline
applied consistently since the cron-lock fix caught a similar overclaim
about "all Stage 2 Medium items."

**Remaining risk:** none specific to this fix — genuinely resolved, not
a partial mitigation like Findings 5/6 were. All of `ROADMAP.md`
MEDIUM (items 8-12) is now complete. LOW items 13/13b/14/15/16 and the
classifier review remain open.

---

## 2026-08-06 — Item 13 (partial): SSRF review finds and partially fixes a real OAuth discovery gap

**What changed:** New `isHttpsUrl()` (`mcp-oauth.server.ts`), applied at
every hop of both OAuth-server-discovery implementations
(`mcp-oauth.server.ts` and `robinhood-live.ts`, which turned out to have
their own separate copies of the same discovery logic). Rejects any
discovered URL that isn't HTTPS before fetching it.

**Why:** A full SSRF review of the ~30 dynamic `fetch()` calls across
this codebase found that nearly all of them use hardcoded hostnames with
only query-parameter values varying — not the SSRF pattern. But both
OAuth discovery chains follow a multi-hop sequence where each URL is
extracted from the PREVIOUS response (`resource_metadata` from a header,
then `authorization_servers[0]` from a JSON body) with no validation at
all — not even a scheme check. The final discovered endpoints are later
used for real OAuth token exchanges.

**Honest severity assessment:** confirmed by grepping every call site
before writing this up — both implementations are currently only ever
invoked with a single hardcoded Robinhood URL. Exploiting this today
requires compromising Robinhood's own infrastructure or breaking TLS,
both a high bar. The architectural concern is that
`mcp-oauth.server.ts`'s version takes the MCP URL as a generic
parameter — clearly designed for future multi-server support — and that
generality is exactly what makes domain validation matter once/if a
less-trusted server is ever added.

**What this fix does and does NOT do, stated directly:** HTTPS
enforcement closes the simplest sub-case — a network-level attacker
downgrading a redirect to plaintext HTTP without needing to defeat TLS
at all. It does NOT close the full concern: a compromised or malicious
response pointing to a different HTTPS domain than expected would still
pass. Full domain allowlisting is real, separate follow-up work, tracked
as `ROADMAP.md` item 13c, not silently claimed as done here.

**Files changed:**
- `src/lib/mcp-oauth.server.ts` (`isHttpsUrl` added, applied to
  `discoverAuthServer`'s discovery chain)
- `src/lib/robinhood-live.ts` (its separate `discoverAuthServer` updated
  with the same guard, importing the shared `isHttpsUrl`)
- `src/lib/__tests__/mcp-oauth.test.ts` (5 new tests, 15 total in file)
- `project-audit/SECURITY_AUDIT.md` (new Finding 7; "Not yet reviewed"
  section updated to reflect the real, precise scope of what was and
  wasn't covered by this pass — not claimed as an exhaustive OWASP sweep)
- `project-audit/ROADMAP.md` (item 13 marked partially done, new item
  13c added for the remaining domain-allowlisting work)

**Tests added:** 5 — accepts well-formed HTTPS, rejects plain HTTP (the
exact downgrade case), rejects other schemes (`ftp:`, `file:`,
`javascript:`) that could redirect a fetch somewhere unexpected, handles
malformed/unparseable URL strings without throwing, and confirms only
the scheme is checked, not path/query/fragment.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 236/236 passing (5 new)
- Independent fresh-clone + fresh-install verification to follow, since
  this touches authentication-adjacent request handling.

**Remaining risk, stated plainly:** full domain allowlisting for the
OAuth discovery chain remains open (item 13c). The broader "full OWASP
Top 10 pass" this was scoped from is genuinely NOT complete — this was
a targeted SSRF review, not an exhaustive 10-category sweep. XSS,
insecure deserialization, and other categories remain unreviewed, stated
directly rather than implied covered.

---

## 2026-08-06 — Item 13b: the last 3 Stage 3 metrics — Stage 3's original list is now genuinely complete

**What changed:** `computeVolatility`, `computeAverageR`, and
`computeRiskAttribution` (`performance-metrics.ts`) — the three items
identified as genuinely missing when Stage 3's "complete" claim was
corrected earlier. Wired into `PerformanceMetricsPanel` (Volatility,
Average R) and `AttributionPanel` (Risk Attribution, alongside the
other four attribution categories).

**Why:** Closes `TECHNICAL_DEBT.md` TD-12 for real this time. Verified
by checking every one of the 25 originally-named Stage 3 items against
actual exported function names in the codebase before writing this
claim — not asserted from memory, given this exact kind of claim has
been wrong twice before in this session.

**How each was built:**
- **Volatility** — extracted a shared `computeMeanAndStdDev` helper and
  refactored `computeSharpeRatio` to use it (verified against Sharpe's
  existing hand-computed tests before proceeding — zero regressions),
  then built Volatility on the same shared helper so both report the
  identical population-stdev definition, not two subtly different ones.
- **Average R** — `pnlPct / stopLossPct`, the standard R-multiple
  concept. Trades with no recorded stop loss are excluded from the
  average, with that exclusion count reported explicitly (not defaulted
  to zero, not silently dropped).
- **Risk Attribution** — deliberately scoped as per-symbol return
  variance, not a full max-drawdown decomposition (which has no single
  canonical definition across symbols) — stated as such in the code and
  UI rather than implied to be something more than it is. Required a
  new server function since no `pnl_pct` column exists on `paper_trades`
  — computed from `entry_price`/`exit_price`/`side`, same formula used
  elsewhere in this project for consistency.

**A real mid-build correction, worth recording:** while wiring
`PerformanceMetricsPanel`'s data fetch for Average R, checked the
actual database schema before trusting a plausible-but-wrong field name
— the trade's symbol column is `asset`, not `symbol`. Caught before it
ever compiled incorrectly, not after. Also reorganized mid-build: Risk
Attribution was initially wired into `PerformanceMetricsPanel` but
belongs in `AttributionPanel` alongside the other four attribution
categories — moved once that was clear, cleaning up the now-redundant
computation rather than leaving dead code behind.

**Files changed:**
- `src/lib/performance-metrics.ts` (`computeMeanAndStdDev` extracted,
  Sharpe refactored onto it, `computeVolatility`/`computeAverageR`/
  `computeRiskAttribution` added)
- `src/lib/__tests__/performance-metrics.test.ts` (12 new tests, 73
  total in file)
- `src/lib/attribution.functions.ts` (`getRiskAttribution` added)
- `src/features/trading/components/PerformanceMetricsPanel.tsx`
  (Volatility and Average R cards; schema field-name correction)
- `src/features/trading/components/AttributionPanel.tsx` (new Risk
  Attribution section)
- `project-audit/TECHNICAL_DEBT.md` (TD-12 finally, fully resolved)
- `project-audit/ROADMAP.md` (item 13b marked done)

**Tests added:** 12 — Volatility's std dev cross-checked directly
against Sharpe's own internal computation via the shared helper (not
just independently re-derived, an actual consistency check between the
two), zero-variance handling, and the "fewer than 2 trades returns null"
boundary; Average R's hand-computed multi-trade average, explicit
exclusion-count reporting for missing/non-positive stop losses, the
exact R = -1 boundary case (a trade that hit its stop exactly), and
all-excluded returning null (not zero or NaN); Risk Attribution's
hand-computed per-symbol std dev and average, sort-by-riskiest-first
ordering, and null-not-zero handling for single-trade symbols.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 248/248 passing (12 new)
- Independent fresh-clone + fresh-install verification to follow.

**Where this leaves Stage 3:** genuinely, fully complete — all 25
originally-named items built, tested, and (pending the fresh-clone
verification that follows) independently verified. The remaining open
items from this whole audit pass are: item 13's non-SSRF OWASP
categories (XSS, insecure deserialization — genuinely unreviewed), item
13c (OAuth domain allowlisting), item 14 (bundle size), items 15-16
(blocked on live access), and the news/sentiment classifier review.

---

## 2026-08-06 — News/sentiment classifier review: real bugs found in two separate implementations

**What changed:** New exported `matchesFinancialKeyword()`
(`market.functions.ts`) — whole-word regex matching, replacing naive
`text.includes(word)` substring matching. Applied to both
`market.functions.ts`'s `classify()` and, after discovering it exists,
`catalysts.functions.ts`'s `sentimentScore()`.

**Why:** Concrete false positives confirmed before writing any fix, not
assumed: "gain" matched inside "bargain" (a market-selloff headline
could register bullish), "cut" matched inside "cutting-edge" (diluting
a genuinely bullish headline with a false bearish signal), "rise"
matched inside "surprise"/"enterprise", and "record" was scored
unconditionally bullish despite "record low"/"record losses" being
common, clearly bearish constructions — a keyword-count classifier has
no way to tell "record high" from "record low" apart.

**Severity assessed before fixing, not after:** grepped every consumer
of `classify()`'s output before deciding how much this mattered —
confirmed it's used ONLY by `NewsFeed.tsx` to color a badge in a
news-browsing UI, never fed into any autonomous trading decision. Fixed
anyway, since the fix was cheap and mechanical and a wrong-colored badge
is still worth getting right — but this context matters for anyone
reading this entry and wondering whether past trades were affected by
this bug. They weren't.

**A second, more consequential implementation found during this same
check, previously unknown:** `catalysts.functions.ts`'s
`sentimentScore()` is a separate, independently-maintained near-
duplicate with the identical bug — but its output genuinely does feed
`catalystSymbols` in `autonomous-agent.ts`, affecting which symbols the
live trading agent actually scans. Fixed the same way, reusing the
newly-exported `matchesFinancialKeyword()` rather than a third
re-implementation of the same regex — consolidating rather than letting
a second copy of near-identical logic keep drifting, the same instinct
applied elsewhere in this project after finding real bugs caused by
exactly this pattern (auth checks, instrument type lists).

**How the fix avoided a recall regression:** strict word-boundary
matching alone would have broken legitimate inflected forms — "rallied"
(rally→rallied involves a y→ied spelling change) and "rising"
(rise→rising drops the trailing e) aren't simple suffix-appends of their
base words, so a generic suffix regex wouldn't catch them either.
Verified this precisely with a standalone script testing 12 concrete
before/after cases (including these two) before writing any production
code — explicit inflected forms are listed directly in the keyword
arrays rather than derived via a stemming approximation, more
verbose but individually verifiable.

**Files changed:**
- `src/lib/market.functions.ts` (`matchesFinancialKeyword` exported,
  `classify` exported and fixed, keyword lists expanded with inflected
  forms, "record" removed)
- `src/lib/catalysts.functions.ts` (`sentimentScore` exported and fixed
  using the same shared `matchesFinancialKeyword`, same keyword
  treatment, plus its extra bull/bear words given the same inflected-
  form treatment)
- `src/lib/__tests__/market-sentiment.test.ts` (new, 16 tests covering
  both files)
- `project-audit/TRADING_ENGINE_REVIEW.md` ("Not yet reviewed" section
  updated with full detail on both findings)
- `project-audit/ROADMAP.md` (new item 13d; item 13c explicitly marked
  as deliberately deferred rather than attempted — see below)

**Tests added:** 16 — word-boundary matching confirmed to reject every
concrete false-positive case found (bargain/gain, cutting-edge/cut,
surprise+enterprise/rise) while still matching genuine keywords and
their inflected forms including the two spelling-change cases
(rallied, rising); `classify()`'s end-to-end behavior on realistic
headline shapes for both files; the "record" ambiguity fix verified on
both a record-loss and a record-low headline; and `sentimentScore`'s
score clamping verified at the extreme (many repeated keyword matches
still stays within -1..1).

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 264/264 passing (16 new)
- Independent fresh-clone + fresh-install verification to follow, since
  `catalysts.functions.ts`'s fix affects real agent-scanning behavior.

**A related decision made in the same pass, stated directly:** item 13c
(OAuth domain allowlisting) was considered but deliberately NOT
attempted right now — implementing it correctly requires knowing
Robinhood's actual OAuth-server hostname relative to its MCP endpoint,
which can't be verified without live network access this process
doesn't have. An incorrect assumption risks breaking a currently-working
feature. Marked as deliberately deferred in `ROADMAP.md`, not silently
skipped or guessed at.

---

## 2026-08-06 — Item 13 completion: XSS, insecure-deserialization, and security-header review, plus item 14 bundle analysis

**What changed:** Four more static-review items closed out — three
OWASP categories from item 13's original scope (XSS, insecure
deserialization, missing security headers), plus item 14 (bundle size),
completing everything actionable without live database or network
access.

**Finding 8 (XSS, fixed):** `NewsFeed.tsx` and `CatalystsPanel.tsx`
render `href`/`src` directly from Finnhub news API responses with no
URL scheme validation — a `javascript:` URI in a malicious or
compromised upstream response would execute on click. Checked every
internally-constructed URL first (`robinhood-links.ts`) and confirmed
those are safe (hardcoded host, symbol only interpolated into the path)
before concluding only these two files needed the fix. New
`safeExternalUrl()` (`src/lib/url-safety.ts`), 7 tests.

**Also found, not fixed (deliberately, not an oversight):**
`src/components/ui/chart.tsx`'s `ChartStyle` uses
`dangerouslySetInnerHTML`, but `ChartContainer` (its only caller) is
never imported anywhere in this codebase's actual feature code —
confirmed via grep, zero live risk. This is shadcn/ui library
boilerplate, not custom app code; not removed, since deleting shared
UI-library scaffolding that might be used later isn't this review's
call to make unilaterally. Documented so it's understood if it's ever
wired up.

**Finding 9 (insecure deserialization, fixed):**
`autonomous-agent.ts`'s `callGateway` parses the AI model's JSON
response via `JSON.parse(cleaned) as AiResponse` — a type assertion,
not runtime validation. Checked the actual blast radius before
assessing severity: the trade loop is contained by an existing per-user
try/catch, so today a malformed response just skips one user's cycle
rather than crashing broadly — but it currently aborts that user's
ENTIRE cycle, including other valid trades in the same response. New
`isValidAiTrade()`/`filterValidAiTrades()`
(`src/lib/ai-response-validation.ts`) filters out malformed proposals
individually rather than failing the whole batch. 15 tests.

**Item 14 (bundle size, no urgent action found):** Checked the client
bundle's largest chunks directly after a real build (`du -h` + `strings`
to verify contents, not guessed from file names). The two largest
chunks are `@supabase/auth` and `recharts` — both genuinely necessary,
appropriately shared across routes by Vite's automatic code-splitting.
No bloat or unused-dependency bomb found. One purely cosmetic
observation (the recharts chunk's file name is coincidental and
unstable across builds) noted but not acted on, since a build-config
change isn't something to attempt without live deployment verification.

**Finding 10 (missing security headers, partially fixed):** grepped the
entire codebase and every config file for `Content-Security-Policy`,
`X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options`
— zero matches anywhere. New `public/_headers` (Cloudflare Pages'
documented convention) adds four standard, zero-functional-risk headers
— confirmed by rebuilding and inspecting the actual merged output, not
assumed to work. A Content-Security-Policy was deliberately NOT added:
the single highest-value header for XSS defense in depth, but getting
its directives wrong could genuinely break the live app, and that's not
confidently verifiable without live browser testing this process
doesn't have — the same reasoning already applied to item 13c.

**Files changed:**
- `src/lib/url-safety.ts` (new)
- `src/lib/ai-response-validation.ts` (new)
- `src/lib/__tests__/url-safety.test.ts` (new, 7 tests)
- `src/lib/__tests__/ai-response-validation.test.ts` (new, 15 tests)
- `src/features/markets/components/NewsFeed.tsx`
- `src/features/trading/components/CatalystsPanel.tsx`
- `src/routes/api/public/autonomous-agent.ts` (trade filtering wired in
  immediately after the AI response is received)
- `public/_headers` (new)
- `project-audit/SECURITY_AUDIT.md` (new Findings 8, 9, and 10, "Not yet
  reviewed" section updated)
- `project-audit/ROADMAP.md` (item 13 updated, item 14 marked done, new
  item 13e for the deferred CSP)

**Tests added:** 22 total. `safeExternalUrl`: valid http/https
preserved exactly, `javascript:`/`data:`/`vbscript:`/`file:` schemes all
rejected explicitly, null/undefined/malformed input handled without
throwing. `isValidAiTrade`/`filterValidAiTrades`: every field the
pipeline dereferences unguarded checked individually (symbol, direction,
instrument, conviction, allocation_pct, stop_loss_pct — including why a
non-positive stop_loss_pct specifically would break the Average R math
built earlier this session — take_profit_pct, hold_duration, rationale),
plus the actual bug this exists to fix directly verified: one malformed
trade in a batch no longer prevents the other valid trades from being
kept. `public/_headers` has no test suite equivalent — verified instead
by an actual rebuild and direct inspection of the merged output file.

**Verification performed:**
- `npx tsc --noEmit`: 0 errors (sandbox)
- `npm run build`: exit 0, clean (sandbox)
- `npx vitest run`: 286/286 passing (22 new)
- The `_headers` merge behavior verified directly against real build
  output, not assumed
- Independent fresh-clone + fresh-install verification to follow, since
  the trade-validation fix touches the live trading decision path.

**Where this leaves the whole audit pass:** everything genuinely
actionable without live database or network access has now been
reviewed or fixed, including security headers. What remains is either
explicitly deferred pending live verification (13c's OAuth domain
allowlisting, 13e's CSP, Finding 6's field-name check), needs real
accumulated data (15, 16, whether the trading edge is real), or is a
narrower remainder of item 13 — CSRF token handling and a handful of
other OWASP sub-categories weren't specifically checked in this or
prior passes, and this shouldn't be read as an exhaustive Top 10 sweep
even now.

---

## 2026-09-18 — Entry-price data-integrity bug: 87% of reported profit was not real

**What changed:**

1. **Root cause fixed** — `fetchQuotePrice` (`src/lib/indicators.ts`) was
   first-hit-wins: it tried Yahoo's keyless endpoint first and accepted any
   `regularMarketPrice > 0`, and the staleness guard failed open whenever a
   timestamp was missing or unparseable. It now queries every available
   source, tracks per-source freshness verification, and runs
   `selectTrustedPrice`: a candidate implausibly far from a caller-supplied
   reference (>5x) is dropped; a candidate corroborated by the reference
   (within 15%) or by a second agreeing source is trusted; a single
   uncorroborated source is trusted ONLY if its freshness was actually
   verified. Otherwise the function returns `null` and the caller skips the
   trade rather than sizing capital off an unverified number.
2. **All call sites pass a reference price** — entry writes use the current
   scan's own independently-fetched price for the symbol; mark-to-market
   reads and exit paths use the position's `entry_quoted_price` /
   `entry_price`; shadow-experiment resolution uses `price_at_scan`. Touched
   `autonomous-agent.ts`, `autonomous-exit-check.ts`, `emergency-exit.ts`,
   `friday-review.ts`, `resolve-shadow-experiments.ts`. Two call sites have no
   meaningful reference available (the VIX read in `evaluate-strategies.ts`,
   and options mark-to-market in `snapshot-portfolio.ts`, where the stored
   entry price is an option premium and the quote is of the underlying) — they
   rely on the cross-source corroboration rules alone, which now reject an
   uncorroborated unverifiable quote outright.
3. **Second line of defence** — new `src/lib/data-quality.ts`. Every close
   path calls `flagTradeIfImplausible`, which marks any trade closing with
   `|return| > 100%` of notional as `data_quality_flag = true` with a
   reason string. `updateSignalWeights` refuses to learn from such a trade.
4. **Historical rows flagged, not touched** — the 19 corrupted trades keep
   their recorded values and are excluded from every performance, analytics
   and learning query (`portfolio-attribution`, `attribution.functions`,
   `regime-performance.functions`, `signal-learning`, `autonomous-learning`,
   and the trading UI panels), plus `get_strategy_trade_stats()`. See
   `DECISION_LOG.md` D-11.
5. **Contaminated aggregates recomputed** — `recompute_agent_signal_weights()`
   rebuilt all 18 `agent_signal_weights` rows from clean trades only; the
   shadow-experiment tables carry the same flag so `diag_claude_value()` and
   `diag_adaptive_weighting()` no longer report bogus hundreds-of-percent
   figures.

**Why:** `diag_evidence_readiness()` showed 19 of 449 closed trades (~4%)
with `|return| > 100%`, and those 19 produced the overwhelming majority of
all displayed profit. Excluding them, the honest read is 430 trades,
19.53% win rate, -0.5855% average return, t-stat ≈ -2.33 — a small
negative result, not "not enough data yet". `HYPOTHESIS_LOG.md` H11 records
this; ROADMAP item 7 is resolved by it.

**Verification:** `bunx tsgo --noEmit` clean; full suite 330/330 passing,
including a new `src/lib/__tests__/price-trust.test.ts` covering
`pctDifference`, `pricesAgree`, `isImplausibleVsReference`,
`selectTrustedPrice` (corroboration, single-source rejection, the exact
corruption signature) and the `data-quality` return screen (boundary at
exactly ±100%, missing-pnl handled as unknown rather than zero).
Migrations applied against production; `diag_*` functions rewritten to read
the stored flag.

**Still to watch:** monitor `diag_overall_edge_test()` for several days —
any trade opened after this date appearing in `diag_flagged_trades()` means
a path was missed.
