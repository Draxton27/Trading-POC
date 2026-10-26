import {test,expect} from '@playwright/test';

test('El dashboard 41J muestra ausencia de datos sin depender del modelo histórico',async({page})=>{
  await page.route('**/api/v1/ml/status',route=>route.fulfill({json:{status:'NO_MODEL',reason:'No configurado',experimentId:null}}));
  await page.route('**/api/v1/ml/iex/prospective/overview',route=>route.fulfill({json:{
    status:'NO_PROSPECTIVE_DATA',reason:'Sin predicciones verificadas',evidenceStatus:'NO_PROSPECTIVE_DATA',
    protocolVersion:'41I v2',modelLabel:'XGBoost 38F',symbol:'NVDA',timeframe:'15m',feed:'IEX Live',adjustment:'raw',
    experimental:true,activatedAtUtc:'2026-10-26T13:00:00.000Z',protocolSha256:'a'.repeat(64),modelSha256:'b'.repeat(64),
    predictions:0,evaluated:0,pending:0,overdue:0,nonEvaluable:0,sessionsWithResults:0,
    lastPredictionAtUtc:null,lastEvaluationAtUtc:null,receivedCompleteBars:0,expectedCompleteBars:0,coverage:null,marketStatus:'MARKET_CLOSED'}}));
  await page.route('**/api/v1/ml/iex/prospective/history?*',route=>route.fulfill({json:{
    status:'NO_PROSPECTIVE_DATA',items:[],total:0,offset:0,limit:25,nextOffset:null}}));
  await page.route('**/api/v1/ml/iex/prospective/coverage',route=>route.fulfill({json:{
    status:'NO_PROSPECTIVE_DATA',decisionRecords:0,candidateBars:0,admittedBars:0,finallyNotAdmitted:0,
    failedAttemptsBeforeRecovery:0,abstentionsByReason:{},expectedCompleteBars:0,receivedCompleteBars:0,
    scheduledSessions:0,sessionsWithCapture:0,coverage:null,marketStatus:'MARKET_CLOSED',reason:'Sin captura.'}}));
  await page.route('**/api/v1/ml/iex/prospective/metrics',route=>route.fulfill({json:{
    status:'NO_PROSPECTIVE_DATA',snapshotStatus:'NO_SNAPSHOT',reportStatus:null,generatedAtUtc:null,
    evaluatedInSnapshot:0,scores:null,warning:'Sin métricas verificadas.'}}));
  await page.goto('/');await page.getByRole('button',{name:'Predicciones'}).click();
  await expect(page.getByRole('heading',{name:'Predicciones prospectivas IEX'})).toBeVisible();
  await expect(page.getByText('Todavía no existen predicciones prospectivas verificadas.')).toBeVisible();
  await expect(page.getByRole('table',{name:'Predicciones prospectivas IEX'}).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText('Aún no hay métricas prospectivas verificadas para comparar.')).toBeVisible();
  await expect(page.getByText('Modelo no configurado')).toBeVisible();
});
test('El historial 41J muestra probabilidades y estado pendiente sin señal operativa',async({page})=>{
  const item={predictionId:'c'.repeat(64),sessionDateNy:'2026-10-26',barStartUtc:'2026-10-26T14:00:00.000Z',
    barEndUtc:'2026-10-26T14:15:00.000Z',receivedAtUtc:'2026-10-26T14:15:05.000Z',
    registeredAtUtc:'2026-10-26T14:16:00.000Z',entryAtUtc:'2026-10-26T14:30:00.000Z',
    outcomeAtUtc:'2026-10-26T15:30:00.000Z',modelSha256:'b'.repeat(64),protocolSha256:'a'.repeat(64),
    probabilities:{xgboost:{ALCISTA:.2,BAJISTA:.3,LATERAL:.5},linear:{ALCISTA:.3,BAJISTA:.3,LATERAL:.4},
      frequency:{ALCISTA:.4,BAJISTA:.3,LATERAL:.3}},dominantClass:'LATERAL',evaluationStatus:'PENDING',
    actualClass:null,evaluatedAtUtc:null,entryOpen:null,outcomeClose:null,movementAtr:null,
    matches:{xgboost:null,linear:null,frequency:null}};
  await page.route('**/api/v1/ml/iex/prospective/overview',route=>route.fulfill({json:{
    status:'READY',reason:'Cohorte verificable',evidenceStatus:'COLLECTING',protocolVersion:'41I v2',
    modelLabel:'XGBoost 38F',symbol:'NVDA',timeframe:'15m',feed:'IEX Live',adjustment:'raw',experimental:true,
    activatedAtUtc:'2026-10-25T19:56:54.006Z',protocolSha256:'a'.repeat(64),modelSha256:'b'.repeat(64),
    predictions:1,evaluated:0,pending:1,overdue:0,nonEvaluable:0,sessionsWithResults:0,
    lastPredictionAtUtc:item.registeredAtUtc,lastEvaluationAtUtc:null,receivedCompleteBars:10,
    expectedCompleteBars:26,coverage:10/26,marketStatus:'OPEN'}}));
  await page.route('**/api/v1/ml/iex/prospective/history?*',route=>{
    const query=new URL(route.request().url()).searchParams,filtered=query.has('actualClass');
    return route.fulfill({json:{status:'READY',items:filtered?[]:[item],total:filtered?0:1,offset:0,
      limit:Number(query.get('limit')??25),nextOffset:null}});
  });
  await page.route(`**/api/v1/ml/iex/prospective/history/${item.predictionId}`,route=>route.fulfill({json:{
    status:'READY',item:{...item,predictionRecordHash:'d'.repeat(64),featureHash:'e'.repeat(64),
      atr14PriceUnits:.5,sourceBarCount:21,sourceBars:[]}}}));
  await page.route('**/api/v1/ml/iex/prospective/coverage',route=>route.fulfill({json:{
    status:'READY',decisionRecords:1,candidateBars:1,admittedBars:1,finallyNotAdmitted:0,
    failedAttemptsBeforeRecovery:0,abstentionsByReason:{},expectedCompleteBars:26,receivedCompleteBars:10,
    scheduledSessions:1,sessionsWithCapture:1,coverage:10/26,marketStatus:'OPEN',reason:'Captura parcial.'}}));
  await page.route('**/api/v1/ml/iex/prospective/metrics',route=>route.fulfill({json:{
    status:'READY',snapshotStatus:'NO_SNAPSHOT',reportStatus:null,generatedAtUtc:null,
    evaluatedInSnapshot:0,scores:null,warning:'Evaluación pendiente.'}}));
  await page.goto('/');await page.getByRole('button',{name:'Predicciones'}).click();
  await expect(page.getByRole('table',{name:'Predicciones prospectivas IEX'}).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('table',{name:'Predicciones prospectivas IEX'}).getByText('PENDING')).toBeVisible();
  await expect(page.getByRole('region',{name:'Dashboard prospectivo IEX'}).getByText('probabilidades no calibradas para uso operativo.',{exact:false})).toBeVisible();
  await expect(page.getByText('Aún no hay métricas prospectivas verificadas para comparar.')).toBeVisible();
  await page.getByRole('table',{name:'Predicciones prospectivas IEX'}).getByRole('button',{name:'Ver'}).click();
  await expect(page.getByRole('table',{name:'Comparación pareada de modelos IEX'}).locator('tbody tr')).toHaveCount(3);
  await expect(page.getByRole('region',{name:'Dashboard prospectivo IEX'}).getByRole('button',{name:/comprar|vender|CALL|PUT/i})).toHaveCount(0);
  await page.getByLabel('Clase real').selectOption('BAJISTA');
  await expect(page.getByRole('table',{name:'Predicciones prospectivas IEX'}).getByText('No hay predicciones para este período y filtros.')).toBeVisible();
});
test('El dashboard 41J presenta error de API controlado',async({page})=>{
  await page.route('**/api/v1/ml/iex/prospective/overview',route=>route.fulfill({status:503,json:{error:'Servicio no disponible'}}));
  await page.goto('/');await page.getByRole('button',{name:'Predicciones'}).click();
  await expect(page.getByRole('region',{name:'Dashboard prospectivo IEX'}).getByRole('alert').getByText('No se pudo leer el estado prospectivo.')).toBeVisible();
});

