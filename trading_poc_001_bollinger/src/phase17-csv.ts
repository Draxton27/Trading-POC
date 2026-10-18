/** Small RFC 4180 reader for the documented single-record import formats. */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {field += '"'; i++;}
      else if (field === '' || quoted) quoted = !quoted;
      else throw new Error('Comillas CSV fuera de campo.');
    } else if (char === ',' && !quoted) {row.push(field); field = '';}
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('Comillas CSV incompletas.');
  if (row.length || field !== '') {row.push(field); rows.push(row);}
  return rows;
}

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
