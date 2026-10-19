import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openDatabase} from '../persistence/db.ts';
import {importAcademyDocument} from './importer.ts';

const args=process.argv.slice(2),existingOnly=args.includes('--existing-only'),positional=args.filter(arg=>arg!=='--existing-only');
const source=positional[0];if(!source||positional.length>2||positional.some(arg=>arg.startsWith('--')))throw new Error('Uso: npm run academy:import -- [--existing-only] <documento.xlsx|csv|html> [nombre]');
const privateDir=process.env.TRADING_POC_PRIVATE_DIR?resolve(process.env.TRADING_POC_PRIVATE_DIR):
  process.platform==='win32'&&process.env.LOCALAPPDATA?resolve(process.env.LOCALAPPDATA,'Trading-POC'):resolve('private');
const db=openDatabase(process.env.TRADING_POC_DB_PATH??resolve(privateDir,'trading-poc.sqlite'));
try{const result=importAcademyDocument(db.sqlite,readFileSync(source),positional[1]??source,undefined,{existingOnly});console.log(JSON.stringify(result));}finally{db.sqlite.close();}
