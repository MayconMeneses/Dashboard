/** Texto de uma célula na tabela e no relatório: data local, “—” para vazio (nunca zero). */
export const cellText = (v: unknown) => (v instanceof Date ? v.toLocaleDateString('pt-BR') : v == null ? '—' : String(v));

export const TYPE_NAMES: Record<string, string> = { number: 'número', integer: 'inteiro', date: 'data', category: 'categoria', boolean: 'sim/não', text: 'texto', id: 'identificador', lat: 'latitude', lon: 'longitude' };
