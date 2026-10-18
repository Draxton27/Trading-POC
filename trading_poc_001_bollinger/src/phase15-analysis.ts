export type Group = 'concordance' | 'contradiction' | 'mixed' | 'missing';
export type Observation = {id: string; session: string; family: string; year: string;
  hourBlock: number; regime: string; group: Group; outcome: number | null;
  control: number | null; mfe: number | null; mae: number | null};

export function classify(direction: 'bullish' | 'bearish', qqq: number | null,
  smh: number | null): Group {
  if (qqq === null || smh === null || !Number.isFinite(qqq) || !Number.isFinite(smh)) return 'missing';
  const sign = direction === 'bullish' ? 1 : -1;
  if (qqq * sign > 0 && smh * sign > 0) return 'concordance';
  if (qqq * sign < 0 && smh * sign < 0) return 'contradiction';
  return 'mixed';
}

export const stratumKey = (o: Observation): string =>
  [o.family, o.year, o.hourBlock, o.regime].join('|');
const mean = (a: number[]): number | null => a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
export function estimate(rows: Observation[], field: 'outcome' | 'control' = 'outcome') {
  const arms = rows.filter(r => (r.group === 'concordance' || r.group === 'contradiction') &&
    r[field] !== null && Number.isFinite(r[field]));
  const cells = new Map<string, Observation[]>();
  for (const row of arms) cells.set(stratumKey(row), [...(cells.get(stratumKey(row)) ?? []), row]);
  const shared = [...cells.entries()].map(([key, cell]) => {
    const a = cell.filter(r => r.group === 'concordance');
    const b = cell.filter(r => r.group === 'contradiction');
    return {key, a, b, weight: a.length * b.length / (a.length + b.length)};
  }).filter(c => c.a.length && c.b.length);
  const weight = shared.reduce((s, c) => s + c.weight, 0);
  const adjusted = weight ? shared.reduce((s, c) => s + c.weight *
    (mean(c.a.map(r => r[field]!))! - mean(c.b.map(r => r[field]!))!), 0) / weight : null;
  const rawA = arms.filter(r => r.group === 'concordance');
  const rawB = arms.filter(r => r.group === 'contradiction');
  const matchedA = shared.flatMap(c => c.a);
  const matchedB = shared.flatMap(c => c.b);
  const kish = (group: 'a' | 'b') => {
    const values = shared.flatMap(c => {
      const n = c[group].length;
      return Array(n).fill(c.weight / n) as number[];
    });
    const sum = values.reduce((s, v) => s + v, 0);
    const squares = values.reduce((s, v) => s + v * v, 0);
    return squares ? sum * sum / squares : 0;
  };
  const years = Object.fromEntries([...new Set(shared.map(c => c.key.split('|')[1]!))]
    .map(year => [year, shared.filter(c => c.key.split('|')[1] === year)
      .reduce((s, c) => s + c.weight, 0)]));
  return {rawDifference: rawA.length && rawB.length ?
    mean(rawA.map(r => r[field]!))! - mean(rawB.map(r => r[field]!))! : null,
    adjustedDifference: adjusted, total: {concordance: rawA.length, contradiction: rawB.length},
    matched: {concordance: matchedA.length, contradiction: matchedB.length},
    sessions: {concordance: new Set(matchedA.map(r => r.session)).size,
      contradiction: new Set(matchedB.map(r => r.session)).size},
    effectiveN: {concordance: kish('a'), contradiction: kish('b')},
    sharedStrata: shared.length, totalStrata: cells.size, years, weight};
}

function rng(seed: number): () => number {
  let state = seed;
  return () => {state = (state + 0x6D2B79F5) | 0;
    let x = Math.imul(state ^ state >>> 15, 1 | state);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;};
}
function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const place = (sorted.length - 1) * p;
  const lo = Math.floor(place), hi = Math.ceil(place);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (place - lo);
}
export function bootstrap(rows: Observation[], repetitions = 2000, seed = 15015) {
  const bySession = new Map<string, Observation[]>();
  for (const row of rows) bySession.set(row.session, [...(bySession.get(row.session) ?? []), row]);
  const sessions = [...bySession.values()];
  const random = rng(seed);
  const raw: number[] = [], adjusted: number[] = [];
  for (let run = 0; run < repetitions; run++) {
    const sample: Observation[] = [];
    for (let n = 0; n < sessions.length; n++) sample.push(...sessions[Math.floor(random() * sessions.length)]!);
    const result = estimate(sample);
    if (result.rawDifference !== null) raw.push(result.rawDifference);
    if (result.adjustedDifference !== null) adjusted.push(result.adjustedDifference);
  }
  return {repetitions, validRaw: raw.length, validAdjusted: adjusted.length,
    raw95: [quantile(raw, .025), quantile(raw, .975)],
    adjusted95: [quantile(adjusted, .025), quantile(adjusted, .975)]};
}

export function describe(rows: Observation[]) {
  const eligible = rows.filter(r => r.outcome !== null);
  const outcomes = eligible.map(r => r.outcome!);
  const average = (field: 'mfe' | 'mae') => mean(eligible.map(r => r[field]).filter((v): v is number => v !== null));
  return {signals: rows.length, eligible: eligible.length,
    sessions: new Set(eligible.map(r => r.session)).size,
    meanSignedPercent: mean(outcomes), favorableRate: outcomes.length ?
      outcomes.filter(v => v > 0).length / outcomes.length : null,
    meanMfePercent: average('mfe'), meanMaePercent: average('mae'),
    costSensitivity: [0, 5, 10, 20].map(bps => ({bps,
      meanNetPercent: outcomes.length ? mean(outcomes)! - bps / 100 : null,
      favorableNetRate: outcomes.length ? outcomes.filter(v => v > bps / 100).length / outcomes.length : null}))};
}
