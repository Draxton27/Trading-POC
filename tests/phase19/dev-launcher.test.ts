import {describe,it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
// @ts-ignore - the launcher is intentionally a directly executable .mjs script.
import {npmCli,assertPortsFree,startDev} from '../../scripts/dev.mjs';

describe('iniciador Windows',()=>{
  it('acepta una ruta npm-cli con espacios y nunca usa shell para lanzar npm',()=>{
    const dir=mkdtempSync(join(tmpdir(),'Trading POC spaces '));
    try{
      const path=join(dir,'node modules');mkdirSync(path);
      const cli=join(path,'npm-cli.js');writeFileSync(cli,'');
      expect(npmCli({npm_execpath:cli},process.execPath)).toBe(cli);
      const calls:Array<{cmd:string;args:string[];options:Record<string,unknown>}>=[];
      class Child extends EventEmitter{pid=12345;exitCode:null|number=null;signalCode:null|string=null;kill(){} }
      const children=[new Child(),new Child()];
      const spawnProcess=(cmd:string,args:string[],options:Record<string,unknown>)=>{
        calls.push({cmd,args,options});return children[calls.length-1]??new Child();
      };
      const runner=startDev({env:{npm_execpath:cli},spawnProcess});
      expect(calls.slice(0,2).map(c=>c.cmd)).toEqual([process.execPath,process.execPath]);
      expect(calls.slice(0,2).every(c=>c.args[0]===cli&&c.options.shell===false)).toBe(true);
      runner.stop();children.forEach(c=>{c.exitCode=0;c.emit('close',0,null);});
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('se detiene antes de duplicar un servidor en un puerto ocupado',async()=>{
    const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address();if(!address||typeof address==='string')throw new Error('Sin puerto');
      await expect(assertPortsFree({TRADING_POC_API_PORT:String(address.port),TRADING_POC_WEB_PORT:'5173'}))
        .rejects.toThrow(/Puerto API/);
    }finally{server.close();}
  });
  it('si un hijo falla, detiene el otro y propaga el código',()=>{
    const dir=mkdtempSync(join(tmpdir(),'Trading POC child '));
    const priorExit=process.exitCode;
    try{
      const cli=join(dir,'npm-cli.js');writeFileSync(cli,'');
      class Child extends EventEmitter{pid=12001;exitCode:null|number=null;signalCode:null|string=null;killCalled=false;
        kill(){this.killCalled=true;}}
      const children=[new Child(),new Child()],killers:Child[]=[],calls:string[]=[];
      const spawnProcess=(cmd:string)=>{calls.push(cmd);const child=children[calls.length-1];
        if(child)return child;const killer=new Child();killers.push(killer);return killer;};
      startDev({env:{npm_execpath:cli},spawnProcess});
      children[0]!.exitCode=7;children[0]!.emit('close',7,null);
      expect(process.platform==='win32'?calls.includes('taskkill.exe'):children[1]!.killCalled).toBe(true);
      if(process.platform==='win32'){killers[0]!.emit('close',1,null);expect(children[1]!.killCalled).toBe(true);}
      children[1]!.exitCode=0;children[1]!.emit('close',0,null);
      expect(process.exitCode).toBe(7);
    }finally{process.exitCode=priorExit;rmSync(dir,{recursive:true,force:true});}
  });
});
