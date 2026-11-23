import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { getDb, one } from '@/db';
import { AuthForm } from '@/components/AuthForm';
import { setupAction } from '../../actions';
export default async function Setup() {
  if (await one(await getDb(), sql`SELECT 1 FROM users LIMIT 1`)) redirect('/login');
  return (<><h1 className="text-xl font-semibold">Set up your company</h1><p className="mb-5 mt-1 text-sm text-muted">This creates the owner account, a starter chart of accounts and construction cost categories. Everything can be changed later in Settings.</p>
    <AuthForm action={setupAction} submit="Create company" fields={[{ name: 'company', label: 'Company name' }, { name: 'name', label: 'Your name', autoComplete: 'name' }, { name: 'email', label: 'Email', type: 'email', autoComplete: 'username' }, { name: 'password', label: 'Password (10+ characters)', type: 'password', autoComplete: 'new-password' }]} /></>);
}
