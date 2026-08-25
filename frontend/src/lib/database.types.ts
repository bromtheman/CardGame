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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      cards: {
        Row: {
          blueprint_cost: number
          card_text: string
          cp_cost: number
          created_at: string
          faction: string
          id: string
          image_url: string
          is_built_in: boolean
          keywords: Json
          material_cost: number
          meta: Json
          name: string
          owner_id: string | null
          type: string
          vehicle_type: string | null
        }
        Insert: {
          blueprint_cost?: number
          card_text?: string
          cp_cost?: number
          created_at?: string
          faction: string
          id: string
          image_url?: string
          is_built_in?: boolean
          keywords?: Json
          material_cost?: number
          meta?: Json
          name: string
          owner_id?: string | null
          type: string
          vehicle_type?: string | null
        }
        Update: {
          blueprint_cost?: number
          card_text?: string
          cp_cost?: number
          created_at?: string
          faction?: string
          id?: string
          image_url?: string
          is_built_in?: boolean
          keywords?: Json
          material_cost?: number
          meta?: Json
          name?: string
          owner_id?: string | null
          type?: string
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cards_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      decks: {
        Row: {
          cards: Json
          created_at: string
          faction: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          cards?: Json
          created_at?: string
          faction: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          cards?: Json
          created_at?: string
          faction?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_players: {
        Row: {
          deck: Json
          game_id: string
          hand: Json
          player_id: string
          updated_at: string
        }
        Insert: {
          deck?: Json
          game_id: string
          hand?: Json
          player_id: string
          updated_at?: string
        }
        Update: {
          deck?: Json
          game_id?: string
          hand?: Json
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_players_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          active_player: string
          created_at: string
          id: string
          lobby_id: string | null
          player_a: string
          player_b: string
          settings: Json
          state: Json
          status: string
          turn_number: number
          updated_at: string
          version: number
          winner_id: string | null
        }
        Insert: {
          active_player: string
          created_at?: string
          id?: string
          lobby_id?: string | null
          player_a: string
          player_b: string
          settings?: Json
          state?: Json
          status?: string
          turn_number?: number
          updated_at?: string
          version?: number
          winner_id?: string | null
        }
        Update: {
          active_player?: string
          created_at?: string
          id?: string
          lobby_id?: string | null
          player_a?: string
          player_b?: string
          settings?: Json
          state?: Json
          status?: string
          turn_number?: number
          updated_at?: string
          version?: number
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "games_active_player_fkey"
            columns: ["active_player"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_player_a_fkey"
            columns: ["player_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_player_b_fkey"
            columns: ["player_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hero_powers: {
        Row: {
          cp_cost: number
          created_at: string
          faction: string
          id: string
          meta: Json
          name: string
          power_text: string
        }
        Insert: {
          cp_cost?: number
          created_at?: string
          faction: string
          id: string
          meta?: Json
          name: string
          power_text: string
        }
        Update: {
          cp_cost?: number
          created_at?: string
          faction?: string
          id?: string
          meta?: Json
          name?: string
          power_text?: string
        }
        Relationships: []
      }
      lobbies: {
        Row: {
          created_at: string
          game_id: string | null
          guest_deck_id: string | null
          guest_id: string | null
          host_deck_id: string
          host_id: string
          id: string
          name: string
          settings: Json
          status: string
        }
        Insert: {
          created_at?: string
          game_id?: string | null
          guest_deck_id?: string | null
          guest_id?: string | null
          host_deck_id: string
          host_id: string
          id?: string
          name: string
          settings?: Json
          status?: string
        }
        Update: {
          created_at?: string
          game_id?: string | null
          guest_deck_id?: string | null
          guest_id?: string | null
          host_deck_id?: string
          host_id?: string
          id?: string
          name?: string
          settings?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lobbies_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_guest_deck_id_fkey"
            columns: ["guest_deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_host_deck_id_fkey"
            columns: ["host_deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_action_tx: {
        Args: {
          p_a_state: Json
          p_b_state: Json
          p_expected_version: number
          p_game: Json
          p_game_id: string
        }
        Returns: number
      }
      start_game_tx: {
        Args: {
          p_game: Json
          p_lobby_id: string
          p_player_a_state: Json
          p_player_b_state: Json
        }
        Returns: string
      }
      username_available: { Args: { check_name: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
