import {createConnection} from 'node:net';

const port=Number(process.env.TRADING_POC_WEB_PORT);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('TRADING_POC_WEB_PORT debe ser un puerto vÃ¡lido.');

const canConnect=()=>new Promise(resolve=>{
  const socket=createConnection({host:'127.0.0.1',port});
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',()=>{socket.destroy();resolve(false);});
});

const deadline=Date.now()+30_000;
while(Date.now()<deadline){
  if(await canConnect()){
    console.error('El servicio web ya estaba disponible; fallo intencional del fixture.');
    process.exitCode=1;
    break;
  }
  await new Promise(resolve=>setTimeout(resolve,100));
}

if(process.exitCode!==1)throw new Error('Vite no estuvo disponible antes del lÃ­mite del fixture.');
