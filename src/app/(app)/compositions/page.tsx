import { Zap } from 'lucide-react';
import Link from 'next/link';

import { AddCourseDialog } from '@/components/composition/add-course-dialog';
import { createClient } from '@/lib/supabase/server';
import type { CompositionCourse } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function CompositionsPage() {
  const supabase = await createClient();
  const [{ data: courseData }, { data: compRows }] = await Promise.all([
    supabase.from('composition_courses').select('*').order('created_at', { ascending: false }),
    supabase.from('compositions').select('course_id'),
  ]);

  const courses = (courseData ?? []) as CompositionCourse[];
  const counts = new Map<string, number>();
  for (const row of (compRows ?? []) as { course_id: string }[]) {
    counts.set(row.course_id, (counts.get(row.course_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">瞬間英作文</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            日本語を見た瞬間に英語を作る反射のドリル。コースを選んで流すと、答えを自動で読み上げます。
          </p>
        </div>
        <AddCourseDialog />
      </header>

      {courses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            まだコースがありません。右上の「コースを追加」から作り、例文を入れましょう。
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {courses.map((course) => {
            const count = counts.get(course.id) ?? 0;
            return (
              <li key={course.id}>
                <Link
                  href={`/compositions/${course.id}`}
                  className="group block rounded-xl border p-5 transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="size-4" />
                    <span className="font-medium">{course.title}</span>
                  </div>
                  {course.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {course.description}
                    </p>
                  )}
                  <p className="mt-3 text-sm text-muted-foreground">
                    <span className="font-mono tabular-nums">{count}</span> 文
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
