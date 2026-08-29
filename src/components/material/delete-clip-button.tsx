'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { deleteClip } from '@/app/actions/clips';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function DeleteClipButton({
  id,
  materialId,
  label,
}: {
  id: string;
  /** 動画クリップのときだけ渡す。自作テキストは material を持たない。 */
  materialId?: string | null;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await deleteClip({ id, materialId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('クリップを削除しました');
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
            aria-label="このクリップを削除"
            className="shrink-0 self-center text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>クリップを削除しますか？</DialogTitle>
          <DialogDescription>
            「{label}」を削除します。スクリプト・発音マーキング・練習記録・録音も一緒に消えます。
            抽出済みのフレーズは残ります。この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending && <Spinner />}
            {pending ? '削除中…' : '削除する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
