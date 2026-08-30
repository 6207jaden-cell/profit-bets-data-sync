// Lovable AI Gateway terminal-denial handling.
//
// A 402 ("Not enough credits") or 403 (AI disabled / credit limit / stale key)
// is NOT retryable — re-sending produces the same answer. Before this module
// the autonomous agent swallowed those statuses into a generic `null`, so every
// scheduled scan quietly recorded `{ai_error:true}` and the user saw no agent
// activity and no explanation. These helpers classify the denial and surface it
// to the user instead.

export type GatewayBlock = {
  status: number;
  /** Owner-facing explanation, taken from the gateway's own message when present. */
  message: string;
  /** true when the gateway explicitly marked the denial non-retryable. */
  terminal: boolean;
};

/**
 * Returns a GatewayBlock for statuses that require owner action (402/403),
 * or null for statuses that are transient (429/5xx) or request-level (400/401).
 */
export function classifyGatewayFailure(status: number, bodyText: string): GatewayBlock | null {
  if (status !== 402 && status !== 403) return null;
  let message = "";
  let terminal = true;
  try {
    const j = JSON.parse(bodyText) as {
      message?: string; title?: string;
      props?: { retryable?: boolean; requires?: string };
    };
    message = j.message ?? j.title ?? "";
    if (j.props?.retryable === true) terminal = false;
    if (!message && j.props?.requires === "top_up") message = "Not enough AI credits.";
  } catch { /* body wasn't JSON — fall back to the default text below */ }
  if (!message) {
    message = status === 402
      ? "Not enough AI credits to run the AI agent."
      : "AI access is blocked by a workspace setting or credit limit.";
  }
  return { status, message, terminal };
}

/** Short, user-readable line describing what needs to happen next. */
export function gatewayBlockUserMessage(block: GatewayBlock): string {
  const action = block.status === 402
    ? "Add AI credits in Lovable to resume automated scans."
    : "An admin needs to re-enable AI access or raise the credit limit to resume automated scans.";
  return `⚠️ The AI agent could not run: ${block.message} ${action}`;
}
