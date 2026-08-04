-- Experiment 4 (Signal Contribution Analysis): agent_signal_weights
-- currently only tracks stats for trades where a signal WAS present. To
-- measure a signal's actual contribution — not just "how well did trades
-- with this signal do" but "how much BETTER (or worse) did trades with
-- this signal do compared to trades WITHOUT it" — an absent-side Bayesian
-- track is needed on the same table. Same incremental-average pattern as
-- the existing present-side columns, computed for every KNOWN signal that
-- was NOT active on a given closed trade.
--
-- Deliberately added to the SAME table rather than a new one: present-side
-- and absent-side stats describe the SAME signal, just two different
-- comparison groups — keeping them on one row per signal_name makes the
-- present-vs-absent comparison a single-row read instead of a join.
--
-- IMPORTANT: these new columns are read-only observational data. They do
-- NOT feed weight_multiplier (which drives real scoring) or Kelly sizing —
-- per the explicit instruction for this phase: "Do not automatically
-- increase weights. Only create evidence."

ALTER TABLE public.agent_signal_weights
  ADD COLUMN IF NOT EXISTS absent_alpha        numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS absent_beta         numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS absent_sample_size  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absent_avg_pnl_pct  numeric NOT NULL DEFAULT 0;
