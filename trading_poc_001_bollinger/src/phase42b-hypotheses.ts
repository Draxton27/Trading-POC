/** Descriptive comparisons only. None establishes intent, a retest, or an Investep strategy. */
export function compareHypotheses(input:{lastClose:number|null;vwap:number|null;bbUpper:number|null;bbLower:number|null;
  relative:Record<string,number|null>}){
  const observed:{kind:string;relation:string}[]=[],supporting:{hypothesis:string;observation:string;limitation:string}[]=[],
    contradictory:{hypothesis:string;observation:string;limitation:string}[]=[];
  if(input.lastClose!==null&&input.vwap!==null){
    const relation=input.lastClose>input.vwap?'ENCIMA':input.lastClose<input.vwap?'DEBAJO':'IGUAL';
    observed.push({kind:'CIERRE_VS_VWAP',relation});
    if(relation==='ENCIMA')supporting.push({hypothesis:'CONTEXTO_VWAP',observation:'CIERRE_ENCIMA_VWAP',limitation:'NO_PRUEBA_TOQUE_NI_RETESTEO'});
    if(relation==='DEBAJO')contradictory.push({hypothesis:'CONTEXTO_VWAP',observation:'CIERRE_DEBAJO_VWAP',limitation:'NO_DESCARTA_APOYO_ANTERIOR'});
  }
  if(input.lastClose!==null&&input.bbUpper!==null&&input.bbLower!==null){
    observed.push({kind:'CIERRE_VS_BOLLINGER',relation:input.lastClose>input.bbUpper?'ENCIMA':input.lastClose<input.bbLower?'DEBAJO':
      input.lastClose===input.bbUpper||input.lastClose===input.bbLower?'EN_BANDA':'DENTRO'});
  }
  for(const [benchmark,value] of Object.entries(input.relative)){
    if(value===null)continue;const relation=value>0?'MAYOR':value<0?'MENOR':'IGUAL';observed.push({kind:`RETORNO_VS_${benchmark}`,relation});
    const evidence={hypothesis:'FORTALEZA_RELATIVA',observation:`RETORNO_${relation}_QUE_${benchmark}`,limitation:'DESDE_APERTURA_NO_PRUEBA_MOTIVACION'};
    if(value>0)supporting.push(evidence);else if(value<0)contradictory.push(evidence);
  }
  return {status:'RETROSPECTIVO_NO_POINT_IN_TIME',observed,supportingEvidence:supporting,contradictingEvidence:contradictory,
    alternativesWithoutEvidence:['CATALIZADOR','RETESTEO','APERTURA_ANTICIPATORIA','PROMEDIADO'],laterEvolution:null};
}
