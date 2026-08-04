# ENGINEERING_CONSTITUTION.md

Version: 2.0
Supersedes: Version 1.0 (founder draft, preserved in spirit throughout this document)
Status: Living document — this file is a required read before any significant change to this repository.

---

## How this version differs from v1.0, and why

v1.0 stated principles well but in the abstract — "never fake confidence,"
"avoid overfitting," "risk management comes first." Those principles are
correct and are preserved in full below. What v1.0 could not do, because it
was written before the codebase existed in its current form, is bind those
principles to the actual architecture: this platform's actual universe is
a fixed 150-symbol list (not a dynamically-selected one), its actual AI
layer is three distinct system prompts calling Claude through Lovable's
gateway (not an abstract "the AI"), its actual risk controls are specific
functions in `indicators.ts` and `signal-learning.ts`, and its actual gaps
— verified during the first audit pass, not assumed — are two real
authorization holes and zero test coverage. This version exists to make
every principle in v1.0 checkable against a real file, a real table, or a
real finding, rather than left as an ideal.

Every section below states the standard first, then grounds it in what
this repository actually is today — including where today falls short of
the standard. Where the codebase does not yet meet a stated standard, that
gap is named explicitly and pointed at the relevant roadmap item in
`/project-audit/ROADMAP.md`, not glossed over.

---

# 1. Project Mission

**What this platform is, concretely:** An autonomous, Claude-driven paper
trading system. It scans a fixed universe of 100 stocks, 30 cryptocurrencies,
and 20 ETFs on a layered cron schedule (swing scans at 9:30am/12:30pm ET,
scalp scans every 30 minutes 10am–3:30pm ET, crypto scans every 30 minutes
around the clock, exit checks every 10 minutes), builds a scored candidate
list from real technical indicators, sends that context to Claude for a
trading decision, applies a chain of deterministic code-level risk
adjustments to whatever Claude proposes, and records the result. It learns
from its own closed trades via a Bayesian per-signal win-rate system that
updates the moment a trade closes. It optionally connects to a real
Robinhood account via OAuth/MCP for live execution, gated behind a
paper/live mode switch the user controls.

**What it is trying to become:** A system that can prove — with evidence,
not narrative — whether its decision layer has a repeatable statistical
edge, before any user is encouraged to trust it with real capital beyond
what they've explicitly opted into via the live-mode switch.

**What success means, specifically:** Not "the equity curve goes up."
Success means: enough closed trades exist to compute real risk-adjusted
metrics (Sharpe, Sortino, max drawdown, profit factor — see Section 4),
those metrics are computed against a proper out-of-sample or forward-
walking methodology (not curve-fit to the same historical window the
strategy was tuned against), and the resulting numbers are shown to the
user without inflation, hedging, or cherry-picked time windows.

**What cannot be compromised, ranked, and why this order:**
1. **Security** — a security failure (see the two real findings in
   `/project-audit/SECURITY_AUDIT.md`) can cause harm regardless of how
   good the trading logic is. This ranks above trading correctness because
   an insecure correct system is still exploitable; an secure system with
   a mediocre strategy is merely mediocre, not dangerous.
2. **Statistical honesty** — a system that lies to itself about its edge
   (via overfitting, survivorship bias, or insufficient sample size) will
   eventually lose real money while its own dashboard says it's winning.
   This is the failure mode this constitution exists most directly to
   prevent.
3. **Reliability** — a correct strategy that crashes, double-executes, or
   silently drops decisions (see the historical bug log in
   `/project-audit/BUG_TRACKER.md` — Rules-of-Hooks crashes, the
   FetchResult wrapper bug, the trim no-op) is not trustworthy regardless
   of the math underneath it.
4. **Maintainability** — this system will be touched by future AI agents
   and developers who were not present for the reasoning behind a given
   design. Code and prompts must be legible to someone starting cold.
5. **User trust** — earned by the first four, not claimed independently
   of them.

---

# 2. Engineering Philosophy

## Correctness before speed — grounded example

When ATR-based stop-loss calibration was added to this codebase
(`atrBasedStopTarget` in `src/lib/indicators.ts`), the change was staged,
verified with `tsc --noEmit` and a full production build, and committed
as its own isolated commit — separate from the six other trading-logic
stages built in the same work session — specifically so a future
regression could be bisected to one behavioral change, not a bundle of
seven. This pattern (one conceptual change, one commit, verified before
the next begins) is the required standard going forward, not a one-time
convenience.

## Simplicity — grounded example

