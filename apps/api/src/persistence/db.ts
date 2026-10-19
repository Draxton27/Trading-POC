import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export function openDatabase(path=process.env.TRADING_POC_DB_PATH??resolve('private/trading-poc.sqlite')){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const sqlite=new Database(path);sqlite.pragma('journal_mode = WAL');sqlite.pragma('foreign_keys = ON');
  const db=drizzle(sqlite,{schema});
  migrate(db,{migrationsFolder:fileURLToPath(new URL('../../drizzle/',import.meta.url))});
  return {sqlite,db};
}
