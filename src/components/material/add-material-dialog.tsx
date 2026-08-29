'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createMaterial } from '@/app/actions/materials';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { MATERIAL_LEVELS, type MaterialLevel } from '@/types/database';
import { cn } from '@/lib/utils';

export function AddMaterialDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [level, setLevel] = useState<MaterialLevel>(1);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await createMaterial({ url, level });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('素材を追加しました');
      setOpen(false);
      setUrl('');
      router.push(`/materials/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            素材を追加
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>リプロダクションの素材を追加</DialogTitle>
          <DialogDescription>
            ネイティブが実際に話している動画を使います。「この人みたいに喋りたい」と思えるものを選ぶと続きます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="material-url">YouTube の URL</Label>
            <Input
              id="material-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label>レベル</Label>
            <div className="grid gap-2">
              {MATERIAL_LEVELS.map((item) => (
                <button
                  key={item.level}
                  type="button"
                  onClick={() => setLevel(item.level)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    level === item.level
                      ? 'border-foreground bg-accent'
                      : 'hover:bg-accent/50',
                  )}
                >
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !url.trim()}>
            {pending && <Spinner />}
            {pending ? '追加中…' : '追加する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
