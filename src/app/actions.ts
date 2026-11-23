'use server';
import { redirect } from 'next/navigation';
import { eq, and, sql } from 'drizzle-orm';
import { getDb, schema, audit, nextSeq, one, inTx } from '@/db';
import { run, F, type Result } from '@/lib/action';
import { signIn, signOut, startSession } from '@/lib/auth';
import { can } from '@/lib/perm';
import { encrypt, last4, hashPassword } from '@/lib/crypto';
import { D, m2, today } from '@/lib/money';
import { createCompany } from '@/services/seed';
import { createBill, updateBill, voidBill, findDuplicateBills, allocateOverhead, type BillInput } from '@/services/bills';
import { createInvoice, updateInvoice, voidInvoice, type InvoiceInput } from '@/services/invoices';
import { payBills, receivePayment, voidPayment, createCheck, updateCheck, issueCheck, voidCheck, startReconciliation, toggleReconItem, completeReconciliation, cancelReconciliation } from '@/services/payments';
import { postEntry, accountByCode } from '@/services/accounting';
import { linkDocument } from '@/services/documents';
const S = schema;

/* ───────────── Sign-in and first-run setup ───────────── */
export async function loginAction(fd: FormData): Promise<Result> {
  const f = F(fd);
  if (!(await signIn(f.s('email') ?? '', f.s('password') ?? ''))) return { error: 'That email and password do not match an active user.' };
  redirect('/');
}
export async function logoutAction() { await signOut(); redirect('/login'); }
export async function setupAction(fd: FormData): Promise<Result> {
  const f = F(fd); const db = await getDb();
  if (await one(db, sql`SELECT 1 FROM users LIMIT 1`)) return { error: 'Setup has already been completed. Sign in instead.' };
  const pw = f.s('password') ?? ''; if (pw.length < 10) return { error: 'Use a password of at least 10 characters.' };
  try {
    const ctx = await createCompany(db, { companyName: f.req('company', 'Company name'), userName: f.req('name', 'Your name'), email: f.req('email', 'Email'), password: pw });
    await startSession(ctx.userId!);
  } catch (e: any) { return { error: e.message }; }
  redirect('/');
}

/* ───────────── Projects ───────────── */
export async function saveProject(fd: FormData) {
  return run('projects.write', async ctx => {
    const f = F(fd); const id = f.n('id');
    const v = { name: f.req('name', 'Project name'), address: f.s('address'), clientId: f.n('clientId'), jurisdictionId: f.n('jurisdictionId'), startDate: f.s('startDate'), estCompletion: f.s('estCompletion'), actualCompletion: f.s('actualCompletion'), status: f.s('status') ?? 'active', budget: m2(f.money('budget')), contractPrice: m2(f.money('contractPrice')), description: f.s('description'), notes: f.s('notes') };
    if (id) {
      await ctx.db.update(S.projects).set({ ...v, ...(f.s('number') ? { number: f.s('number')! } : {}) }).where(and(eq(S.projects.id, id), eq(S.projects.companyId, ctx.companyId)));
      await audit(ctx, 'update', 'project', id, `Project "${v.name}" updated`, v); return { id };
    }
    const number = f.s('number') ?? `P-${String(await nextSeq(ctx, 'project')).padStart(3, '0')}`;
    const [p] = await ctx.db.insert(S.projects).values({ ...v, number, companyId: ctx.companyId }).returning({ id: S.projects.id });
    await audit(ctx, 'create', 'project', p.id, `Project ${number} "${v.name}" created`); return { id: p.id };
  });
}
export async function setProjectStatus(id: number, status: string) {
  return run('projects.write', async ctx => {
    await ctx.db.update(S.projects).set({ status, ...(status === 'completed' ? { actualCompletion: sql`coalesce(${S.projects.actualCompletion}, CURRENT_DATE)` } : {}) }).where(and(eq(S.projects.id, id), eq(S.projects.companyId, ctx.companyId)));
    await audit(ctx, 'status', 'project', id, `Project status changed to ${status}`);
  });
}
export async function saveBudgetLine(fd: FormData) {
  return run('projects.write', async ctx => {
    const f = F(fd); const projectId = f.n('projectId')!, categoryId = f.n('categoryId'); if (!categoryId) throw new Error('Choose a category');
    const amount = m2(f.money('amount'));
    await ctx.db.insert(S.projectBudgets).values({ projectId, categoryId, amount }).onConflictDoUpdate({ target: [S.projectBudgets.projectId, S.projectBudgets.categoryId], set: { amount } });
    await audit(ctx, 'budget', 'project', projectId, `Budget line set to ${amount}`, { categoryId });
  });
}
export async function saveChangeOrder(fd: FormData) {
  return run('projects.write', async ctx => {
    const f = F(fd); const id = f.n('id'); const projectId = f.n('projectId')!;
    const v = { projectId, number: f.s('number') ?? `CO-${await nextSeq(ctx, 'co-' + projectId)}`, date: f.s('date') ?? today(), description: f.req('description', 'Description'), budgetChange: m2(f.money('budgetChange')), priceChange: m2(f.money('priceChange')), status: f.s('status') ?? 'pending' };
    if (id) await ctx.db.update(S.changeOrders).set(v).where(eq(S.changeOrders.id, id)); else await ctx.db.insert(S.changeOrders).values(v);
    await audit(ctx, id ? 'update' : 'create', 'change_order', id, `Change order ${v.number} (${v.status})`, v);
  });
}

