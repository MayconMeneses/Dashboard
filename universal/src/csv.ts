export type Encoding = 'auto' | 'utf-8' | 'windows-1252';
export type DelimiterChoice = 'auto' | ',' | ';' | '\t' | '|';

export interface Decoded {
  text: string;
  encoding: 'UTF-8' | 'Windows-1252';
  /** true quando o arquivo não era UTF-8 válido e foi lido como Windows-1252 por conta própria */
  fellBack: boolean;
}

/** Decodifica texto: UTF-8 estrito; se houver bytes inválidos, usa Windows-1252 (padrão do Excel no Brasil). */
export function decodeText(bytes: Uint8Array, choice: Encoding = 'auto'): Decoded {
  const strip = (s: string) => s.replace(/^﻿/, '');
  if (choice === 'windows-1252') return { text: strip(new TextDecoder('windows-1252').decode(bytes)), encoding: 'Windows-1252', fellBack: false };
  try {
    return { text: strip(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'UTF-8', fellBack: false };
  } catch {
    if (choice === 'utf-8') return { text: strip(new TextDecoder('utf-8').decode(bytes)), encoding: 'UTF-8', fellBack: false };
    return { text: strip(new TextDecoder('windows-1252').decode(bytes)), encoding: 'Windows-1252', fellBack: true };
  }
}

/** Conta ocorrências do separador fora de aspas em uma linha. */
function countOutsideQuotes(line: string, sep: string): number {
  let inQ = false;
  let n = 0;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch === sep) n++;
  }
  return n;
}

/** Escolhe o separador mais consistente nas primeiras linhas (mesmo número de separadores em quase todas). */
export function detectDelimiter(text: string): ',' | ';' | '\t' | '|' {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 40);
  let best: ',' | ';' | '\t' | '|' = ',';
  let bestScore = 0;
  for (const sep of [';', '\t', '|', ','] as const) {
    const counts = lines.map((l) => countOutsideQuotes(l, sep));
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 0;
    let modeN = 0;
    for (const [c, n] of freq) if (c > 0 && n > modeN) (mode = c), (modeN = n);
    if (!mode || !lines.length) continue;
    const score = mode * (modeN / lines.length) * (modeN / lines.length);
    if (modeN / lines.length >= 0.6 && score > bestScore) (best = sep), (bestScore = score);
  }
  return best;
}

export const delimiterName = (d: string) => ({ ',': 'vírgula', ';': 'ponto e vírgula', '\t': 'tabulação', '|': 'barra vertical' })[d] ?? d;
