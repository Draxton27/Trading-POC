import {test,expect} from '@playwright/test';

test('DEMO separa una decisión hipotética de su revisión posterior sin órdenes ni datos reales',async({page})=>{
  const forbidden:string[]=[];
  page.on('request',request=>{
    if(/\/api\/v1\/(?:orders|executions|positions)(?:\/|\?|$)/.test(request.url()))forbidden.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Revisión de decisiones'}).click();
  await expect(page.getByText('Todavía no hay decisiones en los ledgers privados.')).toBeVisible();
  // The UI fixture is scoped to this browser page. It does not append an entry to
  // the shared DEMO server, so the existing simulator E2E scenarios remain isolated.
  const at='2026-10-21T15:10:00.000Z',id='F41M:fixture';
  await page.route('**/api/v1/research/decision-review/summary',route=>route.fulfill({json:{
    status:'PARTIAL_EVIDENCE',reviewGeneratedAtUtc:at,totalDecisions:1,prospectiveQualified:0,
    documentedOnTimeSimulator:0,historicalDecisions:0,syntheticDecisions:1,withVerifiedMl:0,
    withVerifiedTechnical:0,withReconstructedTechnical:0,withHistoricalTechnical:0,
    withUnavailableTechnical:1,withLinkedTradeOutcome:1,evaluatedModelAssociations:0,
    linkedHumanSimulatorPairs:0,sourceStatus:{F17:'UNAVAILABLE',F16:'UNAVAILABLE',F41M:'AVAILABLE',
      F41I:'UNAVAILABLE',F41K:'UNAVAILABLE',BROKER:'UNAVAILABLE'},limitations:[]}}));
  await page.route('**/api/v1/research/decision-review/cases?*',route=>route.fulfill({json:{
    status:'PARTIAL_EVIDENCE',total:1,offset:0,limit:25,nextOffset:null,sourceStatus:{F41M:'AVAILABLE'},
    items:[{id,origin:'F41M_SIMULATOR',decisionAtUtc:at,documentedAtUtc:at,
      classification:'DEMO_SYNTHETIC',direction:'CALL',technicalStatus:'UNAVAILABLE',
      predictionMatch:'NONE',outcomeStatus:'OPEN',linkedHumanDecisionId:null}]}}));
  await page.route('**/api/v1/research/decision-review/cases/F41M%3Afixture',route=>route.fulfill({json:{
    id,reviewGeneratedAtUtc:at,decisionTimeView:{view:'DECISION_TIME_VIEW',decision:{
      id,origin:'F41M_SIMULATOR',sourceId:'fixture',linkedHumanDecisionId:null,symbol:'NVDA',
      decisionAtUtc:at,documentedAtUtc:at,classification:'DEMO_SYNTHETIC',direction:'CALL',
      operationType:'HYPOTHETICAL_LONG_OPTION',contractOccSymbol:null,positionId:'fixture-position',
      simulationId:'fixture-simulation',simulatedEntryAtUtc:at,contract:null,plan:{entryReason:'fixture'},
      quoteReference:null,chartCaptureId:null,chartCapturedAtUtc:null,
      quantity:1,premiumPerShare:2,priceOrigin:'MANUAL_INPUT',reason:'fixture',
      recordClass:null,observedMarket:null,contextKnownAtUtc:null,sourceIds:['fixture'],sourceHashes:[]},
      humanContext:null,technical:null,model:null,predictionMatch:'NONE',signalComparison:null,
      agreements:[],missing:[],limitations:[]},postOutcomeReview:{view:'POST_OUTCOME_REVIEW',
      modelOutcome:null,technicalLater:[],tradeOutcome:{source:'F41M_HYPOTHETICAL',scope:'POSITION_AGGREGATE',
        positionId:'fixture-position',status:'OPEN',initialQuantity:1,closedQuantity:0,remainingQuantity:1,
        exitPremiumsPerShare:[],realizedGrossUsd:0,realizedNetUsd:null,knownCommissionUsd:null,
        sourceIds:['fixture'],sourceHashes:[]},laterNotes:[],dimensions:['OPTION_TRADE_ECONOMIC_OUTCOME'],
      limitations:[]},limitations:[]}}));
  await page.getByRole('button',{name:'Opciones'}).click();
  await page.getByRole('button',{name:'Revisión de decisiones'}).click();
  await expect(page.getByText('DEMO_SYNTHETIC',{exact:true}).first()).toBeVisible();
  await page.getByRole('table').getByRole('button').first().click();
  await expect(page.getByRole('heading',{name:'Qué se sabía al decidir'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Qué sucedió después'})).toBeVisible();
  await expect(page.getByText('Predicción IEX: NONE.',{exact:false})).toBeVisible();
  await expect(page.getByText('Resultado hipotético interno',{exact:false})).toBeVisible();
  expect(forbidden).toEqual([]);
});
