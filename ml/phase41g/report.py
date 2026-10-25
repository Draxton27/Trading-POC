"""Reproducible, private Phase 41G historical audit CLI."""
from __future__ import annotations
import argparse
import json
import os
import shutil
import subprocess
from collections import Counter
from pathlib import Path
from statistics import median
from .sources import load, sha
from .event_detection import detect
from .outcomes import evaluate
from .comparators import match
from .statistics import grouped, summarize_no_bootstrap, paired_interval, F

ROOT=Path(__file__).resolve().parents[2]


def write(path: Path, value: object) -> None:
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')


def rate(rows: list[dict]) -> float | None:
    valid=[r for r in rows if r['outcomes']['4']['status']!='OUTCOME_UNAVAILABLE']
    return sum(r['outcomes']['4']['status']==F for r in valid)/len(valid) if valid else None


def comparisons(visits: list[dict], nonvisits: list[dict], pairs: list[dict]) -> list[dict]:
    byvisit={v['eventId']:v for v in visits};bynon={n['eventId']:n for n in nonvisits}
    output=[]
    for frame in ('15m','1h','1d'):
        for direction in ('BULLISH','BEARISH'):
            for period in (20,40,100,200):
                sample=[v for v in visits if v['timeframe']==frame and v['regimeDirection']==direction
                        and v['smaPeriod']==period]
                first=[v for v in sample if v['isFirstVisit'] and not v['leftCensored']]
                later=[v for v in sample if not v['isFirstVisit'] and not v['leftCensored']]
                matching=[p for p in pairs if p['visitId'] in {v['eventId'] for v in sample}]
                evaluable=[p for p in matching if byvisit[p['visitId']]['outcomes']['4']['status']!='OUTCOME_UNAVAILABLE'
                           and bynon[p['nonvisitId']]['outcomes']['4']['status']!='OUTCOME_UNAVAILABLE']
                matched_visits=[byvisit[p['visitId']] for p in evaluable]
                matched_nonvisits=[bynon[p['nonvisitId']] for p in evaluable]
                pair_values=list(zip(matched_visits,matched_nonvisits))
                output.append({'timeframe':frame,'direction':direction,'smaPeriod':period,
                    'first':summarize_no_bootstrap(first),'later':summarize_no_bootstrap(later),
                    'firstMinusLaterFavorableRate':round(rate(first)-rate(later),6)
                       if rate(first) is not None and rate(later) is not None else None,
                    'matchedPairs':len(evaluable),'matchedVisitFavorableRate':rate(matched_visits),
                    'matchedNonvisitFavorableRate':rate(matched_nonvisits),
                    'matchedDifference':round(rate(matched_visits)-rate(matched_nonvisits),6)
                       if evaluable else None,
                    'matchedDifferenceSessionBootstrap95':paired_interval(pair_values,'dateNy'),
                    'matchedDifferenceRegimeBootstrap95':paired_interval(pair_values,'regimeId'),
                    'interpretation':'EXPLORATORY_ASSOCIATION_NOT_CAUSAL'})
    return output


