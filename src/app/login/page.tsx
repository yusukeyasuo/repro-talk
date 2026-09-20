import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // `/auth/callback` が失敗したときの理由。読み捨てるとフォームだけが無言で戻り、
  // 原因が分からないままメールを送り直すことになる。
  const { error } = await searchParams;
  return <LoginForm errorReason={error} />;
}
