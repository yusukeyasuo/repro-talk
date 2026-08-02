import type { Annotation } from './annotation';

export type MaterialLevel = 1 | 2 | 3 | 4;
export type RecordingKind = 'reproduction' | 'monologue';
export type MonologueMode = 'phone' | 'free';

/** AI が返す「言えなかったこと」への英語表現候補 */
export type AiSuggestion = {
  text: string;
  meaning_ja: string;
  examples: string[];
};

type Timestamps = { created_at: string };

export type Profile = {
  id: string;
  display_name: string | null;
  why_text: string | null;
  daily_goal_sec: number;
  created_at: string;
  updated_at: string;
};

export type Material = {
  id: string;
  user_id: string;
  youtube_video_id: string;
  title: string;
  channel_name: string | null;
  level: MaterialLevel;
  thumbnail_url: string | null;
} & Timestamps;

export type Clip = {
  id: string;
  user_id: string;
  material_id: string;
  label: string | null;
  start_sec: number;
  end_sec: number;
  transcript: string;
  translation_ja: string | null;
  annotations: Annotation[];
  memo: string | null;
  created_at: string;
  updated_at: string;
};

export type PracticeLog = {
  id: string;
  user_id: string;
  clip_id: string;
  rep_count: number;
  practiced_at: string;
};

export type MonologueTopic = {
  id: string;
  user_id: string | null;
  title_en: string;
  title_ja: string;
  category: string | null;
  sort_order: number;
} & Timestamps;

export type MonologueSession = {
  id: string;
  user_id: string;
  topic_id: string | null;
  mode: MonologueMode;
  duration_sec: number;
  ja_memo: string | null;
  ai_suggestions: AiSuggestion[] | null;
  used_phrase_ids: string[];
  started_at: string;
};

export type Recording = {
  id: string;
  user_id: string;
  kind: RecordingKind;
  clip_id: string | null;
  monologue_session_id: string | null;
  storage_path: string;
  mime_type: string;
  duration_sec: number;
} & Timestamps;

export type Phrase = {
  id: string;
  user_id: string;
  clip_id: string | null;
  text: string;
  meaning_ja: string | null;
  used_count: number;
  last_used_at: string | null;
} & Timestamps;

export type DailyActivity = {
  user_id: string;
  activity_date: string;
  reproduction_reps: number;
  monologue_sec: number;
  recording_sec: number;
};

/** Insert 時に省略できる列 */
type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type Table<Row, InsertOptionalKeys extends keyof Row> = {
  Row: Row;
  Insert: Optional<Row, InsertOptionalKeys>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, 'display_name' | 'why_text' | 'daily_goal_sec' | 'created_at' | 'updated_at'>;
      materials: Table<Material, 'id' | 'channel_name' | 'level' | 'thumbnail_url' | 'created_at'>;
      clips: Table<
        Clip,
        | 'id'
        | 'label'
        | 'transcript'
        | 'translation_ja'
        | 'annotations'
        | 'memo'
        | 'created_at'
        | 'updated_at'
      >;
      practice_logs: Table<PracticeLog, 'id' | 'rep_count' | 'practiced_at'>;
      monologue_topics: Table<MonologueTopic, 'id' | 'category' | 'sort_order' | 'created_at'>;
      monologue_sessions: Table<
        MonologueSession,
        | 'id'
        | 'topic_id'
        | 'mode'
        | 'duration_sec'
        | 'ja_memo'
        | 'ai_suggestions'
        | 'used_phrase_ids'
        | 'started_at'
      >;
      recordings: Table<
        Recording,
        'id' | 'clip_id' | 'monologue_session_id' | 'mime_type' | 'duration_sec' | 'created_at'
      >;
      phrases: Table<
        Phrase,
        'id' | 'clip_id' | 'meaning_ja' | 'used_count' | 'last_used_at' | 'created_at'
      >;
    };
    Views: {
      daily_activity: {
        Row: DailyActivity;
        Relationships: [];
      };
    };
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

export const MATERIAL_LEVELS: {
  level: MaterialLevel;
  label: string;
  hint: string;
}[] = [
  {
    level: 1,
    label: 'Lv1 和訳付きフレーズ動画',
    hint: '日本語字幕つき・ゆっくり。まずは音と意味を体に入れる。',
  },
  {
    level: 2,
    label: 'Lv2 英語学習者向けチャンネル',
    hint: '英語字幕のみ。学習者向けに構成されていて難易度と効果のバランスが良い。',
  },
  {
    level: 3,
    label: 'Lv3 興味分野の海外チャンネル',
    hint: '好きなテーマを英語で検索。ロールモデルを見つけたら勝ち。',
  },
  {
    level: 4,
    label: 'Lv4 海外ドラマ・映画',
    hint: '作り物なので日常会話より速く語彙も難しい。最後に来る段階。',
  },
];