The Kelly Criterion sizing implementation
(`computeKellySizeMultiplier` in `src/lib/signal-learning.ts`)
deliberately uses the single most-observed active signal on a trade
rather than statistically blending multiple signals with different
sample sizes together. The more "sophisticated" blended version is a
real, legitimate improvement someone could build — but it was
consciously deferred because the simpler version is correct, explainable,
and conservative, while the blended version introduces a real modeling
problem (combining estimates with different confidence levels
correctly) that has not been solved here. **Do not build the more
complex version until the simpler one has been proven insufficient with
evidence, not assumed insufficient in advance.**

## Documentation is not optional overhead

Every non-trivial trading-logic function in this codebase carries a
comment block explaining *why*, not just *what* — see
`estimateSlippageBps`, `computeVolatilityPercentile`, or
`classifyEarningsStrategy` for the standard. A function with correct
code and no rationale is unmaintainable the moment its author is gone
from the conversation. This is not a style preference; multiple bugs in
this project's history (documented in `BUG_TRACKER.md`) came from a
later change not understanding why an earlier one existed.

## Testing — the current state must be named honestly

**This codebase has zero automated tests as of this writing.** No test
runner is installed, no test files exist, no `test` script exists in
`package.json`. Every piece of trading math in this repository — ATR,
correlation, Kelly sizing, VWAP bands, slippage, Bayesian weight
updates — has been verified only by human code review, TypeScript
compilation, and production build success. This is the single largest
gap between this codebase and the standard this constitution sets. It is
named here, in the philosophy section, deliberately — because "we will
add tests eventually" is exactly the kind of soft commitment this
document exists to prevent. See Section 8 for the binding standard and
`ROADMAP.md` item 4 for the concrete first step.

---

# 3. Autonomous AI Agent Standards

## The AI proposes; deterministic code decides

Claude's output from any of the three system prompts (swing/default,
scalp, crypto — all defined in `src/routes/api/public/autonomous-agent.ts`)
is never inserted into `paper_trades` unmodified. Every proposed trade
passes through, in order:

1. Defensive-mode conviction filtering (drawdown protection)
2. Correlation-based size reduction or rejection (`computeCorrelation`)
3. Market-breadth-based long-side size reduction (`computeBreadthScore`)
4. Sector-ETF-bullish filter for long stock entries (`isSectorBullish`)
5. Duplicate-position detection
6. ATR-calibrated stop/target recalculation (overrides whatever Claude
   proposed — `atrBasedStopTarget`)
7. Kelly Criterion size adjustment, once evidence exists
   (`computeKellySizeMultiplier`)
8. Realistic slippage applied to the actual fill (`estimateSlippageBps`)
9. Cumulative cash-deployment and per-position sizing caps

**No future change may allow an AI-proposed trade to bypass this chain.**
If a new AI capability is added (e.g., a new instrument type, a new
session type), it must be threaded through the same guard sequence, not
special-cased around it.

## Prompts are production code — binding rule

The three system prompts in `autonomous-agent.ts` are not free text. Any
change to them requires the same rigor as a code change: understand
current behavior, make the change, verify compilation, and — this is the
standard this constitution adds beyond what currently happens — **write
down what the change is expected to affect and how that will be checked**,
even informally, in the commit message. Prompt changes made this project
have generally followed this discipline (see commit history for the
Stage 2 through Stage 7 trading-logic work); the standard is to continue
it, not relax it as the prompts grow longer.

## Known AI blind spot in this codebase, named explicitly

`iron_condor` is listed as a choosable instrument in the swing prompt's
JSON schema, but the execution code does not resolve it into a real
options position (see `BUG_TRACKER.md` BUG-003). This is a live example
of exactly the failure mode this section exists to prevent: an AI
capability that exists in the prompt but not in the guard chain beneath
it. **Until this is fixed, no new instrument type may be added to any
prompt's schema without first confirming the execution code actually
handles it** — this should have been checked before `iron_condor` was
added, and wasn't.

## Multi-agent / specialized-agent opportunities (not yet built)

