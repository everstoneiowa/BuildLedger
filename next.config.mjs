/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'exceljs', 'pdf-lib', '@pdf-lib/fontkit'],
  outputFileTracingIncludes: { '/**': ['./drizzle/**'] },
};
export default config;
