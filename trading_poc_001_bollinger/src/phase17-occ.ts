export type OccContract = {occSymbol: string; underlyingSymbol: string;
  optionType: 'CALL' | 'PUT'; strike: number; expiration: string; multiplier: 100};

export function parseOccSymbol(value: string): OccContract {
  const match = /^(\S.{5})(\d{6})([CP])(\d{8})$/.exec(value);
  if (!match) throw new Error('Símbolo OCC inválido: se requieren 21 caracteres.');
  const underlyingSymbol = match[1]!.trim();
  if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(underlyingSymbol)) throw new Error('Raíz OCC inválida.');
  const date = `20${match[2]!.slice(0, 2)}-${match[2]!.slice(2, 4)}-${match[2]!.slice(4, 6)}`;
  const expiration = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(expiration.getTime()) ||
      expiration.toISOString().slice(0, 10) !== date) {
    throw new Error('Vencimiento OCC inválido.');
  }
  return {occSymbol: value, underlyingSymbol,
    optionType: match[3] === 'C' ? 'CALL' : 'PUT',
    strike: Number(match[4]) / 1000, expiration: date, multiplier: 100};
}
