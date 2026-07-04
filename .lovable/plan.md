## Goal

Add an **AI Agent** tab to the Trading dashboard where users chat with an AI that has live access to their Robinhood account via Robinhood's MCP server at `https://agent.robinhood.com/mcp/trading`. Each user connects their own Robinhood account through OAuth; the AI can then call whatever tools Robinhood exposes (get portfolio, place order, etc.).

## User flow

1. User opens Trading → **Agent** tab
2. First visit shows "Connect Robinhood" button → OAuth popup → returns authenticated
3. Chat interface appears with input like "Show my positions" / "Sell half my AAPL"
4. AI (Gemini 3 Flash) responds, calling Robinhood MCP tools as needed
5. Tool calls render inline (collapsed by default) with status, params, result
6. Every trade the agent proposes goes through Robinhood's own confirmation layer

## Technical implementation

### 1. Database migration
New table `mcp_connections` for per-user OAuth state:
- `user_id`, `server_url`, `server_label` ("Robinhood")
- `access_token`, `refresh_token`, `expires_at` (encrypted-at-rest via Supabase)
- `client_id`, `client_secret`, `dcr_metadata` (dynamic client registration data)
- `state` (`ready` | `authenticating` | `failed`), `auth_url`
- RLS: user owns their rows; service role for admin
- GRANTs for authenticated + service_role

### 2. Packages
`bun add ai @ai-sdk/react @ai-sdk/openai-compatible @ai-sdk/mcp zod` and AI Elements: `bunx ai-elements@latest add conversation message prompt-input shimmer tool`

### 3. Server functions (`src/lib/mcp-client.functions.ts`)
- `initiateRobinhoodConnection` — creates MCP client with OAuth provider, probes tools, returns `{ state, authUrl? }`
- `completeRobinhoodOAuth` — handles callback, saves tokens, marks ready
- `getRobinhoodConnection` — returns current user's connection state
- `disconnectRobinhood` — deletes the connection

### 4. OAuth callback route
`src/routes/api/mcp/robinhood/callback.ts` — server route completing the OAuth code exchange, storing tokens, redirecting user back to `/trading?tab=agent&connected=1`

### 5. Chat streaming route
`src/routes/api/chat/agent.ts` — POST handler that:
- Verifies auth (bearer middleware)
- Loads user's Robinhood MCP connection tokens
- Creates short-lived MCP client, calls `client.tools()` to fetch Robinhood tools
- Calls `streamText` with Lovable AI Gateway (`google/gemini-3-flash-preview`), passing MCP tools + a trading-focused system prompt
- Returns `toUIMessageStreamResponse()`
- Closes MCP client in `onFinish` and on error

### 6. UI — new "Agent" tab in TradingDashboard
`src/features/trading/components/AgentPanel.tsx`:
- **Disconnected state**: "Connect Robinhood" card with OAuth CTA (matches your screenshot's dark aesthetic — sparse, Beta badge, three benefit bullets)
- **Connected state**: AI Elements chat (`Conversation`, `Message`, `MessageResponse`, `Tool`, `PromptInput`) using `useChat` pointed at `/api/chat/agent`
- Suggested prompts on empty state: "What's in my portfolio?", "Analyze my top holding", "Set up a stop loss on TSLA"
- Tool calls render in collapsed accordions showing Robinhood API activity
- Uses no localStorage / no thread history for v1 — single ephemeral conversation per session (can add threads later)

### 7. TradingDashboard integration
Add 7th tab "Agent" with `Sparkles`-adjacent domain icon (use `Bot` or generated logo). No tier gate initially — Robinhood's own account/safety layer applies.

## Security & safety notes

- MCP tokens stored server-side only, scoped by RLS to `auth.uid()`
- Chat route requires `requireSupabaseAuth`; token never leaves the server
- No `supabaseAdmin` in client-reachable modules
- The AI cannot bypass Robinhood's per-trade confirmations — those live on Robinhood's side
- System prompt instructs the model to summarize proposed trades before executing and to prefer read-only tools when the user's intent is ambiguous

## Out of scope for this turn

- Chat history persistence (threads/db) — ephemeral only
- Live-order confirmation modal *inside our app* (Robinhood handles theirs)
- Removing/rewiring the existing Alpaca "Broker" tab — leaves it alongside as an alternative path
- Non-Robinhood MCP servers (extensible via `mcp_connections.server_url` but no UI yet)

## Deliverables

1. `supabase/migrations/…_mcp_connections.sql`
2. `src/lib/mcp-client.functions.ts`
3. `src/routes/api/mcp/robinhood/callback.ts`
4. `src/routes/api/chat/agent.ts`
5. `src/features/trading/components/AgentPanel.tsx`
6. AI Elements components under `src/components/ai-elements/`
7. Updated `src/features/trading/TradingDashboard.tsx` (new tab)

Confirm and I'll ship it in phases: **(a)** migration + packages + AI Elements, **(b)** OAuth connect flow, **(c)** chat streaming + UI.