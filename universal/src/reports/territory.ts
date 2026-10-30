import { semanticProfile } from '../analytics/semantic.js';
import { validateGeometry } from '../geo/geometry.js';
import { classBreaks, classOf } from '../geo/thematic.js';
import { toNumber } from '../profile.js';
import type { ColProfile, Table } from '../types.js';

export interface Territory {
  title: string;
  columns: string[];
  rows: string[][];
  notes: string[];
}

const fmt = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);
const CLASSES = 5;

/**
 * Tabela territorial para o relatório (o mapa fica de fora do PDF): uma linha por unidade, com a medida e a classe por quantis;
 * “sem dado” quando a medida está vazia. Só existe para tabelas com coordenadas ou formas.
 */
export function buildTerritory(t: Table, prof: ColProfile[], limit = 30): Territory | undefined {
  if (!t.geo) return undefined;
  const sem = semanticProfile(t, prof);
  const measure = prof.find((p) => (p.type === 'number' || p.type === 'integer') && p.name !== t.geo!.lat && p.name !== t.geo!.lon && sem.find((s) => s.name === p.name)?.role === 'measure');
  const label = t.columns.find((c) => c !== t.geo!.lat && c !== t.geo!.lon && c !== t.geo!.id && c !== 'geometria' && c !== measure?.name && prof.find((p) => p.name === c)?.type !== 'number');
  const idCol = t.geo.id;
  const units = t.rows.map((r) => {
    const g = idCol && r[idCol] != null ? t.shapes?.[String(r[idCol])] : undefined;
    return { name: label ? String(r[label] ?? '—') : '—', type: g?.type ?? (toNumber(r[t.geo!.lat] ?? null) != null ? 'Point' : 'sem geometria'), value: measure ? toNumber(r[measure.name] ?? null) : null, problems: g ? validateGeometry(g).length : 0 };
  });
  const vals = units.map((u) => u.value).filter((v): v is number => v != null);
  const breaks = classBreaks(vals, CLASSES);
  const ordered = [...units].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  const rows = ordered.slice(0, limit).map((u) => [u.name, u.type, u.value == null ? 'sem dado' : fmt(u.value), measure ? (u.value == null ? 'sem dado' : `classe ${classOf(u.value, breaks) + 1} de ${breaks.length + 1}`) : '—']);
  const tipos = [...new Set(units.map((u) => u.type))].join(', ');
  const notes = [
    `${units.length} unidade(s) na tabela (tipos: ${tipos}); ${units.filter((u) => u.type === 'sem geometria').length} sem geometria e ${units.filter((u) => u.problems > 0).length} com problema de geometria.`,
    measure ? `Medida: “${measure.name}”. Classes por quantis (${breaks.length + 1} classes, mesma quantidade de unidades em cada uma). Totais brutos podem enganar quando as áreas têm tamanhos diferentes; prefira taxas.` : 'Não há coluna de medida numérica para classificar as unidades.',
    ...(units.length > limit ? [`Mostradas as ${limit} primeiras unidades, da maior para a menor medida; as ${units.length - limit} restantes estão no painel.`] : []),
    'O mapa não entra no PDF; esta tabela traz os mesmos dados do mapa temático.',
  ];
  return { title: 'Território', columns: ['Unidade', 'Geometria', measure?.name ?? 'Medida', 'Classe'], rows, notes };
}