const metrics={accuracy:.5,balancedAccuracy:.5,macroF1:.5,logLoss:1.1,perClass:{ALCISTA:{precision:.5,recall:.5,f1:.5,support:1},BAJISTA:{precision:.5,recall:.5,f1:.5,support:1},LATERAL:{precision:.5,recall:.5,f1:.5,support:1}}};
test('Predicciones muestra modelo ausente y el aviso estadístico en DEMO',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Predicciones'}).click();
  await expect(page.getByText('Modelo no configurado')).toBeVisible();
  await expect(page.getByText('Modelo experimental. Evaluación retrospectiva no independiente. Probabilidades no calibradas para uso operativo. No constituye recomendación CALL o PUT.')).toBeVisible();
  await expect(page.getByRole('table',{name:'Predicciones históricas'})).toHaveCount(0);
});
test('Feeds experimentales distinguen IEX de SIP sin fabricar datos en DEMO',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Predicciones'}).click();
  await expect(page.getByRole('heading',{name:'Feeds bursátiles · experimental'})).toBeVisible();
  await expect(page.getByText('IEX Live cubre una sola bolsa',{exact:false})).toBeVisible();
  await expect(page.getByText('NO_DATA · DISCONNECTED')).toBeVisible();
});
test('Predicciones muestra estado del recolector sin presentar una señal operativa',async({page})=>{
  await page.route('**/api/v1/ml/collector?*',route=>route.fulfill({json:{state:'RECORDED',active:false,updatedAtUtc:'2026-10-20T15:40:00.000Z',lastSuccessfulIngestionAtUtc:'2026-10-20T15:36:00.000Z',lastBarEndUtc:'2026-10-20T15:15:00.000Z',lastObservationAtUtc:'2026-10-20T15:40:00.000Z',nextQueryAtUtc:'2026-10-20T15:50:00.000Z',lastError:null,newObservations:1}}));
  await page.goto('/');await page.getByRole('button',{name:'Predicciones'}).click();
  await expect(page.getByRole('heading',{name:'Recolector Alpaca SIP + XGBoost'})).toBeVisible();
  await expect(page.getByText('Ingesta retrasada y observaciones adelantadas al desenlace. No son señales operativas.')).toBeVisible();
  await expect(page.getByText('RECORDED')).toBeVisible();
});
test('Evaluación adelantada distingue ausencia de observaciones reales y apertura no ejecutable',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Predicciones'}).click();
  await expect(page.getByRole('heading',{name:'Evaluación de observaciones adelantadas'})).toBeVisible();
  await expect(page.getByText('La apertura hipotética t+1 ya había ocurrido cuando se registraron estas predicciones retrasadas.',{exact:false})).toBeVisible();
  await expect(page.getByRole('table',{name:'Historial de evaluaciones'})).toHaveCount(0);
});
test('Predicciones muestra experimento histórico paginado sin señal vigente',async({page})=>{
  await page.route('**/api/v1/ml/status',route=>route.fulfill({json:{status:'READY',reason:null,experimentId:'synthetic-test'}}));
  await page.route('**/api/v1/ml/summary',route=>route.fulfill({json:{status:'READY',symbol:'NVDA',timeframe:'15m',origin:'HISTORICAL_EXPLORATORY',experimentId:'synthetic-test',createdAtUtc:'2026-10-20T13:49:17.000Z',modelVersion:'XGBoost 2.1.4 · nvda-15m-v1',selectedVariant:'standard',trees:12,datasetSha256:'a'.repeat(64),predictionCount:2}}));
  await page.route('**/api/v1/ml/metrics',route=>route.fulfill({json:{status:'READY',model:metrics,frequencyBaseline:metrics,walkForward:[{fold:1,externalSessions:3,standard:metrics,classWeighted:metrics,regularized:metrics,frequencyBaseline:metrics}],exploratoryByYear:{'2025':metrics,'2026':metrics},warning:'Investigación exploratoria'}}));
  await page.route('**/api/v1/ml/predictions?*',route=>{const offset=Number(new URL(route.request().url()).searchParams.get('offset')??0);return route.fulfill({json:{status:'READY',items:offset?[]:[{symbol:'NVDA',timeframe:'15m',timestampUtc:'2025-01-02T14:30:00.000Z',sessionDateNy:'2025-01-02',probabilities:{ALCISTA:.7,BAJISTA:.2,LATERAL:.1},dominantClass:'ALCISTA',origin:'HISTORICAL_EXPLORATORY',modelVersion:'XGBoost 2.1.4 · nvda-15m-v1'}],total:2,offset,limit:25,nextOffset:null}});});
  await page.goto('/');await page.getByRole('button',{name:'Predicciones'}).click();
  await expect(page.getByText('synthetic-test')).toBeVisible();
  await expect(page.getByRole('table',{name:'Predicciones históricas'}).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText('No hay inferencia actual.')).toBeVisible();
  await expect(page.getByRole('table',{name:'Evaluación retrospectiva por año'}).locator('tbody tr')).toHaveCount(2);
});
