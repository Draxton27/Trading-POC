export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
  const headers:Record<string,string>={'Accept':'application/json',...(options.headers as Record<string,string>??{})};
  if(options.method&&options.method!=='GET'){
    const session=await fetch('/api/v1/session').then(r=>r.json());
    headers['x-local-token']=session.token;headers['Content-Type']='application/json';
  }
  const response=await fetch('/api/v1'+path,{...options,headers});
  const body=await response.json();
  if(!response.ok)throw new Error(body.error??'Error de servicio');
  return body as T;
}
export const fmt=(n:number|null|undefined,digits=2)=>n==null||!Number.isFinite(n)?'—':n.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits});
export const dateTime=(iso:string|null|undefined)=>iso?new Intl.DateTimeFormat('es-ES',{timeZone:'America/New_York',dateStyle:'short',timeStyle:'short'}).format(new Date(iso))+' NY':'—';
