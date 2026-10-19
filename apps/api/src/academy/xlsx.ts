import {inflateRawSync} from 'node:zlib';

const MAX_ENTRIES=200,MAX_ENTRY_BYTES=5*1024*1024,MAX_TOTAL_BYTES=12*1024*1024;
const entity=(value:string)=>value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(d+);/g,(_m,n)=>String.fromCodePoint(Number(n)));
const attr=(input:string,name:string)=>new RegExp(`${name}="([^"]*)"`).exec(input)?.[1]??null;

/** ZIP reader limited to ordinary XLSX entries. It rejects encrypted, oversized and unsafe archives. */
export function readZip(input:Buffer){
  let end=-1;for(let i=input.length-22;i>=Math.max(0,input.length-65557);i--)if(input.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('XLSX sin directorio ZIP');
  const count=input.readUInt16LE(end+10),directoryOffset=input.readUInt32LE(end+16);
  if(count>MAX_ENTRIES||directoryOffset>=input.length)throw new Error('XLSX excede los límites permitidos');
  const files=new Map<string,Buffer>();let at=directoryOffset,total=0;
  for(let entry=0;entry<count;entry++){
    if(at+46>input.length||input.readUInt32LE(at)!==0x02014b50)throw new Error('Directorio XLSX inválido');
    const flags=input.readUInt16LE(at+8),method=input.readUInt16LE(at+10),compressed=input.readUInt32LE(at+20),size=input.readUInt32LE(at+24),nameSize=input.readUInt16LE(at+28),extraSize=input.readUInt16LE(at+30),commentSize=input.readUInt16LE(at+32),local=input.readUInt32LE(at+42);
    const name=input.subarray(at+46,at+46+nameSize).toString('utf8');at+=46+nameSize+extraSize+commentSize;
    if(flags&1||!name||name.includes('..')||name.startsWith('/')||(method!==0&&method!==8)||compressed>MAX_ENTRY_BYTES||size>MAX_ENTRY_BYTES||(total+=size)>MAX_TOTAL_BYTES)throw new Error('Entrada XLSX no permitida');
    if(local+30>input.length||input.readUInt32LE(local)!==0x04034b50)throw new Error('Entrada XLSX corrupta');
    const localName=input.readUInt16LE(local+26),localExtra=input.readUInt16LE(local+28),start=local+30+localName+localExtra,raw=input.subarray(start,start+compressed);
    let decoded:Buffer;try{decoded=method===0?raw:inflateRawSync(raw,{maxOutputLength:MAX_ENTRY_BYTES});}catch{throw new Error('Contenido XLSX excede el límite de descompresión');}
    if(decoded.length>MAX_ENTRY_BYTES||decoded.length!==size)throw new Error('Tamaño XLSX inconsistente');files.set(name,decoded);
  }return files;
}
function textFromXml(value:string){return entity(value.replace(/<[^>]+>/g,''));}
function column(ref:string){return ref.replace(/[0-9]/g,'');}

export type ExtractedSheet={name:string;rows:Array<Record<string,string>>};
export function extractXlsxTables(input:Buffer):ExtractedSheet[]{
  const zip=readZip(input),get=(name:string)=>zip.get(name)?.toString('utf8')??'';
  const shared=[...get('xl/sharedStrings.xml').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>textFromXml(m[1]!));
  const relations=new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s+([^>]+)\/?>(?:<\/Relationship>)?/g)].map(m=>[attr(m[1]!,'Id')!,attr(m[1]!,'Target')!]));
  const sheets=[...get('xl/workbook.xml').matchAll(/<sheet\s+([^>]+)\/?>(?:<\/sheet>)?/g)].map(m=>({name:entity(attr(m[1]!,'name')??'Hoja'),id:attr(m[1]!,'r:id')}));
  return sheets.map(sheet=>{
    const target=sheet.id?relations.get(sheet.id):null;if(!target)throw new Error('Hoja XLSX sin relación');
    const xml=get('xl/'+target.replace(/^\//,''));if(!xml)throw new Error('Hoja XLSX ausente');
    const rows:Array<Record<string,string>>=[];
    for(const match of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)){
      const row:Record<string,string>={};
      for(const cell of match[1]!.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
        const ref=attr(cell[1]!,'r'),type=attr(cell[1]!,'t'),body=cell[2]??'';if(!ref)continue;
        const raw=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]??'';const inline=/<is>([\s\S]*?)<\/is>/.exec(body)?.[1]??'';
        row[column(ref)]=type==='s'?shared[Number(raw)]??'':type==='inlineStr'?textFromXml(inline):entity(raw);
      }if(Object.keys(row).length)rows.push(row);
    }return {name:sheet.name,rows};
  });
}
