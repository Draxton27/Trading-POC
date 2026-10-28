import {useEffect,useState} from 'react';
import {Badge,Card} from '../../components/ui.tsx';
import {fmt} from '../../lib/api.ts';
import {analyzeComparisonRow,optionQualityLabel,optionalNumberInput} from './analysis.ts';
import SimulatorOpenForm from '../simulator/SimulatorOpenForm.tsx';

const money=(value:number|null)=>value===null||!Number.isFinite(value)?'N/D':`$${fmt(value,2)}`;
const price=(value:number|null)=>value===null||!Number.isFinite(value)?'N/D':`$${fmt(value,4)}`;
const percent=(value:number|null)=>value===null||!Number.isFinite(value)?'N/D':`${fmt(value,2)}%`;
const referenceLabel:Record<string,string>={ACTIVE:'Vigencia declarada',REFERENCE_DATE:'Fecha documental exacta',
  HISTORICAL_ONLY:'Histórica, sin vigencia declarada',CONFLICT:'Referencias contradictorias',NONE:'Sin referencia'};

export default function OptionAnalysisPanel({row,conId,nowMs,defaults}:{row:Record<string,unknown>|null;conId:number|null;nowMs:number;
  defaults?:{quantity:number;capitalUsd:number|null;entryFeePerContractUsd:number|null}}){
  const defaultQuantity=defaults?.quantity??1,defaultCapital=defaults?.capitalUsd??null,defaultFee=defaults?.entryFeePerContractUsd??null;
  const [quantity,setQuantity]=useState(String(defaultQuantity)),[capital,setCapital]=useState(defaultCapital===null?'':String(defaultCapital));
  const [entryFee,setEntryFee]=useState(defaultFee===null?'':String(defaultFee));
  const [expirationFee,setExpirationFee]=useState(''),[underlying,setUnderlying]=useState('');
  useEffect(()=>{setQuantity(String(defaultQuantity));setCapital(defaultCapital===null?'':String(defaultCapital));
    setEntryFee(defaultFee===null?'':String(defaultFee));},[defaultQuantity,defaultCapital,defaultFee]);
  const analysis=row?analyzeComparisonRow(row,{quantity:Number(quantity),capitalUsd:optionalNumberInput(capital),
    entryFeePerContractUsd:optionalNumberInput(entryFee),expirationFeePerContractUsd:optionalNumberInput(expirationFee),
    hypotheticalUnderlyingAtExpirationUsd:optionalNumberInput(underlying),asOfUtc:new Date(nowMs).toISOString()}):null;
  const subscriptionFailed=row?.subscriptionStatus==='FAILED';
  const unavailable=row?.quoteStatus==='UNAVAILABLE'||row?.marketDataStatus==='unavailable';
  return <Card className="option-analysis"><span className="eyebrow">DETALLE DEL CONTRATO</span><h3>{analysis?.identity.right??'Contrato'} NVDA · strike {price(analysis?.identity.strike??null)}</h3>
    <p>Ejercicio local e hipotético de compra para abrir. No consulta saldos, no envía órdenes y no garantiza precios de ejecución.</p>
    {!row?<p className="subtle">{conId===null?'Seleccione un contrato para analizarlo.':`Consultando el contrato ${conId} o sin datos disponibles.`}</p>:<>
      <div className="option-analysis-form">
        <label>Contratos <input aria-label="Cantidad hipotética de contratos" type="number" min="1" max="10000" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <label>Capital hipotético USD <input aria-label="Capital hipotético USD" type="number" min="0" step="0.01" value={capital} onChange={e=>setCapital(e.target.value)} placeholder="Opcional"/></label>
        <label>Comisión de entrada por contrato USD <input aria-label="Comisión de entrada por contrato USD" type="number" min="0" step="0.01" value={entryFee} onChange={e=>setEntryFee(e.target.value)} placeholder="Desconocida"/></label>
        <label>Otro costo aplicable al escenario por contrato USD <input aria-label="Costo adicional por contrato USD" type="number" min="0" step="0.01" value={expirationFee} onChange={e=>setExpirationFee(e.target.value)} placeholder="Desconocido"/></label>
        <label>NVDA hipotético al vencimiento USD <input aria-label="Precio hipotético NVDA al vencimiento USD" type="number" min="0" step="0.01" value={underlying} onChange={e=>setUnderlying(e.target.value)} placeholder="Opcional"/></label>
      </div>
      {analysis?<>
        <section className="option-analysis-explanation"><h4>Cómo interpretar este contrato</h4>
          <p>NVDA {analysis.identity.right??'N/D'} · precio de ejercicio {price(analysis.identity.strike)} ·
            prima ASK por acción {price(analysis.quote.ask)} · multiplicador {analysis.identity.multiplier??'N/D'}.</p>
          <p>Para {analysis.quantity??'N/D'} contrato(s), el costo bruto y la pérdida máxima de prima de una compra larga
            serían {money(analysis.premium.grossPremiumUsd)}, sin comisiones desconocidas. El equilibrio bruto al vencimiento
            sería {price(analysis.premium.breakEvenGrossUsd)} del subyacente.</p>
          <small>{analysis.quote.status==='LIVE_RECENT'?'Cotización Live reciente verificada; no garantiza ejecución.':
            `ASK observado: ${optionQualityLabel[analysis.quote.status]}. El importe es descriptivo, no un precio ejecutable actual.`}
            {' '}El spread indica la diferencia entre BID y ASK, no una rentabilidad esperada.</small>
        </section>
        <div className="option-analysis-meta"><strong>Vencimiento {analysis.expiration.expirationDate??'N/D'} · DTE {analysis.expiration.daysCalendar??'N/D'}</strong>
          <Badge tone={!unavailable&&!subscriptionFailed&&analysis.quote.status==='LIVE_RECENT'?'success':'warning'}>
            {subscriptionFailed?'Suscripción fallida':unavailable?'Cotización no disponible':
              optionQualityLabel[analysis.quote.status]}</Badge>
          <span>{subscriptionFailed?'La suscripción falló; BID/ASK anteriores no verifican una cotización actual.':
            unavailable?'IBKR marcó la cotización como no disponible; BID/ASK anteriores no verifican un precio actual.':
            analysis.quote.reason}</span></div>
        <details className="option-analysis-advanced"><summary>Qué significan prima, spread, strike, DTE y equilibrio</summary>
          <p>ASK es la prima indicada por acción para comprar, sin garantía de ejecución. El costo bruto multiplica ASK por el multiplicador y la cantidad; las comisiones desconocidas quedan fuera.</p>
          <p>BID es el precio indicado para vender. El spread es la diferencia BID/ASK; comprar al ASK y vender de inmediato al BID implica una diferencia negativa antes de comisiones cuando ambas cotizaciones son utilizables.</p>
          <p>Strike es el precio de ejercicio, distinto de la prima. DTE cuenta días calendario hasta vencimiento según 41L. Equilibrio es el precio del subyacente al vencimiento que igualaría el costo bruto bajo las hipótesis mostradas.</p>
        </details>
        {analysis.contractIssues.length||analysis.inputIssues.length?<p role="alert" className="option-analysis-warning">{[...analysis.contractIssues,...analysis.inputIssues].join(' ')}</p>:null}
        <div className="option-analysis-grid">
          <section><h4>Costo y riesgo máximo</h4>
            <dl><dt>ASK por acción</dt><dd>{price(analysis.quote.ask)}</dd>
              <dt>Prima bruta, {analysis.quantity??'N/D'} contrato(s)</dt><dd>{money(analysis.premium.grossPremiumUsd)}</dd>
              <dt>Pérdida máxima bruta de prima</dt><dd>{money(analysis.premium.maximumPremiumLossUsd)}</dd>
              <dt>Comisiones de entrada declaradas</dt><dd>{money(analysis.premium.entryFeesUsd)}</dd>
              <dt>Pérdida máxima con comisión de entrada</dt><dd>{money(analysis.premium.maximumNetLossWithEntryFeesUsd)}</dd>
              <dt>Equilibrio bruto al vencimiento</dt><dd>{price(analysis.premium.breakEvenGrossUsd)}</dd>
              <dt>Equilibrio con costos introducidos {analysis.premium.feesCompleteForNet?'':'(parcial)'}</dt><dd>{price(analysis.premium.breakEvenWithProvidedFeesUsd)}</dd></dl>
          </section><section><h4>Liquidez visible</h4><dl>
              <dt>BID / ASK</dt><dd>{price(analysis.quote.bid)} / {price(analysis.quote.ask)}</dd>
              <dt>Tamaño BID / ASK</dt><dd>{analysis.quote.bidSize??'N/D'} / {analysis.quote.askSize??'N/D'}</dd>
              <dt>Spread por acción / punto medio</dt><dd>{price(analysis.spread.absolutePerShareUsd)} / {percent(analysis.spread.percentOfMidpoint)}</dd>
              <dt>Compra ASK y venta BID inmediata, bruto</dt><dd>{money(analysis.spread.immediateGrossDifferenceUsd)} ({percent(analysis.spread.immediateDifferencePercentOfPremium)})</dd></dl>
              <small>{analysis.spread.reason}</small>
          </section><section><h4>Capital hipotético</h4><dl>
              <dt>Capital declarado</dt><dd>{money(analysis.capital.capitalUsd)}</dd>
              <dt>Desembolso con comisión conocida</dt><dd>{money(analysis.capital.cashOutlayWithKnownEntryFeesUsd)}</dd>
              <dt>Capital comprometido</dt><dd>{percent(analysis.capital.committedPercent)}</dd>
              <dt>Capital restante</dt><dd>{money(analysis.capital.remainingUsd)}</dd>
              <dt>Máximo de contratos enteros</dt><dd>{analysis.capital.maximumWholeContracts??'N/D'}</dd></dl>
              {analysis.capital.status==='BUDGET_EXCEEDED'?<strong className="option-analysis-warning">Presupuesto hipotético excedido.</strong>:null}
              {analysis.capital.feesExcludedFromBudget?<small>El máximo excluye comisiones de entrada desconocidas.</small>:null}
          </section><section><h4>Escenario al vencimiento</h4><dl>
              <dt>NVDA hipotético</dt><dd>{price(analysis.payoff.underlyingPriceUsd)}</dd>
              <dt>Valor intrínseco total</dt><dd>{money(analysis.payoff.totalIntrinsicUsd)}</dd>
              <dt>Resultado bruto</dt><dd>{money(analysis.payoff.grossPnlUsd)}</dd>
              <dt>Resultado neto con costos declarados</dt><dd>{money(analysis.payoff.netPnlUsd)}</dd>
              <dt>Retorno sobre prima bruta</dt><dd>{percent(analysis.payoff.returnOnGrossPremiumPercent)}</dd></dl>
              <small>Las aperturas, cierres y asignaciones reales pueden diferir. No representa rentabilidad de una estrategia.</small>
          </section>
        </div>
        <section className="option-analysis-academy"><h4>Referencia documental de la academia</h4>
          {analysis.academy?<><p>{referenceLabel[analysis.academy.referenceStatus]} · {analysis.academy.reason}</p>
            <p>Rango óptimo ASK por acción: {money(analysis.academy.minAskCents===null?null:analysis.academy.minAskCents/100)} a {money(analysis.academy.maxAskCents===null?null:analysis.academy.maxAskCents/100)}.</p>
            <p>Límites documentales externos: {money(analysis.academy.outerMinCents===null?null:analysis.academy.outerMinCents/100)} a {money(analysis.academy.outerMaxCents===null?null:analysis.academy.outerMaxCents/100)}.</p>
            <p>Fecha documental: {analysis.academy.referenceDate??'N/D'} · Vigencia declarada: {analysis.academy.validFrom??'N/D'} a {analysis.academy.validTo??'N/D'} · Estado ASK: {analysis.academy.status}.</p></>:<p>Sin referencia documental evaluable en la respuesta actual.</p>}
          <small>El precio de ejercicio del contrato y la prima ASK observada son distintos del rango ASK documental Investep.
            Estos valores son primas ASK por acción según interpretación del operador; no son rangos del precio de NVDA ni recomendaciones vigentes.</small>
        </section>
        <details className="option-analysis-advanced"><summary>Detalles avanzados</summary><dl>
          <dt>conId</dt><dd>{conId??'N/D'}</dd><dt>OCC symbol</dt><dd>{analysis.identity.occSymbol??'N/D'}</dd>
          <dt>Multiplicador</dt><dd>{analysis.identity.multiplier??'N/D'}</dd>
          <dt>Proveedor / feed</dt><dd>{analysis.quote.provider??'N/D'} / {analysis.quote.feedType}</dd>
          <dt>Recepción</dt><dd>{analysis.quote.receivedAtUtc??'N/D'}</dd>
          <dt>Timestamp de mercado</dt><dd>{analysis.quote.marketTimestampUtc??'N/D'}</dd>
          <dt>BID / ASK sizes</dt><dd>{analysis.quote.bidSize??'N/D'} / {analysis.quote.askSize??'N/D'}</dd>
          <dt>Volumen / open interest</dt><dd>{String(row.volume??'N/D')} / {String(row.openInterest??'N/D')}</dd>
          <dt>Delta / Gamma</dt><dd>{String(row.delta??'N/D')} / {String(row.gamma??'N/D')}</dd>
          <dt>Theta / Vega / IV</dt><dd>{String(row.theta??'N/D')} / {String(row.vega??'N/D')} / {String(row.impliedVolatility??'N/D')}</dd>
          <dt>Permisos</dt><dd>{String(row.permissions??'N/D')}</dd></dl></details>
        <ul className="option-analysis-limitations">{analysis.limitations.map(text=><li key={text}>{text}</li>)}</ul>
        <SimulatorOpenForm row={row}/>
      </>:null}
    </>}
  </Card>;
}
