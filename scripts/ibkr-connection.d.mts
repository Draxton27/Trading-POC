export type IbkrConnection={connectionApplication:'TWS_PAPER'|'GATEWAY_PAPER';host:string;port:number;
  clientId:number;expectedPaperAccount:string;environment:'PAPER'};
export function resolveIbkrConnection(env?:NodeJS.ProcessEnv,application?:string):IbkrConnection;
