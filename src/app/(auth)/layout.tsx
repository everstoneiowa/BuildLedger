export const dynamic = 'force-dynamic';
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4"><div className="w-full max-w-sm rounded-lg bg-white p-7">{children}</div></div>;
}