def markdown(report: dict) -> str:
    counts=report['counts'];lines=['# Fase 41G: cambios, reinicios y visitas a SMA', '',
       'Estudio histórico exploratorio de NVDA SIP split, no señal ni oportunidad ejecutable.',
       'La disponibilidad histórica se **simula** como cierre + 20 min; no es un registro de recepción original.', '',
       '## Cobertura y eventos', '',
       f"Cambios: {counts['changesBullish']} alcistas y {counts['changesBearish']} bajistas. "
       f"Reinicios: {counts['restartsBullish']} alcistas y {counts['restartsBearish']} bajistas.",
       f"Visitas: {counts['firstVisits']} primeras, {counts['laterVisits']} posteriores; "
       f"{counts['leftCensoredVisits']} de regímenes con censura izquierda.",
       f"Duración mediana de la alineación intermedia antes del reinicio: {counts['medianIntermediateBars']} velas del marco respectivo.", '',
       '## Resultado principal de cuatro velas', '',
       '|Marco|Tendencia|SMA|Visita|Eventos|Evaluables|Sesiones|Favorable|Adverso|IC 95 % sesión|Evidencia|',
       '|---|---|---:|---|---:|---:|---:|---:|---:|---|---|']
    for row in report['statistics']:
        if row['dimension']!='main':continue
        frame,direction,period,visit=row['keys'];ci=row['sessionBootstrap95']
        fmt=lambda n:'N/D' if n is None else f'{n:.1%}'
        lines.append(f"|{frame}|{direction}|{period}|{visit}|{row['events']}|{row['evaluable']}|"
                     f"{row['sessions']}|{fmt(row['favorableRate'])}|{fmt(row['adverseRate'])}|"
                     f"{(fmt(ci[0])+'–'+fmt(ci[1])) if ci else 'N/D'}|{row['evidence']}|")
    lines += ['', '## Sensibilidad predeclarada', '',
      '|Marco|Tendencia|Velas|Evaluables|Favorable|', '|---|---|---:|---:|---:|']
    for row in report['horizonSensitivity']:
        value=row['favorableRate']
        lines.append(f"|{row['timeframe']}|{row['direction']}|{row['horizonBars']}|"
                     f"{row['evaluable']}|{f'{value:.1%}' if value is not None else 'N/D'}|")
    lines += ['', '## Visita frente a un punto sin visita, emparejado antes del desenlace', '',
              '|Marco|Tendencia|SMA|Pares evaluables|Diferencia favorable|IC 95 % sesión|',
              '|---|---|---:|---:|---:|---|']
    for row in report['comparisons']:
        diff=row['matchedDifference'];ci=row['matchedDifferenceSessionBootstrap95']
        lines.append(f"|{row['timeframe']}|{row['direction']}|{row['smaPeriod']}|{row['matchedPairs']}|"
                     f"{f'{diff:+.1%}' if diff is not None else 'N/D'}|"
                     f"{(f'{ci[0]:+.1%}–{ci[1]:+.1%}') if ci else 'N/D'}|")
    lines += ['', '## Método y límites', '',
      'El detector no ve desenlaces: se calculan en un segundo paso. El toque se conoce al cierre y la apertura de referencia es la primera posterior a cierre + 20 min. Las aperturas no son fills.',
      'ATR14 y SMA usan SIP split. El ajuste retrospectivo por splits no representa exactamente los precios conocidos en cada fecha histórica.',
      'Las segundas visitas requieren supervivencia del régimen: una tasa mayor o menor no prueba causalidad. Se informa comparación por edad y hora, y referencias sin visita seleccionadas antes de calcular resultados.',
      'En una secuencia binaria continua de alineaciones, cada cruce desde el tercero restaura la dirección de dos cruces antes. Por eso CHANGE y RESTART se superponen y no constituyen grupos independientes; los subgrupos CHANGE sin RESTART son escasos.',
      'Los intervalos por sesión y régimen no necesariamente capturan dependencias entre jornadas, múltiples SMA en una misma vela ni cambios prolongados de régimen. Grupos con <30 eventos evaluables o sesiones son insuficientes.',
      'Los horizontes 2 y 6 son sensibilidades. Los resultados 1h y 1d son estudios propios y no equivalen al horizonte 15m.',
      'Al cierre del histórico se censuran regímenes y desenlaces. No se entrenó ningún modelo ni se alteraron F0/F1/F2 o los objetivos de 41D.', '']
    return '\n'.join(lines)


