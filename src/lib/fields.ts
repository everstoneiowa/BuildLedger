import type { FieldDef } from '@/components/FormModal';
import { FOLDERS } from '@/services/seed';
type Opt = { id: number; name: string };
const opts = (o: Opt[]) => o.map(x => ({ value: x.id, label: x.name }));

export const vendorFields = (canTaxId: boolean): FieldDef[] => [
  { name: 'name', label: 'Business name', required: true }, { name: 'kind', label: 'Type', type: 'select', options: [{ value: 'subcontractor', label: 'Subcontractor' }, { value: 'supplier', label: 'Supplier' }, { value: 'vendor', label: 'Other vendor' }] },
  { name: 'trade', label: 'Trade or service', placeholder: 'Electrical, framing, lumber…' }, { name: 'contact', label: 'Contact person' },
  { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'address', label: 'Mailing address (printed on checks)', type: 'textarea' },
  ...(canTaxId ? [{ name: 'taxId', label: 'Tax ID (EIN / SSN)', placeholder: 'Leave blank to keep the one on file', help: 'Stored encrypted. Only the last 4 digits are ever shown.' } as FieldDef] : []),
  { name: 'insuranceExpires', label: 'Insurance expires', type: 'date' },
  { name: 'is1099', label: 'Needs a 1099', type: 'checkbox' }, { name: 'requiresWaiver', label: 'Expect a lien waiver with each payment', type: 'checkbox', help: 'A waiver is tracked automatically for every project payment.' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const clientFields: FieldDef[] = [
  { name: 'name', label: 'Name', required: true }, { name: 'contact', label: 'Contact person' }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Mailing address', type: 'textarea' }, { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const PROJECT_STATUSES = ['planning', 'active', 'closeout', 'completed', 'archived'];
export const projectFields = (clients: Opt[], jurisdictions: Opt[], editing: boolean): FieldDef[] => [
  { name: 'name', label: 'Project name', required: true, placeholder: '1420 Maple St — spec home' }, { name: 'number', label: 'Project number', placeholder: editing ? '' : 'Assigned automatically if blank' },
  { name: 'address', label: 'Property address', full: true }, { name: 'clientId', label: 'Client or property owner', type: 'select', options: opts(clients), placeholder: '— None yet —' },
  { name: 'status', label: 'Status', type: 'select', options: PROJECT_STATUSES.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
  { name: 'startDate', label: 'Start date', type: 'date' }, { name: 'estCompletion', label: 'Estimated completion', type: 'date' }, ...(editing ? [{ name: 'actualCompletion', label: 'Actual completion', type: 'date' } as FieldDef] : []),
  { name: 'budget', label: 'Estimated budget', type: 'money' }, { name: 'contractPrice', label: 'Contract or expected sale price', type: 'money' },
  { name: 'jurisdictionId', label: 'Lien-waiver jurisdiction', type: 'select', options: opts(jurisdictions) }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const tripFields = (projects: Opt[], vehicles: Opt[]): FieldDef[] => [
  { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'vehicleId', label: 'Vehicle', type: 'select', options: opts(vehicles) },
  { name: 'origin', label: 'Starting location' }, { name: 'destination', label: 'Destination' }, { name: 'purpose', label: 'Business purpose', required: true, full: true },
  { name: 'projectId', label: 'Project (if any)', type: 'select', options: opts(projects), placeholder: 'General business' }, { name: 'miles', label: 'Total miles', type: 'number', help: 'Leave blank to calculate from the odometer.' },
  { name: 'odoStart', label: 'Odometer start', type: 'number' }, { name: 'odoEnd', label: 'Odometer end', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const waiverFields = (projects: Opt[], vendors: Opt[], types: string[], docs: Opt[]): FieldDef[] => [
  { name: 'projectId', label: 'Project', type: 'select', options: opts(projects), required: true }, { name: 'vendorId', label: 'Vendor', type: 'select', options: opts(vendors), required: true },
  { name: 'type', label: 'Waiver type', type: 'select', options: types.map(t => ({ value: t, label: t })), required: true }, { name: 'status', label: 'Status', type: 'select', options: [{ value: 'requested', label: 'Requested — not yet received' }, { value: 'received', label: 'Received' }, { value: 'not_required', label: 'Not required' }] },
  { name: 'amount', label: 'Payment amount', type: 'money' }, { name: 'paymentDate', label: 'Payment date', type: 'date' }, { name: 'receivedDate', label: 'Date received', type: 'date' },
  { name: 'documentId', label: 'Signed waiver document', type: 'select', options: opts(docs), placeholder: '— Upload it under Documents, then pick it here —' }, { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const documentFields = (projects: Opt[], vendors: Opt[]): FieldDef[] => [
  { name: 'name', label: 'File name', required: true, full: true }, { name: 'folder', label: 'Folder', type: 'select', options: FOLDERS.map(f => ({ value: f, label: f })) }, { name: 'tags', label: 'Tags', placeholder: 'comma, separated' },
  { name: 'description', label: 'Description', type: 'textarea' }, { name: 'projectId', label: 'Also file under project', type: 'select', options: opts(projects), placeholder: '— No change —' }, { name: 'vendorId', label: 'Also file under vendor', type: 'select', options: opts(vendors), placeholder: '— No change —' },
];
export const payFields = (accounts: Opt[], deposit = false): FieldDef[] => [
  { name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date', required: true },
  { name: 'accountId', label: deposit ? 'Deposited to' : 'Paid from', type: 'select', options: opts(accounts), required: true },
  { name: 'method', label: 'Method', type: 'select', required: true, options: (deposit ? ['check', 'ach', 'wire', 'cash', 'card', 'other'] : ['ach', 'card', 'cash', 'wire', 'other']).map(m => ({ value: m, label: m.toUpperCase() })) },
  { name: 'reference', label: 'Reference / confirmation #' }, { name: 'memo', label: 'Memo' },
];
