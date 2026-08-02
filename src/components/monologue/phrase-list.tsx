'use client';

import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { deletePhrase } from '@/app/actions/phrases';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Phrase } from '@/types/database';

export function PhraseList({ phrases }: { phrases: Phrase[] }) {
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    startTransition(async () => {
      const result = await deletePhrase(id);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <ul className="divide-y rounded-lg border">
      {phrases.map((phrase) => (
        <li key={phrase.id} className="flex items-start gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm">{phrase.text}</p>
            {phrase.meaning_ja && (
              <p className="mt-0.5 text-xs text-muted-foreground">{phrase.meaning_ja}</p>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <Badge variant={phrase.used_count > 0 ? 'secondary' : 'outline'}>
                {phrase.used_count > 0 ? `${phrase.used_count} 回使った` : '未使用'}
              </Badge>
              {phrase.clip_id && (
                <Link
                  href={`/clips/${phrase.clip_id}`}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  出典のクリップ
                </Link>
              )}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={() => remove(phrase.id)}
            disabled={pending}
            aria-label="削除"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
