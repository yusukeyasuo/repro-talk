'use client';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { localMailboxUrl } from '@/lib/local-dev';
import { createClient } from '@/lib/supabase/client';

/**
 * `/auth/callback` が失敗して戻したときの理由。
 * 何も出さずにログインフォームへ戻すと「メールが効かない」と見えて、
 * 送り直し（内蔵メールは1時間に2通）を誘発するので、必ず理由を出す。
 */
const CALLBACK_ERRORS: Record<string, string> = {
  verify:
    'ログインリンクの検証に失敗しました。リンクは送信したときと同じブラウザで開く必要があります。メールアプリの中で開いた場合は、リンクを長押しでコピーして、このブラウザに貼ってください。',
  expired:
    'このログインリンクは期限が切れているか、すでに使われています。もう一度送ってください。',
  link: 'ログインリンクが壊れています。メールのリンクをそのまま開いてください。',
  auth: 'ログインを完了できませんでした。もう一度お試しください。',
};

export function LoginForm({ errorReason }: { errorReason?: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // ローカルの Supabase はメールを外に出さず Mailpit に溜める
  const mailbox = localMailboxUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const callbackError = errorReason ? (CALLBACK_ERRORS[errorReason] ?? CALLBACK_ERRORS.auth) : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }
    setStatus('sent');
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>repro-talk</CardTitle>
          <CardDescription>
            リプロダクションと独り言を続けるための場所。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'sent' ? (
            mailbox ? (
              <div className="space-y-3">
                <p className="text-sm">
                  ローカル環境なので、メールは <strong>送信されません</strong>。
                </p>
                <p className="text-sm text-muted-foreground">
                  Mailpit を開いて、いちばん新しい「Your Magic Link」のリンクをクリックしてください。
                </p>
                <Button
                  className="w-full"
                  nativeButton={false}
                  render={
                    <a href={mailbox} target="_blank" rel="noreferrer noopener">
                      Mailpit を開く
                      <ExternalLink className="size-4" />
                    </a>
                  }
                />
                <p className="text-xs text-muted-foreground">
                  このブラウザで開いてください。別のブラウザだと検証に失敗します。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {email} にログイン用のリンクを送りました。メールを開いてください。
                </p>
                <p className="text-xs text-muted-foreground">
                  リンクは、いまこの画面を開いているブラウザで開いてください。
                  別のブラウザやメールアプリ内のブラウザだと検証に失敗します。
                </p>
              </div>
            )
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {callbackError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {callbackError}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {status === 'error' && (
                <p className="text-sm text-destructive">{message}</p>
              )}
              <Button type="submit" className="w-full" disabled={status === 'sending'}>
                {status === 'sending' ? '送信中…' : 'ログインリンクを送る'}
              </Button>
            </form>
          )}

          {mailbox && status !== 'sent' && (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              ローカルの Supabase に接続しています。ログインメールは実際には送信されず、
              Mailpit（{new URL(mailbox).host}）に届きます。
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
