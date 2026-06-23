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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      access_limits: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          revoked_at: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          revoked_at?: string | null
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          revoked_at?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      _backup_phase2_platform_settings: {
        Row: {
          id: string | null
          key: string | null
          updated_at: string | null
          updated_by: string | null
          value: Json | null
        }
        Insert: {
          id?: string | null
          key?: string | null
          updated_at?: string | null
          updated_by?: string | null
          value?: Json | null
        }
        Update: {
          id?: string | null
          key?: string | null
          updated_at?: string | null
          updated_by?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      _backup_phase2_tenant_memberships: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          full_name: string | null
          id: string | null
          is_default: boolean | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          show_in_community: boolean | null
          show_phone_call: boolean | null
          show_whatsapp: boolean | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          is_default?: boolean | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          show_in_community?: boolean | null
          show_phone_call?: boolean | null
          show_whatsapp?: boolean | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          is_default?: boolean | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          show_in_community?: boolean | null
          show_phone_call?: boolean | null
          show_whatsapp?: boolean | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_phase2_tenant_settings: {
        Row: {
          accent_color: string | null
          accent_color_dark: string | null
          ai_assistant_avatar_url: string | null
          ai_assistant_name: string | null
          ai_assistant_system_prompt: string | null
          api_key: string | null
          api_key_created_at: string | null
          background_color: string | null
          background_color_dark: string | null
          created_at: string | null
          custom_css: string | null
          foreground_color: string | null
          foreground_color_dark: string | null
          id: string | null
          logo_url: string | null
          primary_color: string | null
          primary_color_dark: string | null
          secondary_color: string | null
          secondary_color_dark: string | null
          tenant_id: string | null
          updated_at: string | null
          vimeo_access_token: string | null
          webhook_enabled: boolean | null
          webhook_url: string | null
        }
        Insert: {
          accent_color?: string | null
          accent_color_dark?: string | null
          ai_assistant_avatar_url?: string | null
          ai_assistant_name?: string | null
          ai_assistant_system_prompt?: string | null
          api_key?: string | null
          api_key_created_at?: string | null
          background_color?: string | null
          background_color_dark?: string | null
          created_at?: string | null
          custom_css?: string | null
          foreground_color?: string | null
          foreground_color_dark?: string | null
          id?: string | null
          logo_url?: string | null
          primary_color?: string | null
          primary_color_dark?: string | null
          secondary_color?: string | null
          secondary_color_dark?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vimeo_access_token?: string | null
          webhook_enabled?: boolean | null
          webhook_url?: string | null
        }
        Update: {
          accent_color?: string | null
          accent_color_dark?: string | null
          ai_assistant_avatar_url?: string | null
          ai_assistant_name?: string | null
          ai_assistant_system_prompt?: string | null
          api_key?: string | null
          api_key_created_at?: string | null
          background_color?: string | null
          background_color_dark?: string | null
          created_at?: string | null
          custom_css?: string | null
          foreground_color?: string | null
          foreground_color_dark?: string | null
          id?: string | null
          logo_url?: string | null
          primary_color?: string | null
          primary_color_dark?: string | null
          secondary_color?: string | null
          secondary_color_dark?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vimeo_access_token?: string | null
          webhook_enabled?: boolean | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      _backup_phase2_tenants: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          logo_url: string | null
          name: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          logo_url?: string | null
          name?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          logo_url?: string | null
          name?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_phase2c_platform_settings: {
        Row: {
          id: string | null
          key: string | null
          updated_at: string | null
          updated_by: string | null
          value: Json | null
        }
        Insert: {
          id?: string | null
          key?: string | null
          updated_at?: string | null
          updated_by?: string | null
          value?: Json | null
        }
        Update: {
          id?: string | null
          key?: string | null
          updated_at?: string | null
          updated_by?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      _backup_phase2c_tenant_memberships: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          full_name: string | null
          id: string | null
          is_default: boolean | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          show_in_community: boolean | null
          show_phone_call: boolean | null
          show_whatsapp: boolean | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          is_default?: boolean | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          show_in_community?: boolean | null
          show_phone_call?: boolean | null
          show_whatsapp?: boolean | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          is_default?: boolean | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          show_in_community?: boolean | null
          show_phone_call?: boolean | null
          show_whatsapp?: boolean | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      announcements: {
        Row: {
          author_id: string | null
          content: string
          created_at: string
          id: string
          is_pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          content: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          content?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_request_logs: {
        Row: {
          action: string
          api_key_hash: string
          created_at: string
          error_message: string | null
          id: string
          ip_address: string | null
          request_data: Json | null
          response_time_ms: number | null
          status_code: number
          user_agent: string | null
        }
        Insert: {
          action: string
          api_key_hash: string
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          request_data?: Json | null
          response_time_ms?: number | null
          status_code: number
          user_agent?: string | null
        }
        Update: {
          action?: string
          api_key_hash?: string
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: string | null
          request_data?: Json | null
          response_time_ms?: number | null
          status_code?: number
          user_agent?: string | null
        }
        Relationships: []
      }
      auth_audit_log: {
        Row: {
          action: string
          actor_id: string
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          ip: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          ip?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          ip?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      benefit_categories: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          label_en: string
          label_he: string
          order_index: number
          value: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label_en: string
          label_he: string
          order_index?: number
          value: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label_en?: string
          label_he?: string
          order_index?: number
          value?: string
        }
        Relationships: []
      }
      benefit_clicks: {
        Row: {
          benefit_id: string
          click_type: string
          created_at: string
          id: string
          user_id: string | null
        }
        Insert: {
          benefit_id: string
          click_type: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          benefit_id?: string
          click_type?: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "benefit_clicks_benefit_id_fkey"
            columns: ["benefit_id"]
            isOneToOne: false
            referencedRelation: "community_benefits"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          sources: Json | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          sources?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          sources?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      community_benefits: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          is_active: boolean
          link_url: string | null
          logo_url: string | null
          phone_number: string | null
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          is_active?: boolean
          link_url?: string | null
          logo_url?: string | null
          phone_number?: string | null
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_active?: boolean
          link_url?: string | null
          logo_url?: string | null
          phone_number?: string | null
          title?: string
        }
        Relationships: []
      }
      course_instructors: {
        Row: {
          course_id: string
          created_at: string
          id: string
          instructor_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          instructor_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          instructor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_instructors_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_instructors_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          description: string | null
          id: string
          instructor_id: string | null
          is_published: boolean
          order_index: number | null
          payment_url: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          instructor_id?: string | null
          is_published?: boolean
          order_index?: number | null
          payment_url?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          instructor_id?: string | null
          is_published?: boolean
          order_index?: number | null
          payment_url?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      csp_violations: {
        Row: {
          blocked_uri: string | null
          column_number: number | null
          created_at: string
          directive: string | null
          disposition: string | null
          document_uri: string | null
          id: number
          ip_address: string | null
          line_number: number | null
          referrer: string | null
          script_sample: string | null
          source_file: string | null
          user_agent: string | null
        }
        Insert: {
          blocked_uri?: string | null
          column_number?: number | null
          created_at?: string
          directive?: string | null
          disposition?: string | null
          document_uri?: string | null
          id?: number
          ip_address?: string | null
          line_number?: number | null
          referrer?: string | null
          script_sample?: string | null
          source_file?: string | null
          user_agent?: string | null
        }
        Update: {
          blocked_uri?: string | null
          column_number?: number | null
          created_at?: string
          directive?: string | null
          disposition?: string | null
          document_uri?: string | null
          id?: number
          ip_address?: string | null
          line_number?: number | null
          referrer?: string | null
          script_sample?: string | null
          source_file?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      developer_settings: {
        Row: {
          api_key: string
          api_key_created_at: string | null
          created_at: string
          id: string
          rate_limit_enabled: boolean | null
          rate_limit_per_minute: number | null
          updated_at: string
          updated_by: string | null
          webhook_enabled: boolean | null
          webhook_signing_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          api_key?: string
          api_key_created_at?: string | null
          created_at?: string
          id?: string
          rate_limit_enabled?: boolean | null
          rate_limit_per_minute?: number | null
          updated_at?: string
          updated_by?: string | null
          webhook_enabled?: boolean | null
          webhook_signing_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          api_key?: string
          api_key_created_at?: string | null
          created_at?: string
          id?: string
          rate_limit_enabled?: boolean | null
          rate_limit_per_minute?: number | null
          updated_at?: string
          updated_by?: string | null
          webhook_enabled?: boolean | null
          webhook_signing_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          course_id: string
          enrolled_at: string
          id: string
          progress_percentage: number
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          progress_percentage?: number
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
          progress_percentage?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_time: string
          google_event_id: string | null
          id: string
          location: string | null
          meeting_url: string | null
          start_time: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time: string
          google_event_id?: string | null
          id?: string
          location?: string | null
          meeting_url?: string | null
          start_time: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time?: string
          google_event_id?: string | null
          id?: string
          location?: string | null
          meeting_url?: string | null
          start_time?: string
          title?: string
        }
        Relationships: []
      }
      exam_attempts: {
        Row: {
          answers: Json
          completed_at: string | null
          exam_id: string
          id: string
          passed: boolean | null
          score: number | null
          started_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          completed_at?: string | null
          exam_id: string
          id?: string
          passed?: boolean | null
          score?: number | null
          started_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          completed_at?: string | null
          exam_id?: string
          id?: string
          passed?: boolean | null
          score?: number | null
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          correct_options: Json
          created_at: string
          exam_id: string
          explanation: string | null
          id: string
          image_url: string | null
          options: Json
          order_index: number
          points: number
          question_text: string
          question_type: string
        }
        Insert: {
          correct_options?: Json
          created_at?: string
          exam_id: string
          explanation?: string | null
          id?: string
          image_url?: string | null
          options?: Json
          order_index?: number
          points?: number
          question_text: string
          question_type?: string
        }
        Update: {
          correct_options?: Json
          created_at?: string
          exam_id?: string
          explanation?: string | null
          id?: string
          image_url?: string | null
          options?: Json
          order_index?: number
          points?: number
          question_text?: string
          question_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          id: string
          is_published: boolean
          order_index: number
          passing_score: number
          time_limit_minutes: number | null
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_published?: boolean
          order_index?: number
          passing_score?: number
          time_limit_minutes?: number | null
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_published?: boolean
          order_index?: number
          passing_score?: number
          time_limit_minutes?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      failed_login_attempts: {
        Row: {
          attempted_at: string
          email: string
          id: number
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: number
          ip?: string | null
          user_agent?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: number
          ip?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      learning_paths: {
        Row: {
          created_at: string
          current_step: number
          generated_by: string
          goal: string
          id: string
          steps: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_step?: number
          generated_by?: string
          goal: string
          id?: string
          steps?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_step?: number
          generated_by?: string
          goal?: string
          id?: string
          steps?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lesson_bookmarks: {
        Row: {
          bookmark_type: string
          created_at: string | null
          id: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          bookmark_type: string
          created_at?: string | null
          id?: string
          lesson_id: string
          user_id: string
        }
        Update: {
          bookmark_type?: string
          created_at?: string | null
          id?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_bookmarks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          course_id: string
          created_at: string
          id: string
          lesson_id: string
          metadata: Json
          module_id: string
          source_type: string
        }
        Insert: {
          chunk_index?: number
          chunk_text: string
          course_id: string
          created_at?: string
          id?: string
          lesson_id: string
          metadata?: Json
          module_id: string
          source_type?: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          course_id?: string
          created_at?: string
          id?: string
          lesson_id?: string
          metadata?: Json
          module_id?: string
          source_type?: string
        }
        Relationships: []
      }
      lesson_completions: {
        Row: {
          completed_at: string
          id: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          lesson_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_completions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          content_text: string | null
          created_at: string
          duration_minutes: number | null
          embed_url: string | null
          exam_id: string | null
          file_url: string | null
          id: string
          is_hidden: boolean
          lesson_type: string
          module_id: string
          order_index: number
          resources_url: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          content_text?: string | null
          created_at?: string
          duration_minutes?: number | null
          embed_url?: string | null
          exam_id?: string | null
          file_url?: string | null
          id?: string
          is_hidden?: boolean
          lesson_type?: string
          module_id: string
          order_index?: number
          resources_url?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          content_text?: string | null
          created_at?: string
          duration_minutes?: number | null
          embed_url?: string | null
          exam_id?: string | null
          file_url?: string | null
          id?: string
          is_hidden?: boolean
          lesson_type?: string
          module_id?: string
          order_index?: number
          resources_url?: string | null
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          id: string
          order_index: number
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          id?: string
          order_index?: number
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          id?: string
          order_index?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      personality_assessments: {
        Row: {
          answers: Json
          created_at: string
          disc_primary: string | null
          disc_scores: Json
          disc_secondary: string | null
          emyth_scores: Json
          id: string
          insights: Json
          model: string | null
          raw_ai_response: Json | null
          scoring_version: string
          user_id: string
          version: number
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          answers?: Json
          created_at?: string
          disc_primary?: string | null
          disc_scores?: Json
          disc_secondary?: string | null
          emyth_scores?: Json
          id?: string
          insights?: Json
          model?: string | null
          raw_ai_response?: Json | null
          scoring_version?: string
          user_id: string
          version?: number
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          answers?: Json
          created_at?: string
          disc_primary?: string | null
          disc_scores?: Json
          disc_secondary?: string | null
          emyth_scores?: Json
          id?: string
          insights?: Json
          model?: string | null
          raw_ai_response?: Json | null
          scoring_version?: string
          user_id?: string
          version?: number
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          deleted_at: string | null
          email: string
          full_name: string
          id: string
          join_date: string
          phone: string | null
          show_in_community: boolean | null
          show_phone_call: boolean | null
          show_whatsapp: boolean | null
          social_links: Json | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          full_name: string
          id: string
          join_date?: string
          phone?: string | null
          show_in_community?: boolean | null
          show_phone_call?: boolean | null
          show_whatsapp?: boolean | null
          social_links?: Json | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          full_name?: string
          id?: string
          join_date?: string
          phone?: string | null
          show_in_community?: boolean | null
          show_phone_call?: boolean | null
          show_whatsapp?: boolean | null
          social_links?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      room_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          room_id: string
          user_id: string
          user_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          room_id: string
          user_id: string
          user_name: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          room_id?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_participants: {
        Row: {
          id: string
          is_muted: boolean
          is_screen_sharing: boolean
          is_video_on: boolean
          joined_at: string
          last_seen_at: string
          room_id: string
          user_id: string
          user_name: string
        }
        Insert: {
          id?: string
          is_muted?: boolean
          is_screen_sharing?: boolean
          is_video_on?: boolean
          joined_at?: string
          last_seen_at?: string
          room_id: string
          user_id: string
          user_name: string
        }
        Update: {
          id?: string
          is_muted?: boolean
          is_screen_sharing?: boolean
          is_video_on?: boolean
          joined_at?: string
          last_seen_at?: string
          room_id?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          category: string
          created_at: string
          description: string | null
          host_id: string | null
          host_name: string
          id: string
          is_live: boolean
          is_locked: boolean
          is_recording: boolean
          max_participants: number
          name: string
          recording_url: string | null
          shared_video_state: Json | null
          shared_video_url: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          host_id?: string | null
          host_name: string
          id?: string
          is_live?: boolean
          is_locked?: boolean
          is_recording?: boolean
          max_participants?: number
          name: string
          recording_url?: string | null
          shared_video_state?: Json | null
          shared_video_url?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          host_id?: string | null
          host_name?: string
          id?: string
          is_live?: boolean
          is_locked?: boolean
          is_recording?: boolean
          max_participants?: number
          name?: string
          recording_url?: string | null
          shared_video_state?: Json | null
          shared_video_url?: string | null
        }
        Relationships: []
      }
      skill_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          notes: string | null
          skill_id: string | null
          version_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          skill_id?: string | null
          version_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          skill_id?: string | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skill_audit_log_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_audit_log_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "skill_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_downloads: {
        Row: {
          created_at: string | null
          id: string
          skill_id: string
          user_id: string
          version_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          skill_id: string
          user_id: string
          version_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          skill_id?: string
          user_id?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skill_downloads_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_downloads_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "skill_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_ratings: {
        Row: {
          created_at: string | null
          id: string
          rating: number
          review_text: string | null
          skill_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          rating: number
          review_text?: string | null
          skill_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          rating?: number
          review_text?: string | null
          skill_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_ratings_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_versions: {
        Row: {
          content_preview: string | null
          created_at: string | null
          file_hash: string
          file_path: string
          id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scan_completed_at: string | null
          scan_result: Json | null
          skill_id: string
          status: string
          submitted_by: string
          version: number
        }
        Insert: {
          content_preview?: string | null
          created_at?: string | null
          file_hash: string
          file_path: string
          id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_completed_at?: string | null
          scan_result?: Json | null
          skill_id: string
          status?: string
          submitted_by: string
          version?: number
        }
        Update: {
          content_preview?: string | null
          created_at?: string | null
          file_hash?: string
          file_path?: string
          id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_completed_at?: string | null
          scan_result?: Json | null
          skill_id?: string
          status?: string
          submitted_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "skill_versions_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          author_id: string | null
          avg_rating: number | null
          category: string
          created_at: string | null
          current_version_id: string | null
          description: string | null
          download_count: number | null
          icon_name: string | null
          id: string
          is_featured: boolean | null
          long_description: string | null
          name: string
          rating_count: number | null
          status: string
          tags: string[] | null
          trigger_pattern: string | null
          updated_at: string | null
        }
        Insert: {
          author_id?: string | null
          avg_rating?: number | null
          category?: string
          created_at?: string | null
          current_version_id?: string | null
          description?: string | null
          download_count?: number | null
          icon_name?: string | null
          id?: string
          is_featured?: boolean | null
          long_description?: string | null
          name: string
          rating_count?: number | null
          status?: string
          tags?: string[] | null
          trigger_pattern?: string | null
          updated_at?: string | null
        }
        Update: {
          author_id?: string | null
          avg_rating?: number | null
          category?: string
          created_at?: string | null
          current_version_id?: string | null
          description?: string | null
          download_count?: number | null
          icon_name?: string | null
          id?: string
          is_featured?: boolean | null
          long_description?: string | null
          name?: string
          rating_count?: number | null
          status?: string
          tags?: string[] | null
          trigger_pattern?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_skills_current_version"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "skill_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      study_rooms: {
        Row: {
          created_at: string
          description: string | null
          host_id: string
          id: string
          is_active: boolean
          is_invite_only: boolean
          max_participants: number | null
          room_name: string
          room_url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          host_id: string
          id?: string
          is_active?: boolean
          is_invite_only?: boolean
          max_participants?: number | null
          room_name: string
          room_url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          host_id?: string
          id?: string
          is_active?: boolean
          is_invite_only?: boolean
          max_participants?: number | null
          room_name?: string
          room_url?: string
        }
        Relationships: []
      }
      tenant_settings: {
        Row: {
          accent_color: string | null
          accent_color_dark: string | null
          ai_assistant_avatar_url: string | null
          ai_assistant_name: string | null
          ai_assistant_system_prompt: string | null
          api_key: string | null
          api_key_created_at: string | null
          background_color: string | null
          background_color_dark: string | null
          created_at: string
          custom_css: string | null
          foreground_color: string | null
          foreground_color_dark: string | null
          id: string
          logo_url: string | null
          primary_color: string | null
          primary_color_dark: string | null
          secondary_color: string | null
          secondary_color_dark: string | null
          updated_at: string
          vimeo_access_token: string | null
          webhook_enabled: boolean | null
          webhook_url: string | null
        }
        Insert: {
          accent_color?: string | null
          accent_color_dark?: string | null
          ai_assistant_avatar_url?: string | null
          ai_assistant_name?: string | null
          ai_assistant_system_prompt?: string | null
          api_key?: string | null
          api_key_created_at?: string | null
          background_color?: string | null
          background_color_dark?: string | null
          created_at?: string
          custom_css?: string | null
          foreground_color?: string | null
          foreground_color_dark?: string | null
          id?: string
          logo_url?: string | null
          primary_color?: string | null
          primary_color_dark?: string | null
          secondary_color?: string | null
          secondary_color_dark?: string | null
          updated_at?: string
          vimeo_access_token?: string | null
          webhook_enabled?: boolean | null
          webhook_url?: string | null
        }
        Update: {
          accent_color?: string | null
          accent_color_dark?: string | null
          ai_assistant_avatar_url?: string | null
          ai_assistant_name?: string | null
          ai_assistant_system_prompt?: string | null
          api_key?: string | null
          api_key_created_at?: string | null
          background_color?: string | null
          background_color_dark?: string | null
          created_at?: string
          custom_css?: string | null
          foreground_color?: string | null
          foreground_color_dark?: string | null
          id?: string
          logo_url?: string | null
          primary_color?: string | null
          primary_color_dark?: string | null
          secondary_color?: string | null
          secondary_color_dark?: string | null
          updated_at?: string
          vimeo_access_token?: string | null
          webhook_enabled?: boolean | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      user_activities: {
        Row: {
          action: string | null
          activity_type: string
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          new_values: Json | null
          old_values: Json | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action?: string | null
          activity_type: string
          created_at?: string
          description: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string | null
          activity_type?: string
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_notes: {
        Row: {
          created_at: string
          id: string
          lesson_id: string
          note_text: string
          updated_at: string
          user_id: string
          video_timestamp: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id: string
          note_text: string
          updated_at?: string
          user_id: string
          video_timestamp?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string
          note_text?: string
          updated_at?: string
          user_id?: string
          video_timestamp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_notes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webrtc_signals: {
        Row: {
          created_at: string
          from_user: string
          id: string
          room_id: string
          signal_data: Json
          signal_type: string
          to_user: string
        }
        Insert: {
          created_at?: string
          from_user: string
          id?: string
          room_id: string
          signal_data: Json
          signal_type: string
          to_user: string
        }
        Update: {
          created_at?: string
          from_user?: string
          id?: string
          room_id?: string
          signal_data?: Json
          signal_type?: string
          to_user?: string
        }
        Relationships: [
          {
            foreignKeyName: "webrtc_signals_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      kg_sync_recent_failures: {
        Row: {
          content: string | null
          content_type: string | null
          created: string | null
          id: number | null
          status_code: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_and_increment_rate_limit: {
        Args: { p_key: string; p_limit_per_minute: number }
        Returns: boolean
      }
      cleanup_old_api_logs: { Args: never; Returns: undefined }
      cleanup_old_webrtc_signals: { Args: never; Returns: number }
      cleanup_stale_participants: { Args: never; Returns: number }
      get_tenant_branding: {
        Args: { _tenant_id: string }
        Returns: {
          accent_color: string
          accent_color_dark: string
          ai_assistant_avatar_url: string
          ai_assistant_name: string
          ai_assistant_system_prompt: string
          api_key: string
          background_color: string
          background_color_dark: string
          custom_css: string
          foreground_color: string
          foreground_color_dark: string
          id: string
          logo_url: string
          primary_color: string
          primary_color_dark: string
          secondary_color: string
          secondary_color_dark: string
          tenant_id: string
          webhook_enabled: boolean
          webhook_url: string
        }[]
      }
      has_completed_exam: {
        Args: { _exam_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_in_tenant: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_instructor: { Args: { _user_id: string }; Returns: boolean }
      is_course_instructor: {
        Args: { _course_id: string; _user_id: string }
        Returns: boolean
      }
      is_login_locked: { Args: { p_email: string }; Returns: boolean }
      is_public_setting: { Args: { setting_key: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      log_user_activity: {
        Args: {
          p_action?: string
          p_activity_type: string
          p_description: string
          p_entity_id?: string
          p_entity_type?: string
          p_metadata?: Json
          p_new_values?: Json
          p_old_values?: Json
          p_user_id: string
        }
        Returns: string
      }
      record_failed_login: {
        Args: { p_email: string; p_ip: string }
        Returns: undefined
      }
      strip_html_tags: { Args: { input: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "instructor" | "student" | "super_admin" | "lead"
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
      app_role: ["admin", "instructor", "student", "super_admin", "lead"],
    },
  },
} as const
