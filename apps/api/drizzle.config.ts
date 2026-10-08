import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: '../../packages/schema/src/tables.ts',
  out: './drizzle',
});
