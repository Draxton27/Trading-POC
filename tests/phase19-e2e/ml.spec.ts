import {test,expect} from '@playwright/test';

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
