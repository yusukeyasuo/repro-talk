'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { deleteMaterial } from '@/app/actions/materials';
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

export function DeleteMaterialButton({
  id,
  title,
  clipCount,
}: {
  id: string;
  title: string;
  clipCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await deleteMaterial(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('素材を削除しました');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="この素材を削除"
            className="bg-background/80 text-muted-foreground backdrop-blur-sm hover:bg-background hover:text-destructive"
          >
            <Trash2 />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>素材を削除しますか？</DialogTitle>
          <DialogDescription>
            「{title}」を削除します。
            {clipCount > 0 && (
              <>
                {' '}
                この素材から切り出した<span className="font-medium">クリップ{clipCount}件</span>
                と、その練習記録・録音もまとめて削除されます。
              </>
            )}
            抽出済みのフレーズは残ります（出典リンクだけ外れます）。この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? '削除中…' : '削除する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
