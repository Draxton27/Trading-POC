import {spawn} from 'node:child_process';
const npm=process.platform==='win32'?'npm.cmd':'npm';
const children=['dev:api','dev:web'].map(name=>spawn(npm,['run',name],{stdio:'inherit',shell:false,env:process.env}));
for(const child of children)child.on('exit',code=>{if(code&&code!==0){for(const other of children)if(other!==child)other.kill();process.exitCode=code;}});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{for(const child of children)child.kill(sig);});
