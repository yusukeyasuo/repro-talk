import { notFound } from 'next/navigation';

import { CourseScreen } from '@/components/composition/course-screen';
import { createClient } from '@/lib/supabase/server';
import type { Composition, CompositionCourse } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: course }, { data: comps }] = await Promise.all([
    // RLS 越しに読めなければ（＝他人のコース）null になり notFound へ落ちる
    supabase.from('composition_courses').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('compositions')
      .select('*')
      .eq('course_id', id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  if (!course) notFound();

  return (
    <CourseScreen
      course={course as CompositionCourse}
      compositions={(comps ?? []) as Composition[]}
    />
  );
}