Currently, one model call (via Claude, through Lovable's gateway) makes
the entry decision, and a separate, smaller model call
(`google/gemini-2.5-flash`, used in `autonomous-exit-check.ts` and
`autonomous-learning.ts`) makes exit and weekly-learning decisions. This
is already a form of task-appropriate model selection — the exit review
and learning summarization tasks don't need the same reasoning depth as
the entry decision, and using a lighter/cheaper model there is correct,
not a corner cut. Genuine future multi-agent opportunities worth
evaluating: a separate "skeptic" pass that reviews the primary model's
proposed trades against the same context and flags disagreements, rather
than a single model grading its own homework. Not yet built. Do not build
it speculatively — build it if and when single-model reasoning is shown,
with evidence, to be a limiting factor.

---

# 4. Quantitative Trading Research Standards

## The standard this codebase must eventually meet

Before any claim of "this strategy works" is made to a user, the
following must be computed from real closed-trade data, not estimated:

- **Sharpe ratio** and **Sortino ratio** (risk-adjusted return, the
  latter penalizing only downside volatility — more appropriate than
  Sharpe alone for a strategy with asymmetric stop/target design)
- **Maximum drawdown** (peak-to-trough, already partially tracked via
  the drawdown-protection defensive-mode logic in `autonomous-agent.ts`,
  but not yet surfaced as a standalone reportable metric)
- **Expectancy** (average $ won per trade × win rate, minus average $
  lost per trade × loss rate) — the `agent_signal_weights` table already
  stores `avg_win_pct` and `avg_loss_pct` per signal; a portfolio-level
  expectancy calculation from this data does not yet exist as a feature
  and should be built before any "is this working" conversation happens
  with real conviction.
- **Profit factor** (gross wins / gross losses)
- **Win rate with a confidence interval**, not a bare percentage — see
  the wide-confidence-interval concern already documented in
  `TRADING_ENGINE_REVIEW.md` regarding the Kelly-sizing 15-trade
  threshold. The same caveat applies to any headline win-rate number
  shown anywhere in the product.
- **Sample size**, stated alongside every other metric, always. A Sharpe
  ratio computed from 12 trades is not evidence of anything and must be
  labeled as such, not presented with the same visual weight as one
  computed from 200.

**Current state: none of these are computed today.** The `PnLDashboard`
component shows realized P&L by time period; `SessionPerformancePanel`
breaks it down by scalp/swing/crypto; `SignalWeightsPanel` shows
per-signal win rate. None of these are risk-adjusted, and none report a
confidence interval. This is a concrete, scoped gap — building a
`PerformanceMetricsPanel` that computes the above from `paper_trades` is
a well-defined next feature, not a research project, and should be
prioritized before any live-capital conversation.

## Benchmark comparison

The equity curve already compares against SPY (`EquityCurveCard`, "VS
SPY" toggle) — this is correct and should be the template for other
benchmark comparisons: a crypto-heavy period of the strategy should be
compared against a BTC buy-and-hold benchmark, not just SPY, since SPY
is not a meaningful benchmark for crypto performance. **Not yet built.**

## Transaction costs and slippage

Already implemented (`src/lib/slippage.ts`, applied at every fill —
entries, exits, trims, circuit-breaker closures). This is the standard
other parts of the system should be held to: a documented, defensible
model with its assumptions stated in code, applied consistently, not
assumed away. See `TRADING_ENGINE_REVIEW.md` for the honest caveat that
the underlying liquidity-tier assumptions are reasoned estimates, not
empirically calibrated against this specific platform's actual fills
(which don't exist yet, since this is paper trading).

## Overfitting defense — what exists, what doesn't

**Exists:** the Bayesian weight-learning system's Beta(1,1) prior
deliberately shrinks small-sample signal estimates toward neutral rather
than trusting them immediately — a real, working defense against acting
on noise. The Kelly-sizing 15-trade minimum is a second layer of the same
defense.

**Does not yet exist:** any correction for testing ~18 signals
simultaneously (the multiple-comparisons problem documented in
`TRADING_ENGINE_REVIEW.md` Finding 1). This is a known, named,
un-fixed gap — not an oversight being hidden.

## Survivorship and look-ahead bias

The live/forward-trading path has no look-ahead bias — verified during
the audit, every price/bar fetch requests data up to "now," never the
future, because this is genuinely live scanning, not simulated history.
The fixed 150-symbol universe **does** carry structural survivorship
bias that would distort any backtest run against it (see
`TRADING_ENGINE_REVIEW.md` Finding 4) — this does not distort forward
paper/live trading, but the `agent-backtest` endpoint's output, if used
to support any claim about historical strategy performance, must
explicitly disclose this limitation to the user, not present a backtested
Sharpe ratio as if it were unbiased.

---

# 5. Trading System Rules

## Market data handling

Price data flows through a fallback chain: Yahoo Finance → Finnhub →
Polygon → Alpha Vantage (`fetchQuotePrice` in `src/lib/indicators.ts`).
**Standard:** any new data source added to a fallback chain must degrade
gracefully (return `null`, not throw) and must not silently succeed with
stale data — see the open gap in `TRADING_ENGINE_REVIEW.md` Finding 6
(no staleness check exists yet across this chain). Until that's fixed,
any new fallback source added must be held to the standard of at minimum
logging a warning when it's the source actually used, so staleness
issues are at least visible in `agent_decisions` payloads even before
they're automatically prevented.

## Indicators

All indicator math lives in `src/lib/indicators.ts` and must stay there
— not duplicated inline in route handlers. This was already the
practice for RSI, MACD, Bollinger Bands, Stochastic RSI, SMA/EMA, ATR,
and was extended consistently for every indicator added this project
(VWAP + bands, trend strength, volatility percentile, correlation). Any
new indicator follows the same rule: one canonical implementation,
imported everywhere it's used, never recomputed with slightly different
logic in two places.

## Signal generation and scoring

The `computeDirectionalScores`/`applySignalWeights` split
(`src/lib/signal-learning.ts`) exists specifically because the original
scoring system added points for a candidate showing both "RSI oversold"
(bullish) and "RSI overbought" (bearish) simultaneously without
distinguishing direction. **Standard going forward: every new scoring
signal must be explicitly assigned to bullish or bearish contribution,
never added to an undifferentiated total.** This is not a style
preference — it was a real, shipped bug in this exact codebase before
being fixed.

## Position sizing chain

See Section 3's guard-chain list — position sizing is the product of
seven independent multipliers (signal boost, regime, correlation,
breadth, weekend caution, Kelly, and the hard per-position cap), each
documented in `autonomous-agent.ts` at its point of application. **Any
new sizing adjustment must be added to this same multiplicative chain,
not layered on top of the final result** — multiplying into the chain
keeps every adjustment auditable and reversible independently; applying
adjustments after the fact makes the final number's provenance
untraceable.

## Kelly Criterion — the non-negotiable bounds

Fractional Kelly at 40% of full Kelly, hard-capped at 25% of the
theoretical Kelly fraction regardless of formula output, gated behind a
15-trade minimum sample size per signal. **These three bounds may not be
loosened to "improve returns" without a documented, evidence-based
justification reviewed against the Skeptic Rule (Section 17).** Kelly
sizing is the mechanism most likely to be tempting to "turn up" after a
winning streak — that is precisely when this constitution requires the
most scrutiny, not the least.

## Stop losses, take profits, trailing stops

ATR-calibrated, not fixed percentages (`atrBasedStopTarget`). Trailing
stops use the Chandelier Exit method — anchored to the highest price
since entry, not current price, sized to 3×ATR
(`autonomous-exit-check.ts`). **Standard:** any future change to stop/
target logic must remain volatility-calibrated; reverting to fixed
percentages for any asset class would be a regression against a
deliberate, documented improvement made this project specifically
because fixed percentages treat a stable stock and a volatile one
identically, which is wrong.

## Execution logic — the partial-close standard

"Trim" (50% partial close) is genuinely implemented — a real closed-
trade row is created for the trimmed portion, the original position's
quantity is reduced, and the trimmed portion feeds the same signal-
learning update as a full close. **This is the standard for any future
partial-execution feature**: it must produce a real, queryable trade
record, not a cosmetic label on an otherwise-unchanged position.

---

# 6. Risk Management Constitution

These rules are non-negotiable. They exist independently of any
performance metric and may not be weakened to improve one.

1. **Never remove or weaken the circuit breaker** (halts new entries at
   -5% daily P&L, `autonomous-agent.ts`) to allow more trades during a
   bad day. This rule exists specifically because that is the moment a
   struggling system is most likely to want to override it.
2. **Never increase Kelly sizing bounds, correlation thresholds, or
   breadth-gate thresholds without evidence** — see Section 5's Kelly
   bounds rule, applied identically to every other risk parameter in the
   sizing chain.
3. **Never allow AI output to bypass the deterministic guard chain**
   (Section 3) — no exceptions for "high conviction" trades, no
   exceptions for any future session type.
4. **Never connect live-money execution for a new asset class or
   instrument type without first confirming the execution path is real**
   — the `iron_condor` gap (BUG-003) is the cautionary example: a
   capability existing in the AI's vocabulary is not the same as a
   capability existing in the execution code, and live money must never
   be exposed to that gap.
5. **Drawdown protection** (defensive mode below 15% below peak equity,
   `autonomous-agent.ts`) may not be disabled or loosened without an
   explicit, documented decision — not a silent parameter change.
6. **Concentration and correlation limits** (sector caps, the 0.75/0.90
   correlation thresholds) exist to prevent the portfolio from being
   more fragile than its position count suggests. Any feature that adds
   new positions (e.g., a future scale-in enhancement) must be checked
   against these limits, not exempted from them.
7. **Rate limiting is a risk control, not a performance feature** — its
   current absence (see `SECURITY_AUDIT.md` Finding 4) is a Critical-
   priority gap specifically because it compounds the two real
   authorization findings (BUG-001, BUG-002) into a materially worse
   combined risk than either alone.

---

# 7. Software Development Standards

## File organization (as it exists, to be preserved)

- `src/lib/` — pure logic, indicator math, external API clients, no React
- `src/routes/api/public/` — cron-triggered and public-facing server
  endpoints, protected by an `apikey` header check against
  `SUPABASE_PUBLISHABLE_KEY` (see Section 9 for the standard every one of
  these must meet — two currently don't)
- `src/features/*/components/` — feature-scoped React components
- `supabase/migrations/` — every schema change as a timestamped,
  sequential file; `CREATE OR REPLACE FUNCTION` for anything that must be
  re-applied (e.g., `register_all_crons()`), plain `CREATE TABLE IF NOT
  EXISTS` for additive schema changes

## Naming conventions (as established, to be continued)

Cron job names are kebab-case and descriptive of both timing and purpose
(`scalp-1030`, `crypto-weeknight-early`, `autonomous-exit-check`).
Signal names in `agent_signal_weights` are snake_case and match their
originating indicator (`rsi_oversold`, `macd_bullish`,
`volume_surge_strong`) with a human-readable label maintained separately
in `SignalWeightsPanel.tsx`'s `SIGNAL_LABELS` map — **any new signal name
added to the scoring system must also get an entry in that map**, so the
UI never shows a raw snake_case string to the user.

## Migration discipline

`register_all_crons()` has been redefined via `CREATE OR REPLACE
FUNCTION` multiple times across this project's history as new cron jobs
were added. **Standard: always add a new migration file with a later
timestamp; never edit a previously-applied migration file in place.**
This was already the working pattern; it is stated here as a binding
rule because migrations are, by nature, easy to "just quickly edit" and
that impulse must be resisted.

## Dependency management

Two known high-severity CVEs currently exist in production dependencies
(`js-yaml`, `postcss` — see `SECURITY_AUDIT.md` Finding 6, `BUG_TRACKER.md`
BUG-005). **Standard: `npm audit` should be run and reviewed before any
dependency-touching change, not only during periodic audits.** The fix
for the current two CVEs is available via `npm audit fix` but has been
deliberately withheld from this audit pass pending re-verification of
the build afterward — apply and verify together, never apply without
re-verifying.

---

# 8. Testing Standards

**Binding standard, not yet met by this codebase:**

Every pure function in `src/lib/` that performs trading math must have a
unit test asserting its output against hand-computed expected values for
at least: a normal case, a boundary case (empty/minimal input), and a
case designed to catch the most likely implementation error for that
specific function (e.g., for `computeCorrelation`, a test with two
perfectly correlated series should return ~1.0; two perfectly inverse
series should return ~-1.0).

**Mandatory first targets, in priority order** (see `ROADMAP.md` item 4):
1. `computeATR` / the ATR portion of `atrBasedStopTarget`
2. `computeCorrelation`
3. `computeVwap`
4. `computeKellySizeMultiplier`
5. `estimateSlippageBps` / `applySlippage`
6. `computeBreadthScore`
7. `computeDirectionalScores` / `applySignalWeights`

Integration tests are required for: the full trade-insertion guard chain
(Section 3) — given a mocked AI proposal, confirm the final `allocPct`
reflects all seven multipliers correctly — and the exit-check trim logic
specifically, since it was shipped once already as a complete no-op
(BUG_TRACKER.md, "previously known, already fixed" section) and a
regression test is the correct permanent defense against that recurring.

**Tests are mandatory, not optional, for:** any change to a risk-control
threshold (Section 6), any change to the position-sizing chain (Section
5), and any change to authentication/authorization logic (Section 9).
Tests are strongly recommended but not strictly mandatory for: UI
components with no financial calculation inside them, cosmetic changes,
documentation.

---

# 9. Security Standards

## The standard every `/api/public/*` route must meet

```ts
POST: async ({ request }: { request: Request }) => {
  const apikey = request.headers.get("apikey");
  if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }
  // ... proceed with supabaseAdmin (service-role) access
```

**As of this writing, two routes do not meet this standard:**
`evaluate-alerts.ts` (no check at all) and `sync-crons.ts` (checks
presence, not correctness). These are Critical and High priority fixes
respectively (`ROADMAP.md` items 1–2) and must be treated as blocking
for any live-money connection.

## Authenticated (non-cron) routes

Every `createServerFn` requiring a logged-in user must use
`.middleware([requireSupabaseAuth])`, which validates the Bearer JWT
against real Supabase Auth and scopes the resulting client to the user's
own RLS permissions — never `supabaseAdmin` for a user-facing action
unless the action is explicitly meant to be privileged (and if so, that
privilege boundary must be independently justified, not just convenient).

## Row Level Security

Every new table must have RLS enabled and an explicit policy — the
pattern established by every table added this project
(`agent_signal_weights`, `btc_dominance_snapshots`,
`market_breadth_snapshots`, `iv_history_snapshots`,
`robinhood_snapshots`): authenticated users may `SELECT` their own rows
(or, for genuinely global market data like breadth/dominance snapshots,
`SELECT` all rows), `service_role` has full access for the cron jobs that
write to it. **No table may ship without RLS enabled — this has been
followed consistently and must continue to be.**

## Secrets

`FINNHUB_API_KEY`, `POLYGON_API_KEY`, `LOVABLE_API_KEY`, and the
Supabase service-role key are Lovable-managed environment secrets,
never present in any tracked file — verified during the audit. The
repo's own `.env` is tracked in git but contains only the Supabase
publishable/anon key and public project identifiers (verified by reading
its actual contents), which Supabase's security model explicitly
designs to be safe client-side. **Standard: this remains true only by
discipline, not by any technical enforcement** — `.env` should still be
added to `.gitignore` (BUG-004) precisely so a future genuinely-secret
value doesn't get added to the same file by habit.

## Rate limiting

**Does not exist anywhere in this codebase today.** This is Critical
priority (`ROADMAP.md` item 3) specifically because it multiplies the
severity of any authorization gap — an endpoint with broken auth AND no
rate limit is materially worse than either problem alone.

## OAuth (Robinhood MCP integration)

Uses PKCE correctly (`code_verifier` enforced at the token-exchange
step, verified during the audit) but uses `user_id` directly as the
OAuth `state` parameter rather than a separate random anti-CSRF nonce.
Low real-world risk today (PKCE is the actual protection layer,
Supabase UUIDs aren't practically guessable) but not textbook-correct,
and **any future OAuth integration added to this codebase must generate
a genuine random `state` value, not repeat this shortcut.**

---

# 10. Data Standards

## Missing data and API failures

Every external data fetch in this codebase (`fetchBars`,
`fetchQuotePrice`, `fetchVwapBars`, `fetchFundingRate`,
`fetchBtcDominance`, `fetchHistoricalEarningsDates`, and every function
in `earnings-strategy.ts` and `crypto-signals.ts`) is written to return
`null` on failure and to be consumed with a graceful fallback, never to
throw an unhandled exception that could crash a scan. This pattern must
be preserved for every new data source added.

## Honest ramp-up for accumulating data

Several features in this codebase correctly start in a "not enough data
yet" state and only activate once real evidence accumulates: IV Rank
(`getIvRank`, needs 15+ stored snapshots), Kelly sizing (15+ trades per
signal), BTC dominance rate-of-change (needs a prior snapshot to compare
against). **This is the required pattern for any future feature that
depends on accumulated history — it must degrade to a documented neutral
state, and that state must be visible to the user** (see
`SignalWeightsPanel`'s "building history" tag as the UI-level standard).
A feature that silently assumes zero or fabricates a plausible-looking
default when data is actually missing violates Section 2's "never fake
confidence" rule.

## Timestamps and staleness

Every snapshot table (`btc_dominance_snapshots`,
`market_breadth_snapshots`, `iv_history_snapshots`, `robinhood_snapshots`)
stores `created_at` and is queried with an explicit time window when
computing a rate of change. **Standard not yet met**: no equivalent
staleness check exists on live quote fetches themselves (Section 5,
Data Standards gap already named in `TRADING_ENGINE_REVIEW.md` Finding
6) — this is the next data-quality gap to close.

---

# 11. AI Cost and Efficiency Standards

## Model selection by task, already practiced

Entry decisions (the highest-stakes, most context-heavy call) go through
Claude via Lovable's gateway. Exit reviews and weekly learning summaries
— lower-stakes, more structured, higher-frequency — use
`google/gemini-2.5-flash` through the same gateway. **This is the
correct standard: match model cost/capability to task stakes, and
continue doing so for any new AI-driven feature**, rather than defaulting
every call to the most expensive available model out of convenience.

## Token efficiency

Candidate context sent to the AI is already filtered before being sent
— the initial ~150-symbol universe is narrowed to a top-15/20/25 pool
(session-dependent) before any AI call, and the correlation, breadth,
VWAP, and options-flow enrichment only run against that narrowed pool,
not the full universe. **Standard: any new context field added to a
prompt must justify its token cost against the decision it's meant to
improve** — this discipline was followed when VWAP, crypto signals, and
earnings-strategy context were added (each gated to session-appropriate
subsets, not sent universally); it must continue.

## Not yet built

No caching layer exists for repeated identical AI calls (unlikely to be
high-value given how context-dependent each call is, but not yet
evaluated). No token-usage or cost dashboard exists — operating cost is
currently invisible to the user and to whoever is maintaining this
system. Worth building once enough scan volume exists to make the
numbers meaningful.

---

# 12. Documentation Standards

## Required living documents (established this audit pass)

- `/project-audit/SYSTEM_AUDIT.md` — master health tracker, updated every
  audit pass
- `/project-audit/BUG_TRACKER.md` — every known bug, open or fixed, with
  severity and verification steps
- `/project-audit/SECURITY_AUDIT.md` — every security finding, with
  verified (not assumed) severity
- `/project-audit/TRADING_ENGINE_REVIEW.md` — methodological scrutiny of
  the trading logic specifically, updated whenever trading logic changes
  materially
- `/project-audit/ROADMAP.md` — prioritized, sequenced work, updated as
  items complete or new findings emerge
- `/project-audit/HYPOTHESIS_LOG.md` — every major unproven assumption
  the trading system operates on (9 entries as of this writing: H1–H9),
  each with why-we-believe-it, evidence for, evidence against, the
  experiment needed to resolve it, a confidence level, and a conclusion.
  This is where the founder constitution's "Evidence-Based Development"
  principle and the Skeptic Rule (Section 17) stop being abstractions —
  every load-bearing trading assumption in this codebase has a real
  entry here, not a generic placeholder.
- `/project-audit/DECISION_LOG.md` — architectural and trading-system
  decisions (9 entries as of this writing: D-01–D-09) with alternatives
  considered, reasoning, expected impact, and review criteria — cross-
  referencing `HYPOTHESIS_LOG.md` entries wherever a decision rests on
  an unproven assumption.
- `/project-audit/TECHNICAL_DEBT.md` — every known compromise (12
  entries as of this writing: TD-01–TD-12) with severity, impact,
  current workaround (if any), recommended solution, and priority,
  cross-referenced to `ROADMAP.md`'s numbered sequencing.
- `/project-audit/EXPERIMENTS.md` — the scientific testing framework: 7
  designed experiments (E-01–E-08) as of this writing, each tied to a
  specific `HYPOTHESIS_LOG.md` entry, each with a pre-committed
  methodology written BEFORE the experiment runs — design before data,
  never the reverse. Every entry currently reads "Results: Not yet run,"
  honestly, because none have been.
- `ENGINEERING_CONSTITUTION.md` (this file) — updated when a principle
  changes, not when a feature ships (feature changes belong in
  `CHANGELOG.md`, not here)

## Cross-reference discipline (binding rule, added this pass)

These documents are not independent — they form a chain, and that chain
must be preserved by every future change:

- A **hypothesis** in `HYPOTHESIS_LOG.md` that has an available test
  method must have a corresponding **experiment** in `EXPERIMENTS.md`
  citing it by ID.
- A **decision** in `DECISION_LOG.md` that rests on an unproven
  assumption must cite the relevant `HYPOTHESIS_LOG.md` entry by ID —
  never leave a decision's evidentiary basis implicit when it can be
  named.
- A **technical debt** item in `TECHNICAL_DEBT.md` with a numbered
  `ROADMAP.md` sequencing must cite that item number, so the two lists
  never silently drift apart.
- When an experiment in `EXPERIMENTS.md` actually runs and produces a
  result, the corresponding `HYPOTHESIS_LOG.md` entry's confidence level
  and conclusion must be updated in the same change — a hypothesis log
  that still says "Unresolved" after its experiment has run is worse
  than no log at all, because it actively misrepresents what is known.

This chain exists so the Skeptic Rule (Section 17) has an enforced path
from question to test to answer, not just a value someone is trusted to
remember.

## Remaining document this constitution still recommends (not yet built)

- **`CHANGELOG.md`** — a running log of what shipped and why, distinct
  from git history (git history explains individual commits; a
  changelog explains the narrative across them for someone who wasn't
  present). This is the one document from the original recommendation
  list not yet created — the other four (`HYPOTHESIS_LOG.md`,
  `DECISION_LOG.md`, `TECHNICAL_DEBT.md`, `EXPERIMENTS.md`) now exist
  and are populated with real, repository-specific content as of this
  audit pass.

---

# 13. Feature Development Rules

Before adding any feature, answer, in writing (a commit message is
sufficient for smaller features; a `DECISION_LOG.md` entry for larger
ones):

1. **What problem does this solve?** — grounded in an actual observed
   gap, not a generically "impressive" capability. The seven trading-
   logic stages built this project were each justified by a specific,
   named weakness in the existing scoring/sizing/exit logic — that
   standard continues.
2. **What evidence suggests this will help?** — reasoning is acceptable
   for a first version (most of this codebase's trading logic is
   reasoning-based, not yet evidence-based — see Section 4), but the
   reasoning must be stated explicitly, not implied.
3. **How will success be measured?** — even if the answer is currently
   "we don't have enough data yet, so this will be evaluated once N
   trades exist," that's an honest answer. "It'll be obviously better"
   is not.
4. **What would prove this was a mistake?** — the Skeptic Rule (Section
   17), applied per-feature.

**Do not build a feature because it is impressive.** The multi-agent
"skeptic pass" idea in Section 3 is a good example of a feature that
sounds sophisticated and has been deliberately NOT built yet, because no
evidence yet shows single-model reasoning is the actual limiting factor
in this system's decision quality.

---

# 14. Business and Product Standards

## Transparency about what's real

The UI must never present a metric with more confidence than its
underlying sample size supports. `SignalWeightsPanel`'s "building
history" tag for signals under 15 trades is the established standard —
any future performance-facing UI must follow the same pattern rather
than showing a bare percentage or dollar figure with no context about
how much evidence backs it.

## No inflated return claims

No page, notification, or AI-generated message may state or imply a
guaranteed or expected return. Existing agent-generated messages
(`agent_messages` content, trade notifications) already avoid this by
construction — they report what happened ("Closed NVDA +$12.40") not
what will happen. This must hold for any future user-facing summary or
marketing surface built on top of this data.

## Monetization, subscriptions, retention

Not yet built or decided. When they are: any tier gating must not create
an incentive to show a user a more favorable (less honest) version of
their own performance data to encourage upgrade. This is stated
preemptively, before any monetization feature exists, specifically so
it's a constraint from the start rather than a retrofit.

---

# 15. Continuous Improvement System

Every future AI agent or developer working on this repository must, in
order:

1. **Read this constitution first.**
2. **Read `/project-audit/SYSTEM_AUDIT.md`** for current overall health
   and what's changed since the last pass.
3. **Read `/project-audit/BUG_TRACKER.md` and `ROADMAP.md`** to
   understand what's already known-broken and already prioritized —
   do not rediscover BUG-001 through BUG-005 from scratch.
4. **Understand existing decisions** before proposing new ones — check
   `DECISION_LOG.md` (once it exists) or the relevant code comments for
   why something is built the way it is before assuming it's wrong.
5. **Update documentation after changes** — a change to trading logic
   updates `TRADING_ENGINE_REVIEW.md` if it affects a documented
   concern; a change to security posture updates `SECURITY_AUDIT.md`;
   every change updates `CHANGELOG.md` once it exists.
6. **Test improvements** per Section 8's standard.
7. **Explain major decisions** — in the commit message at minimum, in
   `DECISION_LOG.md` for anything touching Sections 5, 6, or 9.

---

# 16. AI Agent Operating Instructions

This section is written specifically for a future Claude (or other AI)
session picking up work on this repository.

## Before changing anything

- Run `git fetch origin && git reset --hard origin/main` and confirm
  `tsc --noEmit` and `npm run build` are clean on the current state
  before attributing any error to your own upcoming change.
- Read the specific file(s) you're about to touch in full, not a
  search-result snippet — this codebase has a real history of bugs
  introduced by pattern-matching on a partial view (see the duplicate
  `entrySignals` declaration caught and fixed during the Kelly-sizing
  work, `BUG_TRACKER.md`'s fixed-bugs section).
- Check `/project-audit/` for whether the thing you're about to
  investigate has already been found and documented.

## While changing something

- One conceptual change per commit, verified (`tsc --noEmit` + build)
  before moving to the next, exactly as established across the seven
  trading-logic stages and three feature additions built this project.
- If a change touches the position-sizing chain (Section 5) or any risk
  control (Section 6), treat it as requiring more scrutiny, not less —
  these are the areas where a plausible-sounding change can most easily
  hide a real regression.
- Do not fabricate benchmark numbers, test results, or confidence scores
  you have not actually produced. If asked for something that requires
  live data or runtime measurement you don't have access to, say so
  explicitly rather than estimate convincingly. This is not a stylistic
  preference — it is the direct operational form of Section 2's "never
  fake confidence" rule, and it was the explicit standard held throughout
  the audit that produced this constitution's grounding.

## After changing something

- Re-run `tsc --noEmit` and `npm run build`. Do not consider a change
  complete on the basis of "it looks right."
- Update the relevant living document(s) per Section 15.
- Push in a commit message that explains the *why*, matching the
  standard already set by this project's commit history — a future
  reader (human or AI) should be able to understand the reasoning without
  needing this conversation's full context.

---

# 17. The Skeptic Rule (preserved from v1.0, now with a required home)

Before accepting any major improvement:

**"What evidence proves this makes the system better?"**
**"How could this improvement be misleading us?"**

This constitution's addition to the founder's original framing: these
two questions must now have an actual place to be answered —
`HYPOTHESIS_LOG.md` (Section 12) once it exists, or the commit message
in the interim. A rule that lives only as a value someone is supposed to
remember to apply will erode under deadline pressure. A rule that has a
required document to write into survives it.

---

# Final Principle (preserved from v1.0, unchanged)

The platform should be developed as if it will eventually manage serious
capital.

Every decision should meet the standard: **"Would we trust this with our
own money?"**

As of this writing, the honest answer is: not yet — not because the
trading logic is unsound, but because two real authorization gaps and
zero test coverage exist alongside it. Fix those first. The roadmap in
`/project-audit/ROADMAP.md` exists precisely so that sequencing is not
optional or forgotten.
