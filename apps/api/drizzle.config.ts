import {defineConfig} from 'drizzle-kit';
export default defineConfig({schema:'./apps/api/src/persistence/schema.ts',out:'./apps/api/drizzle',dialect:'sqlite',dbCredentials:{url:process.env.TRADING_POC_DB_PATH??'./private/trading-poc.sqlite'}});
