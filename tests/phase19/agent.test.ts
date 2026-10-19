import {describe,it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {AgentHub} from '../../apps/api/src/streams/agent-hub.ts';
import {AgentTransport} from '../../apps/ibkr-agent/src/transport/client.ts';
import {MockReadOnlyAdapter} from '../../apps/ibkr-agent/src/connection/mock.ts';
import {TwsReadOnlyAdapter} from '../../apps/ibkr-agent/src/connection/tws.ts';

class FakeSocket extends EventEmitter{
  readyState=1;sent:string[]=[];closedCode:number|null=null;
  send(value:string){this.sent.push(value);}close(code?:number){this.closedCode=code??1000;this.readyState=3;this.emit('close');}
}
const envelope=(kind:string,sequence:number,connectionId:string,payload:Record<string,unknown>={},requestId:string|null=null)=>({protocolVersion:1,messageId:crypto.randomUUID(),requestId,agentId:'agent-a',connectionId,sequence,issuedAtUtc:new Date().toISOString(),kind,payload});
describe('canal privado de agente',()=>{
  it('exige secreto independiente y PAPER verificado',()=>{
    const hub=new AgentHub('secret');expect(hub.authorize('Bearer wrong')).toBe(false);expect(hub.authorize('Bearer secret')).toBe(true);
    const socket=new FakeSocket(),connectionId=crypto.randomUUID();hub.attach(socket);
    socket.emit('message',JSON.stringify(envelope('agent.hello',0,connectionId,{environment:'LIVE',accountVerified:true})));
    expect(socket.closedCode).toBe(1008);expect(hub.status().connected).toBe(false);
  });
  it('rechaza comandos de orden, replay y cotización inválida',()=>{
    const hub=new AgentHub('secret'),socket=new FakeSocket(),id=crypto.randomUUID();hub.attach(socket);
    socket.emit('message',JSON.stringify(envelope('agent.hello',0,id,{environment:'PAPER',accountVerified:true})));
    expect(hub.status().environment).toBe('PAPER');
    socket.emit('message',JSON.stringify(envelope('order.place',1,id,{})));expect(socket.closedCode).toBe(1008);
    const second=new FakeSocket(),id2=crypto.randomUUID();hub.attach(second);
    second.emit('message',JSON.stringify(envelope('agent.hello',0,id2,{environment:'PAPER',accountVerified:true})));
    second.emit('message',JSON.stringify(envelope('market.quote',1,id2,{symbol:'NVDA',bid:-1})));expect(second.closedCode).toBe(1008);
  });
  it('correlaciona solicitudes permitidas y corta al desconectar',async()=>{
    const hub=new AgentHub('secret'),socket=new FakeSocket(),id=crypto.randomUUID();hub.attach(socket);
    socket.emit('message',JSON.stringify(envelope('agent.hello',0,id,{environment:'PAPER',accountVerified:true})));
    const pending=hub.request('broker.positions.request',{});
    const sent=JSON.parse(socket.sent[0]!);
    socket.emit('message',JSON.stringify(envelope('broker.positions.snapshot',1,id,{items:[]},sent.requestId)));
    expect((await pending).kind).toBe('broker.positions.snapshot');
    socket.emit('message',JSON.stringify(envelope('agent.heartbeat',1,id,{})));expect(socket.closedCode).toBe(1008);
  });
  it('bloquea transporte no privado',()=>{
    expect(()=>new AgentTransport(new MockReadOnlyAdapter(),{url:'ws://public.example/agent/v1/connect',agentId:'a',secret:'s'})).toThrow(/privada/);
    expect(()=>new AgentTransport(new MockReadOnlyAdapter(),{url:'wss://public.example/agent/v1/connect',agentId:'a',secret:'s'})).toThrow(/privada/);
    expect(()=>new TwsReadOnlyAdapter({host:'0.0.0.0',port:7497,clientId:119,expectedPaperAccount:'synthetic',aliasSecret:'synthetic'})).toThrow(/loopback/);
  });
  it('reconcilia suscripciones después de una reconexión sin inventar ticks',async()=>{
    const hub=new AgentHub('secret'),first=new FakeSocket(),id1=crypto.randomUUID();hub.attach(first);
    first.emit('message',JSON.stringify(envelope('agent.hello',0,id1,{environment:'PAPER',accountVerified:true})));
    const pending=hub.request('market.subscribe',{symbol:'NVDA'});
    const request=JSON.parse(first.sent[0]!);
    first.emit('message',JSON.stringify(envelope('agent.status',1,id1,{subscribed:'NVDA'},request.requestId)));
    await pending;first.close();
    const second=new FakeSocket(),id2=crypto.randomUUID();hub.attach(second);
    second.emit('message',JSON.stringify(envelope('agent.hello',0,id2,{environment:'PAPER',accountVerified:true})));
    await new Promise(r=>setTimeout(r,0));
    expect(JSON.parse(second.sent[0]!).kind).toBe('market.subscribe');
    expect(JSON.parse(second.sent[0]!).payload).toEqual({symbol:'NVDA'});
    expect(hub.latestQuote('NVDA')).toBeNull();
    second.close();
  });
  it('comparte suscripciones simultáneas y cancela solo al salir el último consumidor',async()=>{
    const hub=new AgentHub('secret'),socket=new FakeSocket(),id=crypto.randomUUID();hub.attach(socket);
    socket.emit('message',JSON.stringify(envelope('agent.hello',0,id,{environment:'PAPER',accountVerified:true})));
    const a=hub.subscribe({symbol:'NVDA'},'a'),b=hub.subscribe({symbol:'NVDA'},'b');
    expect(socket.sent).toHaveLength(1);
    const subscribe=JSON.parse(socket.sent[0]!);
    socket.emit('message',JSON.stringify(envelope('agent.status',1,id,{subscribed:'NVDA'},subscribe.requestId)));
    await Promise.all([a,b]);
    await hub.release('NVDA','a');expect(socket.sent).toHaveLength(1);
    await hub.release('NVDA','intruso');expect(socket.sent).toHaveLength(1);
    const release=hub.release('NVDA','b');expect(socket.sent).toHaveLength(2);
    const unsubscribe=JSON.parse(socket.sent[1]!);
    socket.emit('message',JSON.stringify(envelope('agent.status',2,id,{unsubscribed:'NVDA'},unsubscribe.requestId)));
    await release;expect(hub.status().subscriptions).toEqual([]);
  });
  it('rechaza respuestas con tipo equivocado y relojes fuera de ventana',async()=>{
    const hub=new AgentHub('secret'),socket=new FakeSocket(),id=crypto.randomUUID();hub.attach(socket);
    socket.emit('message',JSON.stringify(envelope('agent.hello',0,id,{environment:'PAPER',accountVerified:true})));
    const pending=hub.request('broker.positions.request',{});
    const sent=JSON.parse(socket.sent[0]!);
    socket.emit('message',JSON.stringify(envelope('option.parameters',1,id,{items:[]},sent.requestId)));
    expect(socket.closedCode).toBe(1008);await expect(pending).rejects.toThrow(/desconectado/);
    const next=new FakeSocket(),nextId=crypto.randomUUID();hub.attach(next);
    next.emit('message',JSON.stringify({...envelope('agent.hello',0,nextId,{environment:'PAPER',accountVerified:true}),issuedAtUtc:'2020-01-01T00:00:00.000Z'}));
    expect(next.closedCode).toBe(1008);
  });
});
