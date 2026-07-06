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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
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
          refresh_token?: string | null
          server_label?: string
          server_url?: string
          state?: string
          updated_at?: string
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
          created_at: string
          entry_price: number
          exit_price: number | null
          id: string
          is_open: boolean
          pnl: number | null
          portfolio_id: string
          quantity: number
          side: Database["public"]["Enums"]["trade_side"]
          strategy_id: string | null
          user_id: string
        }
        Insert: {
          asset: string
          closed_at?: string | null
          created_at?: string
          entry_price: number
          exit_price?: number | null
          id?: string
          is_open?: boolean
          pnl?: number | null
          portfolio_id: string
          quantity: number
          side: Database["public"]["Enums"]["trade_side"]
          strategy_id?: string | null
          user_id: string
        }
        Update: {
          asset?: string
          closed_at?: string | null
          created_at?: string
          entry_price?: number
          exit_price?: number | null
          id?: string
          is_open?: boolean
          pnl?: number | null
          portfolio_id?: string
          quantity?: number
          side?: Database["public"]["Enums"]["trade_side"]
          strategy_id?: string | null
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
          id: string
          market_type: Database["public"]["Enums"]["market_type"]
          name: string
          risk_level: Database["public"]["Enums"]["risk_level"]
          strategy_json: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          execution_mode?: Database["public"]["Enums"]["execution_mode"]
          id?: string
          market_type?: Database["public"]["Enums"]["market_type"]
          name: string
          risk_level?: Database["public"]["Enums"]["risk_level"]
          strategy_json?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          execution_mode?: Database["public"]["Enums"]["execution_mode"]
          id?: string
          market_type?: Database["public"]["Enums"]["market_type"]
          name?: string
          risk_level?: Database["public"]["Enums"]["risk_level"]
          strategy_json?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      tier_rank: {
        Args: { _tier: Database["public"]["Enums"]["app_tier"] }
        Returns: number
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
