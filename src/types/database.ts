import type { Annotation } from './annotation';

export type MaterialLevel = 1 | 2 | 3 | 4;
export type RecordingKind = 'reproduction' | 'monologue';
export type MonologueMode = 'phone' | 'free';
/** 学習時間を計測する3本の導線。瞬間英作文も1本として数える。 */
export type StudyKind = 'reproduction' | 'monologue' | 'composition';

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

export type ClipSource = 'youtube' | 'text';

export type Clip = {
  id: string;
  user_id: string;
  /** source='text' のときは動画を持たないので NULL */
  material_id: string | null;
  label: string | null;
  /** source='text' のときは区間を持たないので NULL */
  start_sec: number | null;
  end_sec: number | null;
  transcript: string;
  translation_ja: string | null;
  annotations: Annotation[];
  memo: string | null;
  /** 'youtube' = 動画クリップ / 'text' = 自作テキスト */
  source: ClipSource;
  /** AI推敲前の原文（source='text' で推敲を採用したときのみ。それ以外は NULL） */
  source_text: string | null;
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
  /** 初回使用で「身についた」に卒業した時刻。NULL なら在庫（今日使うフレーズに出る）。 */
  graduated_at: string | null;
} & Timestamps;

/** 瞬間英作文のコース（例文の束） */
export type CompositionCourse = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

/** 例文1件（日本語→英語）。course_id 内の sort_order 昇順が登録順。 */
export type Composition = {
  id: string;
  user_id: string;
  course_id: string;
  ja: string;
  en: string;
  sort_order: number;
  /** 「★＝まだ言えない・重点的に練習したい」印。プレイヤーの「★のみ」対象に使う。 */
  starred: boolean;
  created_at: string;
  updated_at: string;
};

/** 読み上げ回数の記録（practice_logs と同型）。course は消えても履歴は残る。 */
export type CompositionLog = {
  id: string;
  user_id: string;
  course_id: string | null;
  rep_count: number;
  practiced_at: string;
};

/**
 * 学習時間の計測1回分。ended_at が NULL なら計測中（1ユーザーに同時1本）。
 * duration_sec は started_at / ended_at からの生成列なので書き込まない。
 */
export type StudySession = {
  id: string;
  user_id: string;
  kind: StudyKind;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  /** 押し忘れをアプリが締めた行。本人が直すまで「終了し忘れ」として出す。 */
  auto_closed: boolean;
  adjusted_at: string | null;
} & Timestamps;

export type DailyActivity = {
  user_id: string;
  activity_date: string;
  reproduction_reps: number;
  monologue_sec: number;
  recording_sec: number;
  composition_reps: number;
  /** 学習していた時間。monologue_sec（声を出していた時間）と重なるので足し合わせない。 */
  study_sec: number;
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
        | 'source'
        | 'source_text'
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
        'id' | 'clip_id' | 'meaning_ja' | 'used_count' | 'last_used_at' | 'graduated_at' | 'created_at'
      >;
      composition_courses: Table<
        CompositionCourse,
        'id' | 'description' | 'created_at' | 'updated_at'
      >;
      compositions: Table<Composition, 'id' | 'sort_order' | 'starred' | 'created_at' | 'updated_at'>;
      composition_logs: Table<CompositionLog, 'id' | 'course_id' | 'rep_count' | 'practiced_at'>;
      // duration_sec は生成列。Insert / Update に含めると Postgres が拒否するので渡さない。
      study_sessions: Table<
        StudySession,
        | 'id'
        | 'started_at'
        | 'ended_at'
        | 'duration_sec'
        | 'auto_closed'
        | 'adjusted_at'
        | 'created_at'
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
