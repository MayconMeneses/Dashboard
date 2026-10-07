import { levenshtein, normalizeName } from './text.js';

/** Marcadores de ponta de trecho ("Início", "Final"...), inclusive colados ("Início/Final") ou com acento corrompido. */
const MARK = String.raw`(?:in\S{0,3}cio|inicial|incial|final)(?:\s*[/\\-]\s*(?:in\S{0,3}cio|inicial|incial|final))?`;
export const START_END_RE = new RegExp(String.raw`\s*\b(?:c[oó]d\.?\s*)?\d{2,6}\s*(?:${MARK})?\s*$`, 'i');
export const START_END_WORD_RE = new RegExp(String.raw`\s*\b${MARK}\s*$`, 'i');

export function hasStartEndMarker(name: string): boolean {
  return new RegExp(String.raw`\b\d{2,6}\s*${MARK}\s*$`, 'i').test(name) || /\bc[oó]d\.?\s*\d{2,6}\b/i.test(name);
}

/** "Vila Holanda cod 0001 Início" -> "Vila Holanda"; "Caiçara 00066 Final" -> "Caiçara". */
export function cleanLocalityName(name: string): string {
  return name
    .replace(/[\s/\\.,;:–-]+$/, '')
    .replace(START_END_RE, '')
    .replace(START_END_WORD_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Resolution {
  key: string;
  name: string;
  matched: boolean;
  how: 'exata' | 'alias' | 'semelhante' | 'parcial' | 'nova';
}

/** Conjunto de localidades conhecidas e resolução de grafias (exata, alias do usuário, semelhante, parcial). */
export class LocalityBook {
  private names = new Map<string, string>();
  private aliases = new Map<string, string>();

  constructor(aliases: Record<string, string> = {}) {
    for (const [from, to] of Object.entries(aliases)) this.aliases.set(normalizeName(from), to);
  }

  get size(): number {
    return this.names.size;
  }

  entries(): [string, string][] {
    return [...this.names];
  }

  display(key: string): string | undefined {
    return this.names.get(key);
  }

  /** Registra uma localidade conhecida (primeira grafia vale como nome de exibição). */
  add(name: string): string {
    const target = this.aliases.get(normalizeName(name)) ?? name;
    const key = normalizeName(target);
    if (key && !this.names.has(key)) this.names.set(key, target.replace(/\s+/g, ' ').trim());
    return key;
  }

  resolve(raw: string, allowCreate: boolean): Resolution {
    const aliased = this.aliases.get(normalizeName(raw));
    const name = (aliased ?? raw).replace(/\s+/g, ' ').trim();
    const key = normalizeName(name);
    if (this.names.has(key)) return { key, name: this.names.get(key)!, matched: true, how: aliased ? 'alias' : 'exata' };
    // semelhante (erro de digitação): menor distância, desde que única
    if (key.length >= 5) {
      const max = key.length >= 14 ? 3 : 2;
      let best = max + 1;
      let hit: string[] = [];
      for (const k of this.names.keys()) {
        if (Math.abs(k.length - key.length) > max) continue;
        const d = levenshtein(k, key);
        if (d < best) {
          best = d;
          hit = [k];
        } else if (d === best && d <= max) hit.push(k);
      }
      if (hit.length === 1 && best <= max) return { key: hit[0]!, name: this.names.get(hit[0]!)!, matched: true, how: 'semelhante' };
    }
    // parcial: todas as palavras do nome estão em exatamente uma localidade (ex.: "Sede" -> "Croatá (Sede)")
    const toks = key.split(' ').filter((t) => t.length >= 3);
    if (toks.length) {
      const hits = [...this.names.keys()].filter((k) => {
        const kt = k.split(' ');
        return toks.every((t) => kt.includes(t));
      });
      if (hits.length === 1) return { key: hits[0]!, name: this.names.get(hits[0]!)!, matched: true, how: 'parcial' };
    }
    if (allowCreate) this.add(name);
    return { key, name, matched: false, how: 'nova' };
  }
}
