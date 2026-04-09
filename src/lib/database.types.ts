// ============================================================
// Supabase 数据库类型定义
// 与 supabase/schema.sql 和 mock-data.ts 中的类型对齐
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      knowledge_items: {
        Row: {
          id: string;
          type: "article" | "thought" | "insight";
          title: string;
          summary: string;
          tags: string[];
          domain: string;
          source_url: string | null;
          source_type: "url" | "text" | "thought" | null;
          raw_content: string | null;
          embedding: string | null;
          user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          type: "article" | "thought" | "insight";
          title: string;
          summary: string;
          tags?: string[];
          domain: string;
          source_url?: string | null;
          source_type?: "url" | "text" | "thought" | null;
          raw_content?: string | null;
          embedding?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: "article" | "thought" | "insight";
          title?: string;
          summary?: string;
          tags?: string[];
          domain?: string;
          source_url?: string | null;
          source_type?: "url" | "text" | "thought" | null;
          raw_content?: string | null;
          embedding?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_connections: {
        Row: {
          id: string;
          from_id: string;
          to_id: string;
          connection_type: string;
          similarity_score: number | null;
          reason: string | null;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          from_id: string;
          to_id: string;
          connection_type?: string;
          similarity_score?: number | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          from_id?: string;
          to_id?: string;
          connection_type?: string;
          similarity_score?: number | null;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      think_sessions: {
        Row: {
          id: string;
          user_id: string | null;
          mode: "roundtable" | "coach" | "crossdomain" | "mirror";
          question: string;
          responses: Json[];
          insights: string[];
          knowledge_context: Json[];
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          mode: "roundtable" | "coach" | "crossdomain" | "mirror";
          question: string;
          responses?: Json[];
          insights?: string[];
          knowledge_context?: Json[];
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          mode?: "roundtable" | "coach" | "crossdomain" | "mirror";
          question?: string;
          responses?: Json[];
          insights?: string[];
          knowledge_context?: Json[];
          created_at?: string;
        };
        Relationships: [];
      };
      eval_traces: {
        Row: {
          id: string;
          user_id: string;
          entry_point: "feed" | "memory" | "think" | "save_insight" | "compile" | "lint";
          trace_status: "running" | "success" | "error" | "partial";
          source_type: string | null;
          mode: string | null;
          model_name: string | null;
          prompt_version: string | null;
          session_id: string | null;
          knowledge_item_id: string | null;
          request_payload: Json;
          response_payload: Json;
          metadata: Json;
          error_message: string | null;
          started_at: string;
          ended_at: string | null;
          latency_ms: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          entry_point: "feed" | "memory" | "think" | "save_insight" | "compile" | "lint";
          trace_status?: "running" | "success" | "error" | "partial";
          source_type?: string | null;
          mode?: string | null;
          model_name?: string | null;
          prompt_version?: string | null;
          session_id?: string | null;
          knowledge_item_id?: string | null;
          request_payload?: Json;
          response_payload?: Json;
          metadata?: Json;
          error_message?: string | null;
          started_at?: string;
          ended_at?: string | null;
          latency_ms?: number | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          entry_point?: "feed" | "memory" | "think" | "save_insight" | "compile" | "lint";
          trace_status?: "running" | "success" | "error" | "partial";
          source_type?: string | null;
          mode?: string | null;
          model_name?: string | null;
          prompt_version?: string | null;
          session_id?: string | null;
          knowledge_item_id?: string | null;
          request_payload?: Json;
          response_payload?: Json;
          metadata?: Json;
          error_message?: string | null;
          started_at?: string;
          ended_at?: string | null;
          latency_ms?: number | null;
        };
        Relationships: [];
      };
      eval_spans: {
        Row: {
          id: string;
          trace_id: string;
          user_id: string;
          span_name: string;
          span_status: "running" | "success" | "error" | "skipped";
          input_payload: Json;
          output_payload: Json;
          metadata: Json;
          error_message: string | null;
          started_at: string;
          ended_at: string | null;
          latency_ms: number | null;
        };
        Insert: {
          id?: string;
          trace_id: string;
          user_id: string;
          span_name: string;
          span_status?: "running" | "success" | "error" | "skipped";
          input_payload?: Json;
          output_payload?: Json;
          metadata?: Json;
          error_message?: string | null;
          started_at?: string;
          ended_at?: string | null;
          latency_ms?: number | null;
        };
        Update: {
          id?: string;
          trace_id?: string;
          user_id?: string;
          span_name?: string;
          span_status?: "running" | "success" | "error" | "skipped";
          input_payload?: Json;
          output_payload?: Json;
          metadata?: Json;
          error_message?: string | null;
          started_at?: string;
          ended_at?: string | null;
          latency_ms?: number | null;
        };
        Relationships: [];
      };
      eval_feedback: {
        Row: {
          id: string;
          user_id: string;
          trace_id: string | null;
          think_session_id: string | null;
          knowledge_item_id: string | null;
          feedback_type: "save" | "skip" | "thumb_up" | "thumb_down" | "edit";
          feedback_text: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          trace_id?: string | null;
          think_session_id?: string | null;
          knowledge_item_id?: string | null;
          feedback_type: "save" | "skip" | "thumb_up" | "thumb_down" | "edit";
          feedback_text?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          trace_id?: string | null;
          think_session_id?: string | null;
          knowledge_item_id?: string | null;
          feedback_type?: "save" | "skip" | "thumb_up" | "thumb_down" | "edit";
          feedback_text?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      eval_labels: {
        Row: {
          id: string;
          user_id: string;
          trace_id: string;
          dataset_name: string | null;
          reviewer: string | null;
          failure_code: string | null;
          pass_fail: boolean | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          trace_id: string;
          dataset_name?: string | null;
          reviewer?: string | null;
          failure_code?: string | null;
          pass_fail?: boolean | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          trace_id?: string;
          dataset_name?: string | null;
          reviewer?: string | null;
          failure_code?: string | null;
          pass_fail?: boolean | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      eval_results: {
        Row: {
          id: string;
          user_id: string;
          trace_id: string;
          evaluator_name: string;
          evaluator_type: "code" | "llm_judge" | "human";
          score: number | null;
          pass_fail: boolean | null;
          reason: string | null;
          metadata: Json;
          run_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          trace_id: string;
          evaluator_name: string;
          evaluator_type: "code" | "llm_judge" | "human";
          score?: number | null;
          pass_fail?: boolean | null;
          reason?: string | null;
          metadata?: Json;
          run_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          trace_id?: string;
          evaluator_name?: string;
          evaluator_type?: "code" | "llm_judge" | "human";
          score?: number | null;
          pass_fail?: boolean | null;
          reason?: string | null;
          metadata?: Json;
          run_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      knowledge_summaries: {
        Row: {
          id: string;
          user_id: string | null;
          domain: string;
          topic: string | null;
          compiled_content: string;
          source_ids: string[];
          last_compiled_at: string;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          domain: string;
          topic?: string | null;
          compiled_content: string;
          source_ids?: string[];
          last_compiled_at?: string;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          domain?: string;
          topic?: string | null;
          compiled_content?: string;
          source_ids?: string[];
          last_compiled_at?: string;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_knowledge: {
        Args: {
          query_embedding: string;
          match_threshold?: number;
          match_count?: number;
          filter_domain?: string | null;
        };
        Returns: {
          id: string;
          type: string;
          title: string;
          summary: string;
          tags: string[];
          domain: string;
          created_at: string;
          similarity: number;
        }[];
      };
      search_knowledge_lexical: {
        Args: {
          query_text: string;
          match_count?: number;
          filter_domain?: string | null;
        };
        Returns: {
          id: string;
          type: string;
          title: string;
          summary: string;
          tags: string[];
          domain: string;
          source_url: string | null;
          raw_content: string | null;
          created_at: string;
          lexical_score: number;
        }[];
      };
      get_cognitive_stats: {
        Args: Record<string, never>;
        Returns: CognitiveStats;
      };
    };
  };
}

/** 认知统计返回类型 */
export interface CognitiveStats {
  totalKnowledge: number;
  totalThoughts: number;
  totalConnections: number;
  flywheelTurns: number;
  domains: { name: string; count: number }[];
  recentGrowth: { date: string; items: number }[];
}
