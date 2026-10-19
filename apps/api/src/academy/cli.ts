import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openDatabase} from '../persistence/db.ts';
import {importAcademyDocument} from './importer.ts';

const source=process.argv[2];if(!source)throw new Error('Uso: npm run academy:import -- <documento.xlsx|csv|html>');
const privateDir=process.env.TRADING_POC_PRIVATE_DIR?resolve(process.env.TRADING_POC_PRIVATE_DIR):
  process.platform==='win32'&&process.env.LOCALAPPDATA?resolve(process.env.LOCALAPPDATA,'Trading-POC'):resolve('private');
const db=openDatabase(process.env.TRADING_POC_DB_PATH??resolve(privateDir,'trading-poc.sqlite'));
try{const result=importAcademyDocument(db.sqlite,readFileSync(source),process.argv[3]??source);console.log(JSON.stringify(result));}finally{db.sqlite.close();}
