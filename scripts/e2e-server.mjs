import {createServer} from 'node:http';
import {assertPortsFree,startDev} from './dev.mjs';

const port=Number(process.env.TRADING_POC_E2E_CONTROL_PORT);
const token=process.env.TRADING_POC_E2E_CONTROL_TOKEN;
if(!Number.isInteger(port)||port<1||port>65535||!token||token.length<32)throw new Error('Control E2E no configurado.');
await assertPortsFree();
const launcher=startDev({directApi:true});
let stopping=false;
const control=createServer((request,response)=>{
  if(request.method!=='POST'||request.url!=='/stop'||request.headers['x-e2e-token']!==token){response.writeHead(404).end();return;}
  if(stopping){response.writeHead(409).end();return;}
  stopping=true;
  void launcher.stop(0).then(()=>{
    response.writeHead(200,{'Content-Type':'application/json'}).end('{"stopped":true}');
    control.close();
  });
});
control.listen(port,'127.0.0.1');
await launcher.completion;
control.close();
