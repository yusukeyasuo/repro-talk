'use client';

import { ANNOTATION_META, type Annotation, type AnnotationType } from '@/types/annotation';
import { splitSentences } from '@/lib/transcript';

type Segment = {
  start: number;
  end: number;
  text: string;
  types: AnnotationType[];
  /** reduction の実際の音（あれば） */
  surface?: string;
};

/** 注釈の境界でテキストを分割し、各断片にかかっている注釈の種類を求める。 */
function buildSegments(
  text: string,
  from: number,
  to: number,
  annotations: Annotation[],
): Segment[] {
  const relevant = annotations.filter((a) => a.start < to && a.end > from);
  const cuts = new Set<number>([from, to]);
  for (const a of relevant) {
    if (a.start > from && a.start < to) cuts.add(a.start);
    if (a.end > from && a.end < to) cuts.add(a.end);
  }

  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const covering = relevant.filter((a) => a.start <= start && a.end >= end);
    segments.push({
      start,
      end,
      text: text.slice(start, end),
      types: covering.map((a) => a.type),
      surface: covering.find((a) => a.type === 'reduction')?.surface,
    });
  }

  return segments;
}

function styleFor(types: AnnotationType[]): React.CSSProperties {
  const style: React.CSSProperties = { position: 'relative' };
  const decorations: string[] = [];

  if (types.includes('stress')) {
    style.color = ANNOTATION_META.stress.color;
    style.fontWeight = 700;
  }
  if (types.includes('reduction')) {
    style.color = ANNOTATION_META.reduction.color;
  }
  if (types.includes('drop')) {
    style.color = ANNOTATION_META.drop.color;
    style.opacity = 0.55;
    decorations.push(`line-through ${ANNOTATION_META.drop.color}`);
  }
  if (types.includes('link')) {
    style.borderBottom = `2px solid ${ANNOTATION_META.link.color}`;
    style.borderBottomLeftRadius = '6px';
    style.borderBottomRightRadius = '6px';
  }
  if (types.includes('swallow')) {
    decorations.push(`underline dotted ${ANNOTATION_META.swallow.color} 2px`);
  }
  if (types.includes('flap_t')) {
    style.outline = `1.5px solid ${ANNOTATION_META.flap_t.color}`;
    style.borderRadius = '9999px';
    style.padding = '0 3px';
  }
  if (decorations.length > 0) {
    style.textDecoration = decorations.join(' ');
  }
  return style;
}

type Props = {
  text: string;
  annotations: Annotation[];
  /** 選択で注釈を付けられるようにする（ワークスペースの編集モード） */
  editable?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
};

/**
 * 紙に書き出してカラーペンで記号を書き込む作業の代替。
 * 各セグメントに data-start を持たせ、選択範囲から文字インデックスを復元できるようにする。
 */
export function AnnotatedText({ text, annotations, editable = false, rootRef }: Props) {
  const sentences = splitSentences(text);
  const lines = sentences.length > 0 ? sentences : [{ text, start: 0, end: text.length }];

  return (
    <div
      ref={rootRef}
      data-annotated-root=""
      className="space-y-6 font-mono text-lg leading-[2.6] tracking-wide select-text"
      style={{ cursor: editable ? 'text' : undefined }}
    >
      {lines.map((line) => {
        const segments = buildSegments(text, line.start, line.end, annotations);
        return (
          <p key={line.start} className="whitespace-pre-wrap break-words">
            {segments.map((segment) => (
              <span
                key={segment.start}
                data-start={segment.start}
                style={styleFor(segment.types)}
              >
                {segment.text}
                {segment.types.includes('stress') && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: '-0.85em',
                      textAlign: 'center',
                      fontSize: '0.7em',
                      lineHeight: 1,
                      color: ANNOTATION_META.stress.color,
                      // 選択範囲の復元がずれないよう装飾は選択対象から外す
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                  >
                    ⌃
                  </span>
                )}
                {segment.types.includes('rise') && (
                  <span
                    aria-hidden
                    style={{
                      fontSize: '0.7em',
                      verticalAlign: 'super',
                      color: ANNOTATION_META.rise.color,
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                  >
                    ↗
                  </span>
                )}
                {segment.surface && (
                  <span
                    aria-hidden
                    style={{
                      fontSize: '0.65em',
                      verticalAlign: 'super',
                      marginLeft: '2px',
                      color: ANNOTATION_META.reduction.color,
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                  >
                    {segment.surface}
                  </span>
                )}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function AnnotationLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {Object.entries(ANNOTATION_META).map(([type, meta]) => (
        <li key={type} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: meta.color }}
          />
          {meta.label}
        </li>
      ))}
    </ul>
  );
}
