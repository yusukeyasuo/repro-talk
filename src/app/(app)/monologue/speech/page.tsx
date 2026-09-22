import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { StudyStarter } from '@/components/study/study-starter';
import { WordSpeechSession } from '@/components/monologue/word-speech-session';
import { getRunningStudySession } from '@/lib/study-server';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** ワードスピーチの材料になる「自分で入れた例文」が2件以上あるコースの最低数。 */
const MIN_MANUAL_SEEDS = 2;

export default async function MonologueSpeechPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [{ data: courseRows }, { data: compRows }, running] = await Promise.all([
    supabase
      .from('composition_courses')
      .select('id, title')
      .order('created_at', { ascending: false }),
    // お題は本人が入れた例文（source='manual'）だけから作るので、それだけ数える。
    supabase.from('compositions').select('course_id, source'),
    getRunningStudySession(),
  ]);

  const manualCounts = new Map<string, number>();
  for (const row of (compRows ?? []) as { course_id: string; source: string }[]) {
    if (row.source === 'ai') continue;
    manualCounts.set(row.course_id, (manualCounts.get(row.course_id) ?? 0) + 1);
  }

  // 材料が2件未満のコースは選んでも作れないので、選択肢に出さない。
  const courses = ((courseRows ?? []) as { id: string; title: string }[]).filter(
    (course) => (manualCounts.get(course.id) ?? 0) >= MIN_MANUAL_SEEDS,
  );

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <Link
          href="/monologue"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          独り言に戻る
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">ワードスピーチ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          瞬間英作文で覚えた言葉をお題にして、30〜60秒の英語スピーチを書いてみる練習。覚えた型を、自分の言葉として使ってみる場です。
        </p>
      </header>

      {/* 机に向かっていた時間を計る。声を出す独り言とは別に数える。 */}
      <StudyStarter kind="monologue" running={running} />

      {courses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            まだお題を作れるコースがありません。瞬間英作文で、自分の例文を2文以上入れたコースを用意すると、ここでお題を作れます。
          </p>
          <Link
            href="/compositions"
            className="mt-3 inline-flex text-sm text-muted-foreground underline hover:text-foreground"
          >
            瞬間英作文へ
          </Link>
        </div>
      ) : (
        <WordSpeechSession courses={courses} running={running} />
      )}
    </div>
  );
}