/* ───────────── Vendors & clients ───────────── */
export async function saveVendor(fd: FormData) {
  return run('contacts.write', async (ctx, user) => {
    const f = F(fd); const id = f.n('id'); const taxId = f.s('taxId');
    const v: any = { name: f.req('name', 'Business name'), kind: f.s('kind') ?? 'vendor', contact: f.s('contact'), phone: f.s('phone'), email: f.s('email'), address: f.s('address'), trade: f.s('trade'), is1099: f.b('is1099'), requiresWaiver: f.b('requiresWaiver'), insuranceExpires: f.s('insuranceExpires'), notes: f.s('notes') };
    if (taxId) { if (!can(user, 'sensitive.read')) throw new Error('Only an owner or administrator can enter tax IDs'); v.taxIdEnc = encrypt(taxId); v.taxIdLast4 = last4(taxId); }
    if (id) { await ctx.db.update(S.vendors).set(v).where(and(eq(S.vendors.id, id), eq(S.vendors.companyId, ctx.companyId))); await audit(ctx, 'update', 'vendor', id, `Vendor "${v.name}" updated${taxId ? ' (tax ID changed)' : ''}`); return { id }; }
    const [r] = await ctx.db.insert(S.vendors).values({ ...v, companyId: ctx.companyId }).returning({ id: S.vendors.id });
    await audit(ctx, 'create', 'vendor', r.id, `Vendor "${v.name}" created`); return { id: r.id };
  });
}
export async function saveClient(fd: FormData) {
  return run('contacts.write', async ctx => {
    const f = F(fd); const id = f.n('id');
    const v = { name: f.req('name', 'Name'), contact: f.s('contact'), phone: f.s('phone'), email: f.s('email'), address: f.s('address'), notes: f.s('notes') };
    if (id) { await ctx.db.update(S.clients).set(v).where(and(eq(S.clients.id, id), eq(S.clients.companyId, ctx.companyId))); await audit(ctx, 'update', 'client', id, `Client "${v.name}" updated`); return { id }; }
    const [r] = await ctx.db.insert(S.clients).values({ ...v, companyId: ctx.companyId }).returning({ id: S.clients.id });
    await audit(ctx, 'create', 'client', r.id, `Client "${v.name}" created`); return { id: r.id };
  });
}
export async function setContactActive(kind: 'vendor' | 'client', id: number, active: boolean) {
  return run('contacts.write', async ctx => {
    const t = kind === 'vendor' ? S.vendors : S.clients;
    await ctx.db.update(t).set({ active }).where(and(eq(t.id, id), eq(t.companyId, ctx.companyId)));
    await audit(ctx, active ? 'restore' : 'archive', kind, id, `${kind} ${active ? 'restored' : 'archived'}`);
  });
}

