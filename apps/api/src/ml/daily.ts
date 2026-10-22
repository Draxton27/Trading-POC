import {spawnSync} from 'node:child_process';
import {dailyStatePath,readDailyState} from '../../../../scripts/daily-orchestrator.ts';

export function readDailyAutomation(){
  let installed=false;
  if(process.platform==='win32'){
    const query=spawnSync('schtasks.exe',['/Query','/TN','Trading-POC Daily Research'],{windowsHide:true,stdio:'ignore',timeout:3000});
    installed=query.status===0;
  }
  try{
    const row=readDailyState(dailyStatePath());
    return {installed,lastRunAtUtc:row?.lastRunAtUtc??null,lastSessionNy:row?.lastSessionNy??null,nextSessionNy:row?.nextSessionNy??null,pendingErrors:row?.pendingErrors??[],barsReceived:row?.barsReceived??0,newPredictions:row?.newPredictions??0,evaluationsCompleted:row?.evaluationsCompleted??0,newsCollected:row?.newsCollected??0,classifications:row?.classifications??0};
  }catch{return {installed,lastRunAtUtc:null,lastSessionNy:null,nextSessionNy:null,pendingErrors:['STATE_INVALID'],barsReceived:0,newPredictions:0,evaluationsCompleted:0,newsCollected:0,classifications:0};}
}
