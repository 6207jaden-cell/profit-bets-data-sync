-- Add conviction score column to paper_trades so calibration analysis can query it directly
-- (conviction is also embedded in rationale as [conviction:N] as fallback)
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS conviction integer;

-- Add agent_scan to the default webhook events so users get notified on scans
UPDATE public.user_webhooks
SET events = array_append(events, 'agent_scan')
WHERE NOT ('agent_scan' = ANY(events));

-- Index for conviction-based queries
CREATE INDEX IF NOT EXISTS idx_paper_trades_conviction
  ON public.paper_trades(conviction) WHERE is_open = false;
