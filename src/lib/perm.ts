export type Role = 'owner' | 'admin' | 'bookkeeper' | 'pm' | 'viewer';
export type SessionUser = { id: number; companyId: number; name: string; email: string; role: Role; canPrintChecks: boolean };
export const ROLES: { value: Role; label: string; desc: string }[] = [
  { value: 'owner', label: 'Owner', desc: 'Everything, including bank accounts and users' },
  { value: 'admin', label: 'Administrator', desc: 'Everything, including bank accounts and users' },
  { value: 'bookkeeper', label: 'Bookkeeper', desc: 'All accounting; prints checks only if separately authorized' },
  { value: 'pm', label: 'Project manager', desc: 'Projects, expenses, documents, mileage — no checks, banking, or company reports' },
  { value: 'viewer', label: 'Read-only (accountant)', desc: 'Can view and export everything except banking; cannot change anything' },
];
const all: Role[] = ['owner', 'admin', 'bookkeeper', 'pm', 'viewer'];
const acct: Role[] = ['owner', 'admin', 'bookkeeper'];
const MAP: Record<string, Role[]> = {
  'projects.write': ['owner', 'admin', 'bookkeeper', 'pm'], 'contacts.write': ['owner', 'admin', 'bookkeeper', 'pm'],
  'bills.write': ['owner', 'admin', 'bookkeeper', 'pm'], 'documents.write': ['owner', 'admin', 'bookkeeper', 'pm'],
  'mileage.write': ['owner', 'admin', 'bookkeeper', 'pm'], 'invoices.write': acct, 'payments.write': acct,
  'checks.read': [...acct, 'viewer'], 'checks.write': acct, 'journal.write': acct,
  'reports.read': [...acct, 'viewer'], 'ledger.read': [...acct, 'viewer'],
  'bank.admin': ['owner', 'admin'], 'settings.admin': ['owner', 'admin'], 'sensitive.read': ['owner', 'admin'], 'read': all,
};
export type Perm = keyof typeof MAP | 'checks.print';
export function can(u: Pick<SessionUser, 'role' | 'canPrintChecks'>, perm: string): boolean {
  if (perm === 'checks.print') return u.role === 'owner' || u.role === 'admin' || (u.role === 'bookkeeper' && u.canPrintChecks);
  return (MAP[perm] ?? []).includes(u.role);
}