def run(csv: Path,out: Path,expected_sha: str,source_export: Path | None=None,
        source_export_sha: str | None=None) -> dict:
    if out.exists():
        if any(out.iterdir()): raise ValueError('El directorio privado ya contiene archivos; no se sobrescribe')
    else:out.mkdir(parents=True)
    source_path=out/'source-41b.json'
    if source_export:
        if sha(csv)!=expected_sha:raise ValueError('CSV SIP distinto del SHA fijado')
        if not source_export_sha or sha(source_export)!=source_export_sha:
            raise ValueError('SHA-256 del puente SIP reutilizado inválido')
        shutil.copyfile(source_export,source_path)
    else:
        runner='npm.cmd' if os.name=='nt' else 'npm'
        subprocess.run([runner,'exec','--','tsx','trading_poc_001_bollinger/src/phase41g-source-cli.ts',
             '--sip-csv',str(csv),'--out',str(source_path),'--expected-sha256',expected_sha],
             cwd=ROOT,check=True,timeout=1800)
    source=load(source_path,expected_sha)
    for relative,digest in source['source']['code'].items():
        if sha(ROOT/relative)!=digest:raise ValueError('Código TypeScript 41A/41B distinto al del puente')
    result=detect(source)
    pairs=match(result['visits'],result['nonvisits'])  # frozen before evaluating any outcomes
    visit_outcomes=evaluate(result['visits'],source)
    matched_ids={p['nonvisitId'] for p in pairs}
    nonvisit_outcomes=evaluate([n for n in result['nonvisits'] if n['eventId'] in matched_ids],source)
    statistics=grouped([v for v in visit_outcomes if not v['leftCensored']])
    comparison=comparisons(visit_outcomes,nonvisit_outcomes,pairs)
    sensitivity=[]
    for frame in ('15m','1h','1d'):
        for direction in ('BULLISH','BEARISH'):
            for horizon in (2,4,6):
                sample=[v for v in visit_outcomes if v['timeframe']==frame and
                        v['regimeDirection']==direction and not v['leftCensored']]
                valid=[v for v in sample if v['outcomes'][str(horizon)]['status']!='OUTCOME_UNAVAILABLE']
                sensitivity.append({'timeframe':frame,'direction':direction,'horizonBars':horizon,
                    'events':len(sample),'evaluable':len(valid),
                    'favorableRate':sum(v['outcomes'][str(horizon)]['status']==F for v in valid)/len(valid)
                        if valid else None})
    restarts=result['restarts'];visits=result['visits']
    count={'changesBullish':sum(x['direction']=='BULLISH' for x in result['changes']),
      'changesBearish':sum(x['direction']=='BEARISH' for x in result['changes']),
      'restartsBullish':sum(x['direction']=='BULLISH' for x in restarts),
      'restartsBearish':sum(x['direction']=='BEARISH' for x in restarts),
      'firstVisits':sum(v['isFirstVisit'] for v in visits),
      'laterVisits':sum(not v['isFirstVisit'] and not v['leftCensored'] for v in visits),
      'leftCensoredVisits':sum(v['leftCensored'] for v in visits),
      'medianIntermediateBars':median(x['durationOfIntermediateAlignment'] for x in restarts) if restarts else None}
    protocol=Path(__file__).with_name('protocol.json')
    write(out/'protocol.json',json.loads(protocol.read_text(encoding='utf-8')))
    write(out/'trend-regimes.json',result['regimes'])
    write(out/'trend-changes.json',result['changes'])
    write(out/'trend-restarts.json',result['restarts'])
    write(out/'sma-visits.json',visits)
    write(out/'visit-outcomes.json',visit_outcomes)
    write(out/'event-coverage.json',result['coverage'])
    write(out/'event-statistics.json',statistics)
    write(out/'paired-comparisons.json',{'pairs':pairs,'summaries':comparison})
    write(out/'uncertainty.json',[{'keys':r['keys'],'dimension':r['dimension'],
        'sessionBootstrap95':r.get('sessionBootstrap95'),'regimeBootstrap95':r.get('regimeBootstrap95')}
        for r in statistics if r['dimension'] in ('main','origin','overlap_38e')])
    report={'schema':'phase41g-report-v1','status':'HISTORICAL_EXPLORED',
      'counts':count,'coverage':result['coverage'],'statistics':statistics,'comparisons':comparison,
      'horizonSensitivity':sensitivity,
      'outcomeUnavailability':dict(Counter(v['outcomes']['4'].get('reason') for v in visit_outcomes
                              if v['outcomes']['4']['status']=='OUTCOME_UNAVAILABLE')),
      'sourceSha256':expected_sha,'sourceExportSha256':sha(source_path),'protocolSha256':sha(protocol),
      'frames':['15m','1h','1d'],'principalHorizon':4,'simulatedDelayMinutes':20}
    write(out/'report.json',report)
    (out/'report.md').write_text(markdown(report),encoding='utf-8')
    code_files=[Path(__file__).parent/f for f in ('sources.py','trend_regimes.py','visit_episodes.py',
       'event_detection.py','outcomes.py','comparators.py','statistics.py','coverage.py','report.py')]
    tracked=['ml/phase41g','trading_poc_001_bollinger/src/phase41g-source-cli.ts',
             'trading_poc_001_bollinger/src/phase41b-context.ts',
             'trading_poc_001_bollinger/src/investep-technical-context.ts',
             'trading_poc_001_bollinger/src/multitimeframe.ts']
    git_status=subprocess.run(['git','status','--porcelain','--',*tracked],cwd=ROOT,
                              capture_output=True,text=True,check=True).stdout.strip()
    commit=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,capture_output=True,text=True,check=True).stdout.strip()
    write(out/'manifest.json',{'schema':'phase41g-manifest-v1','sourceFiles':source['source']['hashes'],
       'sourceBridgeCode':source['source']['code'],'codeSha256':{str(p.relative_to(ROOT)):sha(p) for p in code_files},
       'protocolSha256':sha(protocol),'gitCommitSha256':commit if not git_status else None,
       'gitCommitNote':'Commit registrado solo si todo el código/protocolo relevante está confirmado; hashes de archivos son la identidad exacta.',
       'privateArtifacts':True,'status':'HISTORICAL_EXPLORATION'})
    files=sorted(p for p in out.iterdir() if p.is_file() and p.name!='SHA256SUMS')
    (out/'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.name}\n' for p in files),encoding='utf-8')
    return report


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument('--sip-csv',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--expected-sha256',required=True)
    parser.add_argument('--source-export',type=Path,help='Puente 41B verificado previo; evita repetir solo su exportación')
    parser.add_argument('--source-export-sha256',help='SHA-256 obligatorio del puente reutilizado')
    args=parser.parse_args()
    print(json.dumps({'counts':run(args.sip_csv.resolve(),args.out.resolve(),args.expected_sha256,
        args.source_export.resolve() if args.source_export else None,
        args.source_export_sha256)['counts']},ensure_ascii=False))


if __name__=='__main__':main()
