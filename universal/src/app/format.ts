/** Texto de uma célula na tabela e no relatório: data local, “—” para vazio (nunca zero). */
export const cellText = (v: unknown) => (v instanceof Date ? v.toLocaleDateString('pt-BR') : v == null ? '—' : String(v));
