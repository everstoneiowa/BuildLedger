import { type DB, type Ctx, schema } from '@/db';
import { hashPassword } from '@/lib/crypto';

export const PROJECT_CATEGORIES = ['Land & Lot', 'Permits & Fees', 'Site Work & Excavation', 'Foundation', 'Concrete & Flatwork', 'Framing', 'Roofing', 'Windows & Doors', 'Siding & Exterior', 'Electrical', 'Plumbing', 'HVAC', 'Insulation', 'Drywall', 'Flooring', 'Cabinets & Countertops', 'Painting', 'Trim & Finish Carpentry', 'Appliances', 'Landscaping', 'Cleanup & Dumpsters', 'Other Project Costs'];
const OVERHEAD: [string, string][] = [['6010', 'Office Supplies'], ['6020', 'Software Subscriptions'], ['6030', 'Vehicle Maintenance & Fuel'], ['6040', 'Insurance'], ['6050', 'Advertising'], ['6060', 'Tools & Equipment'], ['6070', 'Business Meals'], ['6080', 'Professional Services'], ['6090', 'Utilities'], ['6100', 'Licensing & Permits'], ['6110', 'Bank Fees & Interest'], ['6900', 'Miscellaneous Overhead']];
export const DEFAULT_WAIVER_TYPES = ['Conditional – Progress Payment', 'Unconditional – Progress Payment', 'Conditional – Final Payment', 'Unconditional – Final Payment'];
export const FOLDERS = ['Financial Documents', 'Blueprints & Plans', 'Permits & Inspections', 'Contracts', 'Quotes & Estimates', 'Lien Waivers', 'Vendor Documents', 'Correspondence', 'Project Photos', 'Miscellaneous'];

/** First-run setup: company, owner user, chart of accounts, categories, default jurisdiction, mileage rates. */
export async function createCompany(db: DB, input: { companyName: string; userName: string; email: string; password: string }): Promise<Ctx> {
  return db.transaction(async tx => {
    const [co] = await tx.insert(schema.companies).values({ name: input.companyName }).returning();
    const [u] = await tx.insert(schema.users).values({ companyId: co.id, email: input.email.toLowerCase().trim(), name: input.userName, passwordHash: hashPassword(input.password), role: 'owner', canPrintChecks: true }).returning();
    const acct = (code: string, name: string, type: string, subtype: string | null = null, system = false) => ({ companyId: co.id, code, name, type, subtype, system });
    const inserted = await tx.insert(schema.accounts).values([
      acct('1000', 'Operating Checking', 'asset', 'bank'),
      acct('1200', 'Accounts Receivable', 'asset', 'ar', true),
      acct('2000', 'Accounts Payable', 'liability', 'ap', true),
      acct('2100', 'Company Credit Card', 'liability', 'credit_card'),
      acct('2200', 'Sales Tax Payable', 'liability', 'sales_tax', true),
      acct('3000', "Owner's Equity", 'equity', 'retained', true),
      acct('3100', 'Owner Contributions (paid personally)', 'equity', 'owner', true),
      acct('4000', 'Construction & Home Sales Revenue', 'revenue', null, true),
      acct('4900', 'Other Income', 'revenue'),
      acct('5000', 'Direct Construction Costs', 'cogs', null, true),
      ...OVERHEAD.map(([code, name]) => acct(code, name, 'expense')),
    ]).returning();
    const byCode = Object.fromEntries(inserted.map(a => [a.code, a.id]));
    await tx.insert(schema.bankAccounts).values({ companyId: co.id, accountId: byCode['1000'], name: 'Operating Checking' });
    await tx.insert(schema.categories).values([
      ...PROJECT_CATEGORIES.map((name, i) => ({ companyId: co.id, name, kind: 'project', accountId: byCode['5000'], sort: i })),
      ...OVERHEAD.map(([code, name], i) => ({ companyId: co.id, name, kind: 'overhead', accountId: byCode[code], sort: i })),
    ]);
    await tx.insert(schema.jurisdictions).values({ companyId: co.id, name: 'Default', waiverTypes: DEFAULT_WAIVER_TYPES, notes: 'Generic waiver types. Add a jurisdiction per state and confirm the statutory forms and rules with your attorney.' });
    await tx.insert(schema.mileageRates).values([
      { companyId: co.id, effectiveFrom: '2024-01-01', rate: '0.6700', note: 'IRS standard business rate 2024' },
      { companyId: co.id, effectiveFrom: '2025-01-01', rate: '0.7000', note: 'IRS standard business rate 2025' },
      { companyId: co.id, effectiveFrom: '2026-01-01', rate: '0.7250', note: 'IRS Notice 2026-10 — confirm any mid-year change at irs.gov' },
    ]);
    await tx.insert(schema.vehicles).values({ companyId: co.id, name: 'Primary vehicle' });
    await tx.insert(schema.auditLog).values({ companyId: co.id, userId: u.id, action: 'create', entityType: 'company', entityId: co.id, summary: `Company "${co.name}" set up` });
    return { db, companyId: co.id, userId: u.id };
  });
}
