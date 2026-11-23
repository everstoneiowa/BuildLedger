import { session, can } from '@/lib/auth';
import { fmtMoney, fmtDate, D } from '@/lib/money';
import { reconciliationData } from '@/services/payments';
import { PageHeader, Panel, Stat, Badge, NoAccess } from '@/components/ui';
import { ActionButton } from '@/components/FormModal';
import { ReconList } from '@/components/MoneyForms';
import { completeReconAction, cancelReconAction } from '../../../../actions';

export default async function Recon({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const { user, ctx } = await session(); if (!can(user, 'checks.read')) return <NoAccess />;
  const { rec, items, clearedBalance, difference } = await reconciliationData(ctx, id); const open = rec.status === 'open'; const w = can(user, 'payments.write'); const zero = D(difference).isZero();
  const shown = open ? items : items.filter(i => i.cleared);
  return (<>
    <PageHeader back={{ href: '/checks/reconcile', label: 'All reconciliations' }} title={<>{rec.bank_name} — statement {fmtDate(rec.statement_date)} <span className="align-middle"><Badge>{rec.status}</Badge></span></>} subtitle="Tick every transaction that appears on the bank statement.">
      {open && w && <ActionButton label="Discard" variant="btn-danger" confirm="Discard this reconciliation? Nothing will be marked cleared." action={cancelReconAction.bind(null, id)} done="/checks/reconcile" />}
      {open && w && <ActionButton label="Finish reconciliation" variant="btn-primary" confirm={zero ? 'Finish? Ticked checks will be marked cleared.' : 'The difference is not zero yet.'} action={completeReconAction.bind(null, id)} />}
    </PageHeader>
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Beginning balance" value={fmtMoney(rec.beginning_balance)} /><Stat label="Statement ending balance" value={fmtMoney(rec.ending_balance)} /><Stat label="Cleared balance so far" value={fmtMoney(clearedBalance)} /><Stat label="Difference" value={fmtMoney(difference)} tone={zero ? 'good' : 'bad'} hint={zero ? 'Balanced' : 'Must reach $0.00 to finish'} /></div>
    <Panel pad={false} title={open ? 'Uncleared transactions through the statement date' : 'Transactions cleared in this reconciliation'}><ReconList reconId={id} items={shown} locked={!open || !w} /></Panel>
    <p className="mt-2 text-xs text-muted">The first reconciliation starts from $0.00, so tick the opening-balance entry too. Voided payments are left out because they never reached the bank.</p>
  </>);
}
