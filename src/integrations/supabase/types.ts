export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      agent_backtest_results: {
        Row: {
          avg_pnl_pct: number | null
          created_at: string
          days_back: number
          details: Json
          id: string
          sharpe: number | null
          total_return_pct: number | null
          trade_count: number | null
          user_id: string
          win_rate: number | null
        }
        Insert: {
          avg_pnl_pct?: number | null
          created_at?: string
          days_back: number
          details?: Json
          id?: string
          sharpe?: number | null
          total_return_pct?: number | null
          trade_count?: number | null
          user_id: string
          win_rate?: number | null
        }
        Update: {
          avg_pnl_pct?: number | null
          created_at?: string
          days_back?: number
          details?: Json
          id?: string
          sharpe?: number | null
          total_return_pct?: number | null
          trade_count?: number | null
          user_id?: string
          win_rate?: number | null
        }
        Relationships: []
      }
      agent_decisions: {
        Row: {
          created_at: string
          id: string
          market_assessment: string | null
          payload: Json
          regime: string | null
          session_type: string
          trades_closed: number
          trades_opened: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          market_assessment?: string | null
          payload?: Json
          regime?: string | null
          session_type: string
          trades_closed?: number
          trades_opened?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          market_assessment?: string | null
          payload?: Json
          regime?: string | null
          session_type?: string
          trades_closed?: number
          trades_opened?: number
          user_id?: string
        }
        Relationships: []
      }
      agent_learnings: {
        Row: {
          adjustments: Json
          analysis: string
          avg_pnl_pct: number | null
          created_at: string
          id: string
          key_insights: Json
          trades_analyzed: number
          user_id: string
          week_start: string
          win_rate: number | null
        }
        Insert: {
          adjustments?: Json
          analysis: string
          avg_pnl_pct?: number | null
          created_at?: string
          id?: string
          key_insights?: Json
          trades_analyzed?: number
          user_id: string
          week_start: string
          win_rate?: number | null
        }
        Update: {
          adjustments?: Json
          analysis?: string
          avg_pnl_pct?: number | null
          created_at?: string
          id?: string
          key_insights?: Json
          trades_analyzed?: number
          user_id?: string
          week_start?: string
          win_rate?: number | null
        }
        Relationships: []
      }
      agent_memory: {
        Row: {
          content: string
          created_at: string
          expires_at: string | null
          id: string
          memory_type: string
          relevance: number
          symbol: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          expires_at?: string | null
          id?: string
          memory_type: string
          relevance?: number
          symbol?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          memory_type?: string
          relevance?: number
          symbol?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          is_autonomous: boolean
          role: string
          session_type: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_autonomous?: boolean
          role?: string
          session_type?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_autonomous?: boolean
          role?: string
          session_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      agent_signal_weights: {
        Row: {
          absent_alpha: number
          absent_avg_pnl_pct: number
          absent_beta: number
          absent_sample_size: number
          alpha: number
          avg_loss_pct: number
          avg_pnl_pct: number
          avg_win_pct: number
          beta: number
          id: string
          loss_count: number
          sample_size: number
          signal_name: string
          updated_at: string
          user_id: string
          weight_multiplier: number
          win_count: number
        }
        Insert: {
          absent_alpha?: number
          absent_avg_pnl_pct?: number
          absent_beta?: number
          absent_sample_size?: number
          alpha?: number
          avg_loss_pct?: number
          avg_pnl_pct?: number
          avg_win_pct?: number
          beta?: number
          id?: string
          loss_count?: number
          sample_size?: number
          signal_name: string
          updated_at?: string
          user_id: string
          weight_multiplier?: number
          win_count?: number
        }
        Update: {
          absent_alpha?: number
          absent_avg_pnl_pct?: number
          absent_beta?: number
          absent_sample_size?: number
          alpha?: number
          avg_loss_pct?: number
          avg_pnl_pct?: number
          avg_win_pct?: number
          beta?: number
          id?: string
          loss_count?: number
          sample_size?: number
          signal_name?: string
          updated_at?: string
          user_id?: string
          weight_multiplier?: number
          win_count?: number
        }
        Relationships: []
      }
      broker_connections: {
        Row: {
          account_label: string | null
          connected: boolean
          created_at: string
          id: string
          is_live: boolean
          provider: Database["public"]["Enums"]["broker_provider"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_label?: string | null
          connected?: boolean
          created_at?: string
          id?: string
          is_live?: boolean
          provider?: Database["public"]["Enums"]["broker_provider"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_label?: string | null
          connected?: boolean
          created_at?: string
          id?: string
          is_live?: boolean
          provider?: Database["public"]["Enums"]["broker_provider"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      btc_dominance_snapshots: {
        Row: {
          created_at: string
          dominance_pct: number
          id: string
        }
        Insert: {
          created_at?: string
          dominance_pct: number
          id?: string
        }
        Update: {
          created_at?: string
          dominance_pct?: number
          id?: string
        }
        Relationships: []
      }
      cron_locks: {
        Row: {
          acquired_at: string
          expires_at: string
          lock_key: string
        }
        Insert: {
          acquired_at: string
          expires_at: string
          lock_key: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          lock_key?: string
        }
        Relationships: []
      }
      iv_history_snapshots: {
        Row: {
          created_at: string
          id: string
          iv_pct: number
          symbol: string
        }
        Insert: {
          created_at?: string
          id?: string
          iv_pct: number
          symbol: string
        }
        Update: {
          created_at?: string
          id?: string
          iv_pct?: number
          symbol?: string
        }
        Relationships: []
      }
      manual_positions: {
        Row: {
          asset: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          cost_basis: number
          created_at: string
          id: string
          shares: number
          user_id: string
        }
        Insert: {
          asset: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          cost_basis: number
          created_at?: string
          id?: string
          shares: number
          user_id: string
        }
        Update: {
          asset?: string
          asset_type?: Database["public"]["Enums"]["asset_type"]
          cost_basis?: number
          created_at?: string
          id?: string
          shares?: number
          user_id?: string
        }
        Relationships: []
      }
      market_breadth_snapshots: {
        Row: {
          breadth_score: number
          created_at: string
          id: string
        }
        Insert: {
          breadth_score: number
          created_at?: string
          id?: string
        }
        Update: {
          breadth_score?: number
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      market_signals: {
        Row: {
          asset: string
          confidence: number
          created_at: string
          direction: Database["public"]["Enums"]["signal_direction"]
          entry_price: number | null
          expected_edge_pct: number | null
          id: string
          is_public: boolean
          resolved_at: string | null
          resolved_pnl_pct: number | null
          result: Database["public"]["Enums"]["signal_result"]
          signal_type: Database["public"]["Enums"]["signal_type"]
          stop_price: number | null
          target_price: number | null
          thesis: string | null
          user_id: string | null
        }
        Insert: {
          asset: string
          confidence: number
          created_at?: string
          direction: Database["public"]["Enums"]["signal_direction"]
          entry_price?: number | null
          expected_edge_pct?: number | null
          id?: string
          is_public?: boolean
          resolved_at?: string | null
          resolved_pnl_pct?: number | null
          result?: Database["public"]["Enums"]["signal_result"]
          signal_type: Database["public"]["Enums"]["signal_type"]
          stop_price?: number | null
          target_price?: number | null
          thesis?: string | null
          user_id?: string | null
        }
        Update: {
          asset?: string
          confidence?: number
          created_at?: string
          direction?: Database["public"]["Enums"]["signal_direction"]
          entry_price?: number | null
          expected_edge_pct?: number | null
          id?: string
          is_public?: boolean
          resolved_at?: string | null
          resolved_pnl_pct?: number | null
          result?: Database["public"]["Enums"]["signal_result"]
          signal_type?: Database["public"]["Enums"]["signal_type"]
          stop_price?: number | null
          target_price?: number | null
          thesis?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      market_tracking: {
        Row: {
          asset: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          asset: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          asset?: string
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_connections: {
        Row: {
          access_token: string | null
          auth_url: string | null
          client_id: string | null
          client_secret: string | null
          code_verifier: string | null
          created_at: string
          dcr_metadata: Json | null
          expires_at: string | null
          id: string
          oauth_state: string | null
          refresh_token: string | null
          server_label: string
          server_url: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          auth_url?: string | null
          client_id?: string | null
          client_secret?: string | null
          code_verifier?: string | null
          created_at?: string
          dcr_metadata?: Json | null
          expires_at?: string | null
          id?: string
          oauth_state?: string | null
          refresh_token?: string | null
          server_label: string
          server_url: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          auth_url?: string | null
          client_id?: string | null
          client_secret?: string | null
          code_verifier?: string | null
          created_at?: string
          dcr_metadata?: Json | null
          expires_at?: string | null
          id?: string
          oauth_state?: string | null
          refresh_token?: string | null
          server_label?: string
          server_url?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_portfolios: {
        Row: {
          balance: number
          created_at: string
          equity: number
          id: string
          starting_balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          equity?: number
          id?: string
          starting_balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          equity?: number
          id?: string
          starting_balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          asset: string
          closed_at: string | null
          conviction: number | null
          created_at: string
          entry_price: number
          entry_quoted_price: number | null
          entry_signals: string[] | null
          entry_slippage_bps: number | null
          estimated_fees: number | null
          exit_price: number | null
          exit_quoted_price: number | null
          exit_slippage_bps: number | null
          hold_duration: string | null
          id: string
          instrument: string
          is_open: boolean
          options_details: Json | null
          pnl: number | null
          portfolio_id: string
          quantity: number
          rationale: string | null
          side: Database["public"]["Enums"]["trade_side"]
          stop_loss_pct: number | null
          strategy_id: string | null
          take_profit_pct: number | null
          user_id: string
        }
        Insert: {
          asset: string
          closed_at?: string | null
          conviction?: number | null
          created_at?: string
          entry_price: number
          entry_quoted_price?: number | null
          entry_signals?: string[] | null
          entry_slippage_bps?: number | null
          estimated_fees?: number | null
          exit_price?: number | null
          exit_quoted_price?: number | null
          exit_slippage_bps?: number | null
          hold_duration?: string | null
          id?: string
          instrument?: string
          is_open?: boolean
          options_details?: Json | null
          pnl?: number | null
          portfolio_id: string
          quantity: number
          rationale?: string | null
          side: Database["public"]["Enums"]["trade_side"]
          stop_loss_pct?: number | null
          strategy_id?: string | null
          take_profit_pct?: number | null
          user_id: string
        }
        Update: {
          asset?: string
          closed_at?: string | null
          conviction?: number | null
          created_at?: string
          entry_price?: number
          entry_quoted_price?: number | null
          entry_signals?: string[] | null
          entry_slippage_bps?: number | null
          estimated_fees?: number | null
          exit_price?: number | null
          exit_quoted_price?: number | null
          exit_slippage_bps?: number | null
          hold_duration?: string | null
          id?: string
          instrument?: string
          is_open?: boolean
          options_details?: Json | null
          pnl?: number | null
          portfolio_id?: string
          quantity?: number
          rationale?: string | null
          side?: Database["public"]["Enums"]["trade_side"]
          stop_loss_pct?: number | null
          strategy_id?: string | null
          take_profit_pct?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_trades_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "paper_portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_trades_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_snapshots: {
        Row: {
          cash: number
          created_at: string
          equity: number
          id: string
          open_positions: number
          user_id: string
        }
        Insert: {
          cash: number
          created_at?: string
          equity: number
          id?: string
          open_positions?: number
          user_id: string
        }
        Update: {
          cash?: number
          created_at?: string
          equity?: number
          id?: string
          open_positions?: number
          user_id?: string
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          asset: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          direction: Database["public"]["Enums"]["alert_direction"]
          id: string
          target_price: number
          triggered: boolean
          triggered_at: string | null
          triggered_price: number | null
          user_id: string
        }
        Insert: {
          asset: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          direction: Database["public"]["Enums"]["alert_direction"]
          id?: string
          target_price: number
          triggered?: boolean
          triggered_at?: string | null
          triggered_price?: number | null
          user_id: string
        }
        Update: {
          asset?: string
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          direction?: Database["public"]["Enums"]["alert_direction"]
          id?: string
          target_price?: number
          triggered?: boolean
          triggered_at?: string | null
          triggered_price?: number | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          tier: Database["public"]["Enums"]["user_tier"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          tier?: Database["public"]["Enums"]["user_tier"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          tier?: Database["public"]["Enums"]["user_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_state: {
        Row: {
          bucket_key: string
          request_count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          request_count?: number
          updated_at?: string
          window_start: string
        }
        Update: {
          bucket_key?: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      risk_limits: {
        Row: {
          cooldown_seconds: number
          id: string
          max_daily_loss_pct: number
          max_position_pct: number
          max_sector_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cooldown_seconds?: number
          id?: string
          max_daily_loss_pct?: number
          max_position_pct?: number
          max_sector_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cooldown_seconds?: number
          id?: string
          max_daily_loss_pct?: number
          max_position_pct?: number
          max_sector_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      robinhood_snapshots: {
        Row: {
          balance: number
          buying_power: number | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          balance: number
          buying_power?: number | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          balance?: number
          buying_power?: number | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      shadow_candidate_log: {
        Row: {
          actual_trade_id: string | null
          agreement: string
          claude_conviction: number | null
          claude_direction: string | null
          claude_traded: boolean
          created_at: string
          deterministic_direction: string
          deterministic_rank: number
          deterministic_score: number
          hypothetical_return_pct: number | null
          id: string
          price_at_scan: number | null
          resolution_price: number | null
          resolved: boolean
          resolved_at: string | null
          session_type: string
          symbol: string
          user_id: string
        }
        Insert: {
          actual_trade_id?: string | null
          agreement: string
          claude_conviction?: number | null
          claude_direction?: string | null
          claude_traded?: boolean
          created_at?: string
          deterministic_direction: string
          deterministic_rank: number
          deterministic_score: number
          hypothetical_return_pct?: number | null
          id?: string
          price_at_scan?: number | null
          resolution_price?: number | null
          resolved?: boolean
          resolved_at?: string | null
          session_type: string
          symbol: string
          user_id: string
        }
        Update: {
          actual_trade_id?: string | null
          agreement?: string
          claude_conviction?: number | null
          claude_direction?: string | null
          claude_traded?: boolean
          created_at?: string
          deterministic_direction?: string
          deterministic_rank?: number
          deterministic_score?: number
          hypothetical_return_pct?: number | null
          id?: string
          price_at_scan?: number | null
          resolution_price?: number | null
          resolved?: boolean
          resolved_at?: string | null
          session_type?: string
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shadow_candidate_log_actual_trade_id_fkey"
            columns: ["actual_trade_id"]
            isOneToOne: false
            referencedRelation: "paper_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_weighting_comparison: {
        Row: {
          actual_trade_id: string | null
          adaptive_bear_score: number
          adaptive_bull_score: number
          adaptive_rank: number
          created_at: string
          direction_hint: string
          hypothetical_return_pct: number | null
          id: string
          neutral_bear_score: number
          neutral_bull_score: number
          neutral_rank: number
          price_at_scan: number | null
          rank_delta: number
          resolution_price: number | null
          resolved: boolean
          resolved_at: string | null
          session_type: string
          symbol: string
          user_id: string
          was_traded: boolean
        }
        Insert: {
          actual_trade_id?: string | null
          adaptive_bear_score: number
          adaptive_bull_score: number
          adaptive_rank: number
          created_at?: string
          direction_hint?: string
          hypothetical_return_pct?: number | null
          id?: string
          neutral_bear_score: number
          neutral_bull_score: number
          neutral_rank: number
          price_at_scan?: number | null
          rank_delta: number
          resolution_price?: number | null
          resolved?: boolean
          resolved_at?: string | null
          session_type: string
          symbol: string
          user_id: string
          was_traded?: boolean
        }
        Update: {
          actual_trade_id?: string | null
          adaptive_bear_score?: number
          adaptive_bull_score?: number
          adaptive_rank?: number
          created_at?: string
          direction_hint?: string
          hypothetical_return_pct?: number | null
          id?: string
          neutral_bear_score?: number
          neutral_bull_score?: number
          neutral_rank?: number
          price_at_scan?: number | null
          rank_delta?: number
          resolution_price?: number | null
          resolved?: boolean
          resolved_at?: string | null
          session_type?: string
          symbol?: string
          user_id?: string
          was_traded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shadow_weighting_comparison_actual_trade_id_fkey"
            columns: ["actual_trade_id"]
            isOneToOne: false
            referencedRelation: "paper_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      signals_executions: {
        Row: {
          asset: string
          created_at: string
          execution_type: Database["public"]["Enums"]["execution_mode"]
          id: string
          price: number | null
          quantity: number
          reason: string | null
          side: Database["public"]["Enums"]["trade_side"]
          signal_id: string | null
          status: Database["public"]["Enums"]["execution_status"]
          strategy_id: string | null
          user_id: string
        }
        Insert: {
          asset: string
          created_at?: string
          execution_type?: Database["public"]["Enums"]["execution_mode"]
          id?: string
          price?: number | null
          quantity: number
          reason?: string | null
          side: Database["public"]["Enums"]["trade_side"]
          signal_id?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          strategy_id?: string | null
          user_id: string
        }
        Update: {
          asset?: string
          created_at?: string
          execution_type?: Database["public"]["Enums"]["execution_mode"]
          id?: string
          price?: number | null
          quantity?: number
          reason?: string | null
          side?: Database["public"]["Enums"]["trade_side"]
          signal_id?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          strategy_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_executions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "market_signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_executions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_alerts: {
        Row: {
          action: Json
          active: boolean
          conditions: Json
          created_at: string
          id: string
          last_triggered_at: string | null
          name: string
          user_id: string
        }
        Insert: {
          action?: Json
          active?: boolean
          conditions?: Json
          created_at?: string
          id?: string
          last_triggered_at?: string | null
          name: string
          user_id: string
        }
        Update: {
          action?: Json
          active?: boolean
          conditions?: Json
          created_at?: string
          id?: string
          last_triggered_at?: string | null
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      strategies: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          execution_mode: Database["public"]["Enums"]["execution_mode"]
          explanation: string | null
          id: string
          market_type: Database["public"]["Enums"]["market_type"]
          name: string
          risk_level: Database["public"]["Enums"]["risk_level"]
          source: string
          strategy_json: Json
          style: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          execution_mode?: Database["public"]["Enums"]["execution_mode"]
          explanation?: string | null
          id?: string
          market_type?: Database["public"]["Enums"]["market_type"]
          name: string
          risk_level?: Database["public"]["Enums"]["risk_level"]
          source?: string
          strategy_json?: Json
          style?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          execution_mode?: Database["public"]["Enums"]["execution_mode"]
          explanation?: string | null
          id?: string
          market_type?: Database["public"]["Enums"]["market_type"]
          name?: string
          risk_level?: Database["public"]["Enums"]["risk_level"]
          source?: string
          strategy_json?: Json
          style?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      strategy_ab_tests: {
        Row: {
          ab_budget: number
          created_at: string
          end_date: string | null
          id: string
          name: string
          result_confidence: number | null
          result_summary: string | null
          result_winner: string | null
          split_pct: number
          start_date: string
          status: string
          strategy_a_id: string
          strategy_b_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ab_budget?: number
          created_at?: string
          end_date?: string | null
          id?: string
          name: string
          result_confidence?: number | null
          result_summary?: string | null
          result_winner?: string | null
          split_pct?: number
          start_date?: string
          status?: string
          strategy_a_id: string
          strategy_b_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ab_budget?: number
          created_at?: string
          end_date?: string | null
          id?: string
          name?: string
          result_confidence?: number | null
          result_summary?: string | null
          result_winner?: string | null
          split_pct?: number
          start_date?: string
          status?: string
          strategy_a_id?: string
          strategy_b_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_ab_tests_strategy_a_id_fkey"
            columns: ["strategy_a_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_ab_tests_strategy_b_id_fkey"
            columns: ["strategy_b_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_performance: {
        Row: {
          backtest_from: string | null
          backtest_to: string | null
          drawdown: number | null
          equity_curve: Json | null
          id: string
          roi: number | null
          sharpe: number | null
          strategy_id: string
          trade_count: number | null
          updated_at: string
          user_id: string
          win_rate: number | null
        }
        Insert: {
          backtest_from?: string | null
          backtest_to?: string | null
          drawdown?: number | null
          equity_curve?: Json | null
          id?: string
          roi?: number | null
          sharpe?: number | null
          strategy_id: string
          trade_count?: number | null
          updated_at?: string
          user_id: string
          win_rate?: number | null
        }
        Update: {
          backtest_from?: string | null
          backtest_to?: string | null
          drawdown?: number | null
          equity_curve?: Json | null
          id?: string
          roi?: number | null
          sharpe?: number | null
          strategy_id?: string
          trade_count?: number | null
          updated_at?: string
          user_id?: string
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_performance_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_versions: {
        Row: {
          created_at: string
          id: string
          note: string | null
          strategy_id: string
          strategy_json: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          strategy_id: string
          strategy_json: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          strategy_id?: string
          strategy_json?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_versions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          agent_settings: Json
          autonomous_execution_mode: string
          autonomous_mode: boolean
          autonomous_paused_until: string | null
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_settings?: Json
          autonomous_execution_mode?: string
          autonomous_mode?: boolean
          autonomous_paused_until?: string | null
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_settings?: Json
          autonomous_execution_mode?: string
          autonomous_mode?: boolean
          autonomous_paused_until?: string | null
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_tiers: {
        Row: {
          created_at: string
          granted_by: string | null
          tier: Database["public"]["Enums"]["app_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          tier?: Database["public"]["Enums"]["app_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          tier?: Database["public"]["Enums"]["app_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_webhooks: {
        Row: {
          active: boolean
          created_at: string
          events: string[]
          id: string
          updated_at: string
          user_id: string
          webhook_url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          events?: string[]
          id?: string
          updated_at?: string
          user_id: string
          webhook_url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          events?: string[]
          id?: string
          updated_at?: string
          user_id?: string
          webhook_url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cron_lock_cleanup: { Args: never; Returns: undefined }
      get_strategy_trade_stats: {
        Args: never
        Returns: {
          strategy_id: string
          total_pnl: number
          trade_count: number
          win_count: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tier: {
        Args: {
          _min: Database["public"]["Enums"]["app_tier"]
          _user_id: string
        }
        Returns: boolean
      }
      rate_limit_cleanup: { Args: never; Returns: undefined }
      rate_limit_increment: {
        Args: { p_bucket_key: string; p_window_start: string }
        Returns: {
          is_new_window: boolean
          request_count: number
        }[]
      }
      register_all_crons: { Args: never; Returns: Json }
      release_cron_lock: { Args: { p_lock_key: string }; Returns: undefined }
      tier_rank: {
        Args: { _tier: Database["public"]["Enums"]["app_tier"] }
        Returns: number
      }
      try_acquire_cron_lock: {
        Args: { p_lock_key: string; p_ttl_seconds: number }
        Returns: boolean
      }
    }
    Enums: {
      alert_direction: "above" | "below"
      app_role: "admin" | "user"
      app_tier: "free" | "pro" | "elite"
      asset_type: "stock" | "crypto"
      broker_provider: "paper" | "alpaca" | "ibkr"
      execution_mode: "off" | "paper" | "live"
      execution_status: "pending" | "filled" | "rejected" | "cancelled"
      market_type: "stocks" | "crypto" | "both"
      risk_level: "low" | "medium" | "high"
      signal_direction: "call" | "put" | "buy" | "sell"
      signal_result: "open" | "hit_target" | "hit_stop" | "stale"
      signal_type: "options_flow" | "buy_sell"
      trade_side: "buy" | "sell"
      user_tier: "free" | "starter" | "pro" | "premium"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_direction: ["above", "below"],
      app_role: ["admin", "user"],
      app_tier: ["free", "pro", "elite"],
      asset_type: ["stock", "crypto"],
      broker_provider: ["paper", "alpaca", "ibkr"],
      execution_mode: ["off", "paper", "live"],
      execution_status: ["pending", "filled", "rejected", "cancelled"],
      market_type: ["stocks", "crypto", "both"],
      risk_level: ["low", "medium", "high"],
      signal_direction: ["call", "put", "buy", "sell"],
      signal_result: ["open", "hit_target", "hit_stop", "stale"],
      signal_type: ["options_flow", "buy_sell"],
      trade_side: ["buy", "sell"],
      user_tier: ["free", "starter", "pro", "premium"],
    },
  },
} as const