/* ───────────── Bills, expenses, payments ───────────── */
export async function saveBill(payload: BillInput & { id?: number; confirmDuplicate?: boolean }) {
  return run('bills.write', async (ctx, user) => {
    if (payload.payNow && !can(user, 'payments.write')) throw new Error('Your role can enter bills but not record payments. Save it as unpaid.');
    const total = m2(payload.lines.reduce((a, l) => a.plus(D(l.amount)), D(0)));
    if (!payload.confirmDuplicate) {
      const dups = await findDuplicateBills(ctx, { vendorId: payload.vendorId, billNo: payload.billNo, total, date: payload.date, excludeId: payload.id });
      if (dups.length) return { data: { duplicates: dups } };
    }
    if (payload.id) { await updateBill(ctx, payload.id, payload); return { id: payload.id }; }
    return { id: await createBill(ctx, payload) };
  });
}
export async function voidBillAction(id: number, reason: string) { return run('bills.write', ctx => voidBill(ctx, id, reason)); }
export async function payBillAction(fd: FormData) {
  return run('payments.write', async ctx => {
    const f = F(fd);
    await payBills(ctx, { date: f.req('date', 'Date'), method: f.req('method', 'Method'), accountId: f.n('accountId') ?? (() => { throw new Error('Choose the account paid from'); })(), reference: f.s('reference'), memo: f.s('memo'), apps: [{ billId: f.n('billId')!, amount: m2(f.money('amount')) }] });
  });
}
export async function voidPaymentAction(id: number, reason: string) { return run('payments.write', ctx => voidPayment(ctx, id, reason)); }
export async function allocateAction(fd: FormData) {
  return run('bills.write', async ctx => {
    const f = F(fd); const projectIds = fd.getAll('projectIds').map(Number).filter(Boolean);
    await allocateOverhead(ctx, f.n('billId')!, (f.s('method') ?? 'equal') as any, projectIds);
  });
}

/* ───────────── Invoices & receipts ───────────── */
export async function saveInvoice(payload: InvoiceInput & { id?: number }) {
  return run('invoices.write', async ctx => { if (payload.id) { await updateInvoice(ctx, payload.id, payload); return { id: payload.id }; } return { id: await createInvoice(ctx, payload) }; });
}
export async function voidInvoiceAction(id: number, reason: string) { return run('invoices.write', ctx => voidInvoice(ctx, id, reason)); }
export async function receivePaymentAction(fd: FormData) {
  return run('payments.write', async ctx => {
    const f = F(fd);
    await receivePayment(ctx, { date: f.req('date', 'Date'), method: f.req('method', 'Method'), accountId: f.n('accountId') ?? (() => { throw new Error('Choose the deposit account'); })(), reference: f.s('reference'), memo: f.s('memo'), apps: [{ invoiceId: f.n('invoiceId')!, amount: m2(f.money('amount')) }] });
  });
}

