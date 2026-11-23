import { pgTable, serial, integer, text, numeric, date, timestamp, boolean, jsonb, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';

const money = (n: string) => numeric(n, { precision: 14, scale: 2 });
const id = () => serial('id').primaryKey();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/* ───────────── Company, users, security ───────────── */
export const companies = pgTable('companies', {
  id: id(), name: text('name').notNull(), address: text('address'), phone: text('phone'), email: text('email'),
  logoDocId: integer('logo_doc_id'), paymentInstructions: text('payment_instructions'), invoiceNotes: text('invoice_notes'),
  createdAt: created(),
});
const cid = () => integer('company_id').notNull().references(() => companies.id);

export const users = pgTable('users', {
  id: id(), companyId: cid(), email: text('email').notNull().unique(), name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('viewer'), // owner | admin | bookkeeper | pm | viewer
  canPrintChecks: boolean('can_print_checks').notNull().default(false),
  active: boolean('active').notNull().default(true), createdAt: created(),
});
export const sessions = pgTable('sessions', {
  id: id(), userId: integer('user_id').notNull().references(() => users.id), tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const sequences = pgTable('sequences', {
  companyId: cid(), key: text('key').notNull(), next: integer('next').notNull().default(1),
}, t => [primaryKey({ columns: [t.companyId, t.key] })]);
export const auditLog = pgTable('audit_log', {
  id: id(), companyId: cid(), userId: integer('user_id'), action: text('action').notNull(),
  entityType: text('entity_type').notNull(), entityId: integer('entity_id'), summary: text('summary'), data: jsonb('data'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('audit_entity').on(t.entityType, t.entityId)]);

/* ───────────── Chart of accounts & general ledger ───────────── */
export const accounts = pgTable('accounts', {
  id: id(), companyId: cid(), code: text('code').notNull(), name: text('name').notNull(),
  type: text('type').notNull(), // asset | liability | equity | revenue | cogs | expense
  subtype: text('subtype'),     // bank | ar | ap | credit_card | sales_tax | owner | retained
  system: boolean('system').notNull().default(false), active: boolean('active').notNull().default(true),
}, t => [uniqueIndex('accounts_code').on(t.companyId, t.code)]);

export const journalEntries = pgTable('journal_entries', {
  id: id(), companyId: cid(), entryNo: integer('entry_no').notNull(), date: date('date').notNull(), memo: text('memo'),
  sourceType: text('source_type').notNull(), // bill | invoice | payment | manual | opening
  sourceId: integer('source_id'), reversesId: integer('reverses_id'),
  postedBy: integer('posted_by'), postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('je_date').on(t.companyId, t.date), index('je_source').on(t.sourceType, t.sourceId)]);

export const journalLines = pgTable('journal_lines', {
  id: id(), entryId: integer('entry_id').notNull().references(() => journalEntries.id),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  debit: money('debit').notNull().default('0'), credit: money('credit').notNull().default('0'),
  projectId: integer('project_id'), vendorId: integer('vendor_id'), clientId: integer('client_id'), categoryId: integer('category_id'),
  memo: text('memo'),
}, t => [index('jl_entry').on(t.entryId), index('jl_account').on(t.accountId), index('jl_project').on(t.projectId)]);

export const bankAccounts = pgTable('bank_accounts', {
  id: id(), companyId: cid(), accountId: integer('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(), bankName: text('bank_name'), bankAddress: text('bank_address'),
  routingEnc: text('routing_enc'), accountEnc: text('account_enc'), last4: text('last4'),
  nextCheckNumber: integer('next_check_number').notNull().default(1001),
  layout: text('layout').notNull().default('top'),      // top | middle | bottom
  stock: text('stock').notNull().default('preprinted'), // preprinted | blank
  offsetX: numeric('offset_x', { precision: 5, scale: 3 }).notNull().default('0'),
  offsetY: numeric('offset_y', { precision: 5, scale: 3 }).notNull().default('0'),
  micrFontDocId: integer('micr_font_doc_id'), active: boolean('active').notNull().default(true),
});

/* ───────────── Categories, contacts, projects ───────────── */
export const categories = pgTable('categories', {
  id: id(), companyId: cid(), name: text('name').notNull(), parentId: integer('parent_id'),
  kind: text('kind').notNull(), // project | overhead
  accountId: integer('account_id').notNull().references(() => accounts.id),
  sort: integer('sort').notNull().default(0), active: boolean('active').notNull().default(true),
});
export const jurisdictions = pgTable('jurisdictions', {
  id: id(), companyId: cid(), name: text('name').notNull(),
  waiverTypes: jsonb('waiver_types').$type<string[]>().notNull(), notes: text('notes'),
});
export const clients = pgTable('clients', {
  id: id(), companyId: cid(), name: text('name').notNull(), contact: text('contact'), phone: text('phone'), email: text('email'),
  address: text('address'), notes: text('notes'), active: boolean('active').notNull().default(true), createdAt: created(),
});
export const vendors = pgTable('vendors', {
  id: id(), companyId: cid(), name: text('name').notNull(), kind: text('kind').notNull().default('vendor'), // vendor | subcontractor | supplier
  contact: text('contact'), phone: text('phone'), email: text('email'), address: text('address'), trade: text('trade'),
  taxIdEnc: text('tax_id_enc'), taxIdLast4: text('tax_id_last4'), is1099: boolean('is_1099').notNull().default(false),
  requiresWaiver: boolean('requires_waiver').notNull().default(false), insuranceExpires: date('insurance_expires'),
  notes: text('notes'), active: boolean('active').notNull().default(true), createdAt: created(),
});
export const projects = pgTable('projects', {
  id: id(), companyId: cid(), name: text('name').notNull(), number: text('number').notNull(), address: text('address'),
  clientId: integer('client_id').references(() => clients.id), jurisdictionId: integer('jurisdiction_id').references(() => jurisdictions.id),
  startDate: date('start_date'), estCompletion: date('est_completion'), actualCompletion: date('actual_completion'),
  status: text('status').notNull().default('active'), // planning | active | closeout | completed | archived
  budget: money('budget').notNull().default('0'), contractPrice: money('contract_price').notNull().default('0'),
  description: text('description'), notes: text('notes'), createdAt: created(),
}, t => [uniqueIndex('projects_number').on(t.companyId, t.number)]);
export const projectBudgets = pgTable('project_budgets', {
  id: id(), projectId: integer('project_id').notNull().references(() => projects.id),
  categoryId: integer('category_id').notNull().references(() => categories.id), amount: money('amount').notNull(),
}, t => [uniqueIndex('pb_unique').on(t.projectId, t.categoryId)]);
export const changeOrders = pgTable('change_orders', {
  id: id(), projectId: integer('project_id').notNull().references(() => projects.id), number: text('number').notNull(),
  date: date('date').notNull(), description: text('description').notNull(),
  budgetChange: money('budget_change').notNull().default('0'), priceChange: money('price_change').notNull().default('0'),
  status: text('status').notNull().default('pending'), // pending | approved | rejected
});

/* ───────────── Accounts payable: bills, expenses, internally prepared payment requests ───────────── */
export const bills = pgTable('bills', {
  id: id(), companyId: cid(),
  kind: text('kind').notNull().default('vendor'), // vendor (vendor's own invoice/receipt) | internal (prepared by us on vendor's behalf)
  internalNo: text('internal_no'),
  vendorId: integer('vendor_id').references(() => vendors.id), payee: text('payee'),
  projectId: integer('project_id').references(() => projects.id), // null = general business expense
  billNo: text('bill_no'), date: date('date').notNull(), dueDate: date('due_date'),
  total: money('total').notNull(), taxAmount: money('tax_amount').notNull().default('0'), amountPaid: money('amount_paid').notNull().default('0'),
  description: text('description'), notes: text('notes'),
  status: text('status').notNull().default('open'), // open | void
  entryId: integer('entry_id'), createdBy: integer('created_by'), createdAt: created(),
}, t => [index('bills_vendor').on(t.vendorId), index('bills_project').on(t.projectId), uniqueIndex('bills_internal_no').on(t.companyId, t.internalNo)]);
export const billLines = pgTable('bill_lines', {
  id: id(), billId: integer('bill_id').notNull().references(() => bills.id),
  projectId: integer('project_id').references(() => projects.id),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  description: text('description'), amount: money('amount').notNull(),
}, t => [index('bl_bill').on(t.billId)]);
export const overheadAllocations = pgTable('overhead_allocations', {
  id: id(), companyId: cid(), billId: integer('bill_id').notNull().references(() => bills.id),
  projectId: integer('project_id').notNull().references(() => projects.id), amount: money('amount').notNull(),
  method: text('method').notNull(), basis: text('basis'), createdBy: integer('created_by'), createdAt: created(),
});

/* ───────────── Accounts receivable: company-issued invoices ───────────── */
export const invoices = pgTable('invoices', {
  id: id(), companyId: cid(), number: text('number').notNull(),
  clientId: integer('client_id').notNull().references(() => clients.id), projectId: integer('project_id').references(() => projects.id),
  date: date('date').notNull(), dueDate: date('due_date'),
  taxRate: numeric('tax_rate', { precision: 7, scale: 4 }).notNull().default('0'),
  subtotal: money('subtotal').notNull(), taxAmount: money('tax_amount').notNull().default('0'), total: money('total').notNull(),
  amountPaid: money('amount_paid').notNull().default('0'), notes: text('notes'), paymentInstructions: text('payment_instructions'),
  status: text('status').notNull().default('open'), entryId: integer('entry_id'), createdBy: integer('created_by'), createdAt: created(),
}, t => [uniqueIndex('invoices_number').on(t.companyId, t.number)]);
export const invoiceLines = pgTable('invoice_lines', {
  id: id(), invoiceId: integer('invoice_id').notNull().references(() => invoices.id), description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull().default('1'), unitPrice: money('unit_price').notNull(),
  amount: money('amount').notNull(), taxable: boolean('taxable').notNull().default(false),
});

/* ───────────── Payments, checks, reconciliation ───────────── */
export const payments = pgTable('payments', {
  id: id(), companyId: cid(), direction: text('direction').notNull(), // out | in
  date: date('date').notNull(), amount: money('amount').notNull(),
  method: text('method').notNull(), // check | ach | card | cash | wire | other
  accountId: integer('account_id').notNull().references(() => accounts.id), // GL account money left / arrived in
  vendorId: integer('vendor_id'), clientId: integer('client_id'), reference: text('reference'), memo: text('memo'),
  status: text('status').notNull().default('posted'), // posted | void
  entryId: integer('entry_id'), createdBy: integer('created_by'), createdAt: created(),
});
export const paymentApps = pgTable('payment_apps', {
  id: id(), paymentId: integer('payment_id').notNull().references(() => payments.id),
  billId: integer('bill_id').references(() => bills.id), invoiceId: integer('invoice_id').references(() => invoices.id),
  amount: money('amount').notNull(),
}, t => [index('pa_bill').on(t.billId), index('pa_invoice').on(t.invoiceId), index('pa_payment').on(t.paymentId)]);
export const checks = pgTable('checks', {
  id: id(), companyId: cid(), bankAccountId: integer('bank_account_id').notNull().references(() => bankAccounts.id),
  number: integer('number').notNull(), date: date('date').notNull(), payee: text('payee').notNull(), payeeAddress: text('payee_address'),
  amount: money('amount').notNull(), memo: text('memo'),
  vendorId: integer('vendor_id').references(() => vendors.id), projectId: integer('project_id').references(() => projects.id),
  status: text('status').notNull().default('draft'), // draft | printed | issued | cleared | voided
  paymentId: integer('payment_id'), printCount: integer('print_count').notNull().default(0),
  printedAt: timestamp('printed_at', { withTimezone: true }), issuedAt: timestamp('issued_at', { withTimezone: true }),
  clearedAt: date('cleared_at'), voidedAt: timestamp('voided_at', { withTimezone: true }), voidReason: text('void_reason'),
  createdBy: integer('created_by'), createdAt: created(),
}, t => [uniqueIndex('checks_number').on(t.bankAccountId, t.number)]);
export const checkApps = pgTable('check_apps', {
  id: id(), checkId: integer('check_id').notNull().references(() => checks.id),
  billId: integer('bill_id').notNull().references(() => bills.id), amount: money('amount').notNull(),
});
export const reconciliations = pgTable('reconciliations', {
  id: id(), companyId: cid(), bankAccountId: integer('bank_account_id').notNull().references(() => bankAccounts.id),
  statementDate: date('statement_date').notNull(), beginningBalance: money('beginning_balance').notNull(), endingBalance: money('ending_balance').notNull(),
  status: text('status').notNull().default('open'), completedAt: timestamp('completed_at', { withTimezone: true }), completedBy: integer('completed_by'),
});
export const reconItems = pgTable('recon_items', {
  id: id(), reconciliationId: integer('reconciliation_id').notNull().references(() => reconciliations.id),
  journalLineId: integer('journal_line_id').notNull().references(() => journalLines.id).unique(),
});

/* ───────────── Lien waivers ───────────── */
export const lienWaivers = pgTable('lien_waivers', {
  id: id(), companyId: cid(), projectId: integer('project_id').notNull().references(() => projects.id),
  vendorId: integer('vendor_id').notNull().references(() => vendors.id), paymentId: integer('payment_id').references(() => payments.id),
  type: text('type').notNull(), amount: money('amount'), paymentDate: date('payment_date'),
  status: text('status').notNull().default('requested'), // requested | received | not_required
  receivedDate: date('received_date'), documentId: integer('document_id'), notes: text('notes'), createdAt: created(),
});

/* ───────────── Documents (content-addressed, many-to-many links) ───────────── */
export const blobs = pgTable('blobs', {
  id: id(), sha256: text('sha256').notNull().unique(), size: integer('size').notNull(), mime: text('mime').notNull(), storageKey: text('storage_key').notNull(),
});
export const documents = pgTable('documents', {
  id: id(), companyId: cid(), blobId: integer('blob_id').notNull().references(() => blobs.id), name: text('name').notNull(),
  description: text('description'), folder: text('folder').notNull().default('Miscellaneous'), tags: text('tags'),
  versionGroup: integer('version_group'), version: integer('version').notNull().default(1), isCurrent: boolean('is_current').notNull().default(true),
  uploadedBy: integer('uploaded_by'), uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
export const documentLinks = pgTable('document_links', {
  id: id(), documentId: integer('document_id').notNull().references(() => documents.id),
  entityType: text('entity_type').notNull(), // project | vendor | client | bill | invoice | check | waiver | payment
  entityId: integer('entity_id').notNull(),
}, t => [uniqueIndex('dl_unique').on(t.documentId, t.entityType, t.entityId), index('dl_entity').on(t.entityType, t.entityId)]);

/* ───────────── Mileage ───────────── */
export const vehicles = pgTable('vehicles', { id: id(), companyId: cid(), name: text('name').notNull(), active: boolean('active').notNull().default(true) });
export const mileageRates = pgTable('mileage_rates', {
  id: id(), companyId: cid(), effectiveFrom: date('effective_from').notNull(), rate: numeric('rate', { precision: 6, scale: 4 }).notNull(), note: text('note'),
}, t => [uniqueIndex('mr_unique').on(t.companyId, t.effectiveFrom)]);
export const mileageTrips = pgTable('mileage_trips', {
  id: id(), companyId: cid(), date: date('date').notNull(), origin: text('origin'), destination: text('destination'), purpose: text('purpose').notNull(),
  projectId: integer('project_id').references(() => projects.id), vehicleId: integer('vehicle_id').references(() => vehicles.id),
  odoStart: numeric('odo_start', { precision: 9, scale: 1 }), odoEnd: numeric('odo_end', { precision: 9, scale: 1 }),
  miles: numeric('miles', { precision: 8, scale: 1 }).notNull(), notes: text('notes'), createdBy: integer('created_by'), createdAt: created(),
});
