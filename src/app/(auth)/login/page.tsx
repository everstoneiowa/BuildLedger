import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { getDb, one } from '@/db';
import { getUser } from '@/lib/auth';
import { AuthForm } from '@/components/AuthForm';
import { loginAction } from '../../actions';
export default async function Login() {
  if (await getUser()) redirect('/');
  if (!(await one(await getDb(), sql`SELECT 1 FROM users LIMIT 1`))) redirect('/setup');
  return (<><h1 className="text-xl font-semibold">Sign in</h1><p className="mb-5 mt-1 text-sm text-muted">Construction accounting and project records.</p>
    <AuthForm action={loginAction} submit="Sign in" fields={[{ name: 'email', label: 'Email', type: 'email', autoComplete: 'username' }, { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' }]} /></>);
}