/* ───────────── Checks & reconciliation ───────────── */
export async function createCheckAction(payload: { bankAccountId: number; number?: number | null; date: string; payeeAddress?: string | null; memo?: string | null; projectId?: number | null; apps: { billId: number; amount: string }[] }) {
  return run('checks.write', async ctx => ({ id: await createCheck(ctx, payload) }));
}
export async function updateCheckAction(fd: FormData) {
  return run('checks.write', async ctx => { const f = F(fd); await updateCheck(ctx, f.n('id')!, { date: f.req('date', 'Date'), payee: f.req('payee', 'Payee'), payeeAddress: f.s('payeeAddress'), memo: f.s('memo') }); });
}
export async function issueCheckAction(id: number) { return run('checks.write', ctx => issueCheck(ctx, id)); }
export async function voidCheckAction(id: number, reason: string) { return run('checks.write', ctx => voidCheck(ctx, id, reason)); }
export async function startReconAction(fd: FormData) {
  return run('payments.write', async ctx => { const f = F(fd); return { id: await startReconciliation(ctx, { bankAccountId: f.n('bankAccountId')!, statementDate: f.req('statementDate', 'Statement date'), endingBalance: f.money('endingBalance') }) }; });
}
export async function toggleReconAction(reconId: number, lineId: number, on: boolean) { return run('payments.write', ctx => toggleReconItem(ctx, reconId, lineId, on)); }
export async function completeReconAction(id: number) { return run('payments.write', ctx => completeReconciliation(ctx, id)); }
export async function cancelReconAction(id: number) { return run('payments.write', ctx => cancelReconciliation(ctx, id)); }

/* ───────────── Lien waivers ───────────── */
export async function saveWaiver(fd: FormData) {
  return run('bills.write', async ctx => {
    const f = F(fd); const id = f.n('id');
    const v = { projectId: f.n('projectId') ?? (() => { throw new Error('Choose a project'); })(), vendorId: f.n('vendorId') ?? (() => { throw new Error('Choose a vendor'); })(), type: f.req('type', 'Waiver type'), amount: f.s('amount') ? m2(f.money('amount')) : null, paymentDate: f.s('paymentDate'), status: f.s('status') ?? 'requested', receivedDate: f.s('receivedDate'), documentId: f.n('documentId'), notes: f.s('notes') };
    if (v.status === 'received' && !v.receivedDate) v.receivedDate = today();
    let wid = id;
    if (id) await ctx.db.update(S.lienWaivers).set(v).where(and(eq(S.lienWaivers.id, id), eq(S.lienWaivers.companyId, ctx.companyId)));
    else [{ id: wid }] = await ctx.db.insert(S.lienWaivers).values({ ...v, companyId: ctx.companyId }).returning({ id: S.lienWaivers.id });
    if (v.documentId) { await linkDocument(ctx, v.documentId, 'waiver', wid!); await linkDocument(ctx, v.documentId, 'project', v.projectId); await linkDocument(ctx, v.documentId, 'vendor', v.vendorId); await ctx.db.update(S.documents).set({ folder: 'Lien Waivers' }).where(eq(S.documents.id, v.documentId)); }
    await audit(ctx, id ? 'update' : 'create', 'waiver', wid!, `Lien waiver ${v.status} (${v.type})`);
  });
}

/* ───────────── Mileage ───────────── */
export async function saveTrip(fd: FormData) {
  return run('mileage.write', async ctx => {
    const f = F(fd); const id = f.n('id'); const a = f.s('odoStart'), b = f.s('odoEnd');
    let miles = f.s('miles');
    if (a && b) { if (D(b).lt(a)) throw new Error('Ending odometer must be greater than starting odometer'); if (!miles) miles = D(b).minus(a).toFixed(1); }
    if (!miles || D(miles).lte(0)) throw new Error('Enter the miles driven, or both odometer readings');
    const v = { date: f.req('date', 'Date'), origin: f.s('origin'), destination: f.s('destination'), purpose: f.req('purpose', 'Business purpose'), projectId: f.n('projectId'), vehicleId: f.n('vehicleId'), odoStart: a, odoEnd: b, miles: D(miles).toFixed(1), notes: f.s('notes') };
    if (id) await ctx.db.update(S.mileageTrips).set(v).where(and(eq(S.mileageTrips.id, id), eq(S.mileageTrips.companyId, ctx.companyId)));
    else await ctx.db.insert(S.mileageTrips).values({ ...v, companyId: ctx.companyId, createdBy: ctx.userId });
    await audit(ctx, id ? 'update' : 'create', 'trip', id, `Trip ${v.date}: ${v.miles} mi — ${v.purpose}`);
  });
}
export async function deleteTrip(id: number) {
  return run('mileage.write', async ctx => { await ctx.db.delete(S.mileageTrips).where(and(eq(S.mileageTrips.id, id), eq(S.mileageTrips.companyId, ctx.companyId))); await audit(ctx, 'delete', 'trip', id, 'Mileage trip deleted'); });
}

