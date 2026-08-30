'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnnotatedText, AnnotationLegend } from '@/components/annotation/annotated-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ANNOTATION_META,
  ANNOTATION_TYPES,
  type Annotation,
  type AnnotationType,
} from '@/types/annotation';

/** 選択位置から transcript の文字インデックスを復元する。 */
function resolveOffset(node: Node, offset: number, root: HTMLElement): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const segment = node.parentElement?.closest<HTMLElement>('[data-start]');
    if (!segment || !root.contains(segment)) return null;
    return Number(segment.dataset.start) + offset;
  }

  const element = node instanceof Element ? node.closest<HTMLElement>('[data-start]') : null;
  if (element && root.contains(element)) {
    const length = (element.firstChild?.textContent ?? '').length;
    return Number(element.dataset.start) + (offset === 0 ? 0 : length);
  }
  return null;
}

type Selected = { start: number; end: number; text: string };

type Props = {
  text: string;
  annotations: Annotation[];
  onChange: (next: Annotation[]) => void;
};

export function AnnotationEditor({ text, annotations, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  const readSelection = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelected(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setSelected(null);
      return;
    }

    const a = resolveOffset(range.startContainer, range.startOffset, root);
    const b = resolveOffset(range.endContainer, range.endOffset, root);
    if (a === null || b === null) {
      setSelected(null);
      return;
    }

    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end <= start) {
      setSelected(null);
      return;
    }
    setSelected({ start, end, text: text.slice(start, end) });
  }, [text]);

  useEffect(() => {
    document.addEventListener('selectionchange', readSelection);
    return () => document.removeEventListener('selectionchange', readSelection);
  }, [readSelection]);

  function add(type: AnnotationType) {
    if (!selected) return;
    const next: Annotation = {
      id: crypto.randomUUID(),
      type,
      start: selected.start,
      end: selected.end,
      ...(type === 'reduction' ? { surface: '' } : {}),
    };
    onChange([...annotations, next].sort((x, y) => x.start - y.start || x.end - y.end));
    window.getSelection()?.removeAllRanges();
    setSelected(null);
  }

  function remove(id: string) {
    onChange(annotations.filter((a) => a.id !== id));
  }

  function updateSurface(id: string, surface: string) {
    onChange(annotations.map((a) => (a.id === id ? { ...a, surface } : a)));
  }

  return (
    <div className="space-y-4">
      <AnnotatedText rootRef={rootRef} text={text} annotations={annotations} editable />

      <AnnotationLegend />

      <div className="rounded-lg border bg-muted/40 p-3">
        {selected ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              選択中:{' '}
              <span className="font-mono text-foreground">“{selected.text}”</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ANNOTATION_TYPES.map((type) => (
                <Button
                  key={type}
                  size="sm"
                  variant="outline"
                  // mousedown で選択が解除されると onClick 時に範囲を失うので抑止する
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(type)}
                  title={ANNOTATION_META[type].description}
                  style={{ borderColor: ANNOTATION_META[type].color }}
                >
                  <span style={{ color: ANNOTATION_META[type].color }}>
                    {ANNOTATION_META[type].glyph}
                  </span>
                  {ANNOTATION_META[type].label}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            スクリプトの一部をドラッグして選択すると、音の記号を付けられます。
          </p>
        )}
      </div>

      {annotations.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {annotations.map((annotation) => (
            <li key={annotation.id} className="flex items-center gap-2 px-3 py-2">
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
                style={{
                  color: ANNOTATION_META[annotation.type].color,
                  backgroundColor: `${ANNOTATION_META[annotation.type].color}18`,
                }}
              >
                {ANNOTATION_META[annotation.type].label}
              </span>
              <span className="truncate font-mono text-xs">
                {text.slice(annotation.start, annotation.end)}
              </span>
              {annotation.type === 'reduction' && (
                <Input
                  value={annotation.surface ?? ''}
                  onChange={(e) => updateSurface(annotation.id, e.target.value)}
                  placeholder="実際の音 (gonna)"
                  className="h-7 w-32 shrink-0 text-xs"
                />
              )}
              {annotation.note && (
                // 狭い画面ではまず補足から詰める（基準幅0）。記号を付けた語のほうを残す。
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {annotation.note}
                </span>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto size-7 shrink-0"
                onClick={() => remove(annotation.id)}
                aria-label="削除"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
