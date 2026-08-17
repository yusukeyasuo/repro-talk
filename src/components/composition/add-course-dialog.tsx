'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createCourse } from '@/app/actions/compositions';
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
import { Textarea } from '@/components/ui/textarea';

export function AddCourseDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await createCourse({ title, description });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('コースを作成しました');
      setOpen(false);
      setTitle('');
      setDescription('');
      router.push(`/compositions/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            コースを追加
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>コースを追加</DialogTitle>
          <DialogDescription>
            例文の束です。「MTG頻出フレーズ」「旅行で使う表現」のようにテーマで分けると回しやすくなります。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="course-title">コース名</Label>
            <Input
              id="course-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="MTG頻出フレーズ"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="course-desc">説明（任意）</Label>
            <Textarea
              id="course-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !title.trim()}>
            {pending ? '作成中…' : '作成する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