/* ───────────── Documents ───────────── */
export async function updateDocument(fd: FormData) {
  return run('documents.write', async ctx => {
    const f = F(fd); const id = f.n('id')!;
    await ctx.db.update(S.documents).set({ name: f.req('name', 'Name'), description: f.s('description'), folder: f.s('folder') ?? 'Miscellaneous', tags: f.s('tags') }).where(and(eq(S.documents.id, id), eq(S.documents.companyId, ctx.companyId)));
    const pid = f.n('projectId'), vid = f.n('vendorId'); if (pid) await linkDocument(ctx, id, 'project', pid); if (vid) await linkDocument(ctx, id, 'vendor', vid);
    await audit(ctx, 'update', 'document', id, 'Document details updated');
  });
}
export async function deleteDocument(id: number) {
  return run('documents.write', async ctx => { await ctx.db.update(S.documents).set({ deletedAt: new Date() }).where(and(eq(S.documents.id, id), eq(S.documents.companyId, ctx.companyId))); await audit(ctx, 'delete', 'document', id, 'Document moved to trash (file retained)'); });
}

/* ───────────── Settings ───────────── */
export async function saveCompany(fd: FormData) {
  return run('settings.admin', async ctx => {
    const f = F(fd);
    await ctx.db.update(S.companies).set({ name: f.req('name', 'Company name'), address: f.s('address'), phone: f.s('phone'), email: f.s('email'), paymentInstructions: f.s('paymentInstructions'), invoiceNotes: f.s('invoiceNotes'), ...(f.n('logoDocId') ? { logoDocId: f.n('logoDocId') } : {}) }).where(eq(S.companies.id, ctx.companyId));
    await audit(ctx, 'update', 'company', ctx.companyId, 'Company profile updated');
  });
}
export async function saveUser(fd: FormData) {
  return run('settings.admin', async (ctx, me) => {
    const f = F(fd); const id = f.n('id'); const pw = f.s('password');
    if (pw && pw.length < 10) throw new Error('Passwords must be at least 10 characters');
    const v: any = { name: f.req('name', 'Name'), email: f.req('email', 'Email').toLowerCase(), role: f.s('role') ?? 'viewer', canPrintChecks: f.b('canPrintChecks'), active: f.b('active') };
    if (v.role === 'owner' && me.role !== 'owner') throw new Error('Only an owner can grant the owner role');
    if (id === me.id && (!v.active || v.role !== me.role)) throw new Error('You cannot change your own role or deactivate yourself');
    if (pw) v.passwordHash = hashPassword(pw);
    if (id) { await ctx.db.update(S.users).set(v).where(and(eq(S.users.id, id), eq(S.users.companyId, ctx.companyId))); if (!v.active || pw) await ctx.db.delete(S.sessions).where(eq(S.sessions.userId, id)); }
    else { if (!pw) throw new Error('Set an initial password'); await ctx.db.insert(S.users).values({ ...v, companyId: ctx.companyId }); }
    await audit(ctx, id ? 'update' : 'create', 'user', id, `User ${v.email}: role ${v.role}${v.canPrintChecks ? ', may print checks' : ''}${v.active ? '' : ', deactivated'}`);
  });
}
export async function saveAccount(fd: FormData) {
  return run('settings.admin', async ctx => {
    const f = F(fd); const id = f.n('id'); const type = f.req('type', 'Type');
    const v = { code: f.req('code', 'Account number'), name: f.req('name', 'Name'), type, subtype: type === 'liability' && f.b('creditCard') ? 'credit_card' : undefined };
    if (id) await ctx.db.update(S.accounts).set({ code: v.code, name: v.name }).where(and(eq(S.accounts.id, id), eq(S.accounts.companyId, ctx.companyId)));
    else await ctx.db.insert(S.accounts).values({ ...v, companyId: ctx.companyId });
    await audit(ctx, id ? 'update' : 'create', 'account', id, `Account ${v.code} ${v.name}`);
  });
}
export async function saveCategory(fd: FormData) {
  return run('settings.admin', async ctx => {
    const f = F(fd); const id = f.n('id'); const kind = f.s('kind') ?? 'project';
    const accountId = f.n('accountId') ?? await accountByCode(ctx, kind === 'project' ? '5000' : '6900');
    const v = { name: f.req('name', 'Name'), kind, parentId: f.n('parentId'), accountId, active: id ? f.b('active') : true };
    if (id) await ctx.db.update(S.categories).set(v).where(and(eq(S.categories.id, id), eq(S.categories.companyId, ctx.companyId)));
    else await ctx.db.insert(S.categories).values({ ...v, companyId: ctx.companyId, sort: 999 });
    await audit(ctx, id ? 'update' : 'create', 'category', id, `Category "${v.name}" (${kind})`);
  });
}
export async function saveBankAccount(fd: FormData) {
  return run('bank.admin', async ctx0 => inTx(ctx0, async ctx => {
    const f = F(fd); const id = f.n('id'); const routing = f.s('routing'), acct = f.s('accountNumber');
    if (routing && !/^\d{9}$/.test(routing)) throw new Error('Routing numbers are 9 digits');
    const v: any = { name: f.req('name', 'Account name'), bankName: f.s('bankName'), bankAddress: f.s('bankAddress'), nextCheckNumber: f.n('nextCheckNumber') ?? 1001, layout: f.s('layout') ?? 'top', stock: f.s('stock') ?? 'preprinted', offsetX: D(f.s('offsetX') ?? 0).toFixed(3), offsetY: D(f.s('offsetY') ?? 0).toFixed(3), micrFontDocId: f.n('micrFontDocId') };
    if (routing) v.routingEnc = encrypt(routing);
    if (acct) { v.accountEnc = encrypt(acct); v.last4 = last4(acct); }
    if (id) {
      const used = await one<{ n: number }>(ctx.db, sql`SELECT max(number)::int n FROM checks WHERE bank_account_id = ${id}`);
      if (used?.n && v.nextCheckNumber <= used.n) throw new Error(`The next check number must be above ${used.n}, the highest number already used`);
      await ctx.db.update(S.bankAccounts).set(v).where(and(eq(S.bankAccounts.id, id), eq(S.bankAccounts.companyId, ctx.companyId)));
      await audit(ctx, 'update', 'bank_account', id, `Bank account "${v.name}" settings changed${acct || routing ? ' (account details changed)' : ''}`); return;
    }
    const mx = await one<{ c: string }>(ctx.db, sql`SELECT max(code) c FROM accounts WHERE company_id = ${ctx.companyId} AND subtype = 'bank'`);
    const code = String(Number(mx?.c ?? '999') + 10);
    const [gl] = await ctx.db.insert(S.accounts).values({ companyId: ctx.companyId, code, name: v.name, type: 'asset', subtype: 'bank' }).returning({ id: S.accounts.id });
    const [b] = await ctx.db.insert(S.bankAccounts).values({ ...v, companyId: ctx.companyId, accountId: gl.id }).returning({ id: S.bankAccounts.id });
    await audit(ctx, 'create', 'bank_account', b.id, `Bank account "${v.name}" added`);
  }));
}
export async function setOpeningBalance(fd: FormData) {
  return run('bank.admin', async ctx => {
    const f = F(fd); const amount = m2(f.money('amount')); if (D(amount).lte(0)) throw new Error('Enter the opening balance');
    const b = await one<{ account_id: number; name: string }>(ctx.db, sql`SELECT account_id, name FROM bank_accounts WHERE id = ${f.n('bankAccountId')} AND company_id = ${ctx.companyId}`);
    if (!b) throw new Error('Bank account not found');
    if (await one(ctx.db, sql`SELECT 1 FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id WHERE je.source_type = 'opening' AND jl.account_id = ${b.account_id} AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.reverses_id = je.id) AND je.reverses_id IS NULL`)) throw new Error('An opening balance has already been posted for this account');
    await postEntry(ctx, { date: f.req('date', 'As-of date'), memo: `Opening balance — ${b.name}`, sourceType: 'opening', lines: [{ accountId: b.account_id, debit: amount }, { accountId: await accountByCode(ctx, '3000'), credit: amount }] });
    await audit(ctx, 'create', 'bank_account', f.n('bankAccountId'), `Opening balance of ${amount} posted`);
  });
}
export async function saveMileageRate(fd: FormData) {
  return run('settings.admin', async ctx => {
    const f = F(fd); const v = { effectiveFrom: f.req('effectiveFrom', 'Effective date'), rate: D(f.req('rate', 'Rate')).toFixed(4), note: f.s('note') };
    await ctx.db.insert(S.mileageRates).values({ ...v, companyId: ctx.companyId }).onConflictDoUpdate({ target: [S.mileageRates.companyId, S.mileageRates.effectiveFrom], set: { rate: v.rate, note: v.note } });
    await audit(ctx, 'update', 'mileage_rate', null, `Mileage rate ${v.rate}/mi effective ${v.effectiveFrom}`);
  });
}
export async function saveVehicle(fd: FormData) {
  return run('mileage.write', async ctx => { const f = F(fd); await ctx.db.insert(S.vehicles).values({ companyId: ctx.companyId, name: f.req('name', 'Vehicle name') }); });
}
export async function saveJurisdiction(fd: FormData) {
  return run('settings.admin', async ctx => {
    const f = F(fd); const id = f.n('id'); const types = (f.s('waiverTypes') ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!types.length) throw new Error('List at least one waiver type (one per line)');
    const v = { name: f.req('name', 'Name'), waiverTypes: types, notes: f.s('notes') };
    if (id) await ctx.db.update(S.jurisdictions).set(v).where(and(eq(S.jurisdictions.id, id), eq(S.jurisdictions.companyId, ctx.companyId))); else await ctx.db.insert(S.jurisdictions).values({ ...v, companyId: ctx.companyId });
    await audit(ctx, id ? 'update' : 'create', 'jurisdiction', id, `Jurisdiction "${v.name}" saved`);
  });
}
export async function postManualEntry(payload: { date: string; memo: string; lines: { accountId: number; debit: string; credit: string; projectId?: number | null }[] }) {
  return run('journal.write', async ctx => {
    if (!payload.memo?.trim()) throw new Error('Describe what this entry is for');
    const id = await postEntry(ctx, { date: payload.date, memo: payload.memo.trim(), sourceType: 'manual', lines: payload.lines.filter(l => l.accountId).map(l => ({ accountId: Number(l.accountId), debit: l.debit || 0, credit: l.credit || 0, projectId: l.projectId || null })) });
    await audit(ctx, 'create', 'journal_entry', id, `Manual journal entry: ${payload.memo}`, payload); return { id };
  });
}
export async function reverseManualEntry(id: number, reason: string) {
  return run('journal.write', async ctx => {
    const e = await one<{ source_type: string }>(ctx.db, sql`SELECT source_type FROM journal_entries WHERE id = ${id} AND company_id = ${ctx.companyId}`);
    if (!e || !['manual', 'opening'].includes(e.source_type)) throw new Error('Only manual entries are reversed here. Void the bill, invoice, payment or check instead.');
    const { reverseEntry } = await import('@/services/accounting');
    await reverseEntry(ctx, id, { date: today(), memo: `Reversal: ${reason}` }); await audit(ctx, 'reverse', 'journal_entry', id, `Manual entry reversed: ${reason}`);
  });
}
