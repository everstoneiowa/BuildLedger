'use client';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const INK = '#5d6877', GRID = '#e6e8ec'; const S1 = '#2a78d6', S2 = '#eb6834', NEG = '#d03b3b';
const usd = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : `$${v.toFixed(0)}`);
const full = (v: any) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tip = { contentStyle: { border: '1px solid #dfe3e8', borderRadius: 6, fontSize: 12, boxShadow: 'none' }, cursor: { fill: 'rgba(15,30,50,.05)' } };
const Nothing = () => <div className="flex h-56 items-center justify-center text-sm text-muted">No activity in this period yet.</div>;

export function SpendingChart({ data }: { data: { period: string; direct: number; overhead: number }[] }) {
  if (!data.length) return <Nothing />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={{ stroke: '#c9ced6' }} />
        <YAxis tickFormatter={usd} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={full} {...tip} /><Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span style={{ color: INK }}>{v}</span>} />
        <Bar dataKey="direct" name="Project costs" stackId="a" fill={S1} stroke="#fff" strokeWidth={1} maxBarSize={36} />
        <Bar dataKey="overhead" name="Business overhead" stackId="a" fill={S2} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}
export function CategoryChart({ data }: { data: { category: string; amount: number }[] }) {
  if (!data.length) return <Nothing />;
  const top = data.slice(0, 10); const rest = data.slice(10).reduce((a, d) => a + d.amount, 0); const rows = rest > 0 ? [...top, { category: 'All other', amount: rest }] : top;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 26 + 30)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} /><XAxis type="number" tickFormatter={usd} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="category" width={138} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={{ stroke: '#c9ced6' }} />
        <Tooltip formatter={full} {...tip} /><Bar dataKey="amount" name="Spent" fill={S1} radius={[0, 4, 4, 0]} maxBarSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}
export function ProfitChart({ data }: { data: { project: string; profit: number }[] }) {
  if (!data.length) return <Nothing />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="project" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} interval={0} />
        <YAxis tickFormatter={usd} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} width={48} /><ReferenceLine y={0} stroke="#9aa3af" />
        <Tooltip formatter={full} {...tip} />
        <Bar dataKey="profit" name="Gross profit (revenue − cost)" radius={[4, 4, 0, 0]} maxBarSize={40}>{data.map((d, i) => <Cell key={i} fill={d.profit < 0 ? NEG : S1} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
