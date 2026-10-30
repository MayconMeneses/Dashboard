import { analyzeJoin, tableId } from '../join/join.js';
import type { JoinAnalysis } from '../join/join.js';
import type { Dataset, JoinSpec, Table } from '../types.js';
import { $, el } from './dom.js';

export interface JoinHost {
  dataset(): Dataset | null;
  confirm(spec: JoinSpec): void;
}

let spec: JoinSpec | null = null;
let analysis: JoinAnalysis | null = null;

const eligible = (ds: Dataset | null): Table[] => (ds ? ds.tables.filter((t) => !t.tidy && !t.noCharts) : []);
const guessKey = (a: Table, b: Table): string => a.columns.find((c) => b.columns.includes(c)) ?? a.columns[0] ?? '';

/**
 * Painel “Relacionar tabelas”: o usuário escolhe as duas tabelas e a chave, vê a análise (quem não encontrou par, chaves repetidas,
 * valores que se repetem e inflam somas) e só então confirma. Nada é criado antes da confirmação.
 */
export function renderJoinPanel(host: JoinHost, keep = false): void {
  const box = $('secRelacionar');
  const tabs = eligible(host.dataset());
  box.hidden = tabs.length < 2;
  if (box.hidden) return;
  const byId = (id: string) => tabs.find((t) => tableId(t) === id) ?? tabs[0]!;
  if (!keep || !spec || !tabs.some((t) => tableId(t) === spec!.left) || !tabs.some((t) => tableId(t) === spec!.right)) {
    const [a, b] = [tabs[0]!, tabs[1]!];
    spec = { kind: 'chave', left: tableId(a), right: tableId(b), leftKey: guessKey(a, b), rightKey: guessKey(b, a), how: 'left' };
    analysis = null;
  }
  const s = spec;
  const redraw = (clear = true) => {
    if (clear) analysis = null;
    renderJoinPanel(host, true);
  };
  const pick = <V extends string>(label: string, value: V, opts: [V, string][], set: (v: V) => void) => {
    const sel = el('select', { ariaLabel: label }, ...opts.map(([v, n]) => el('option', { value: v, selected: v === value }, n)));
    sel.onchange = () => {
      set(sel.value as V);
      redraw();
    };
    return el('label', { className: 'explore-pick' }, `${label}: `, sel);
  };
  const names = tabs.map((t) => [tableId(t), tableId(t)] as [string, string]);
  const L = byId(s.left);
  const R = byId(s.right);
  const form = el(
    'p',
    { className: 'rate-pick' },
    pick('Tipo', s.kind, [['chave', 'Por chave (junção)'], ['pontos', 'Contar pontos dentro de polígonos']], (v) => (spec = { ...s, kind: v })),
    ' ',
    pick('Tabela da esquerda', s.left, names, (v) => (spec = { ...s, left: v, leftKey: guessKey(byId(v), R) })),
    ' ',
    pick('Tabela da direita', s.right, names, (v) => (spec = { ...s, right: v, rightKey: guessKey(byId(v), L) })),
  );
  if (s.kind === 'chave') {
    form.append(
      ' ',
      pick('Chave da esquerda', s.leftKey, L.columns.map((c) => [c, c] as [string, string]), (v) => (spec = { ...s, leftKey: v })),
      ' ',
      pick('Chave da direita', s.rightKey, R.columns.map((c) => [c, c] as [string, string]), (v) => (spec = { ...s, rightKey: v })),
      ' ',
      pick('Manter', s.how, [['left', 'todas as linhas da esquerda'], ['inner', 'só as que têm par']], (v) => (spec = { ...s, how: v })),
    );
  }
  const go = el('button', { type: 'button', className: 'primary' }, 'Analisar relação');
  go.onclick = () => {
    analysis = analyzeJoin(L, R, s);
    redraw(false);
  };
  const out: HTMLElement[] = [];
  if (analysis) {
    const a = analysis;
    const li = (t: string, cls = 'info') => el('li', { className: cls }, t);
    const n = (x: number) => new Intl.NumberFormat('pt-BR').format(x);
    out.push(
      el('h3', {}, 'O que vai acontecer (nada foi criado ainda)'),
      el(
        'ul',
        { role: 'status', id: 'joinAnalysis' },
        ...(s.kind === 'chave'
          ? [
              li(`Tipo de relação: ${a.cardinality}. Resultado: ${n(a.resultRows)} linha(s) (esquerda ${n(a.leftRows)}, direita ${n(a.rightRows)}).`),
              li(`${n(a.matched)} linha(s) da esquerda encontraram par; ${n(a.unmatchedLeft)} não${a.examplesLeft.length ? ` (ex.: ${a.examplesLeft.map((k) => `“${k}”`).join(', ')})` : ''}.`),
              li(`${n(a.unmatchedRight)} linha(s) da direita não existem na esquerda${a.examplesRight.length ? ` (ex.: ${a.examplesRight.map((k) => `“${k}”`).join(', ')})` : ''}.`),
              li(`Chaves vazias: ${n(a.nullLeft)} na esquerda e ${n(a.nullRight)} na direita (chave vazia nunca casa).`),
              ...(a.dupLeft.length ? [li(`Chaves repetidas na esquerda: ${a.dupLeft.map((d) => `“${d.key}” (${d.count}×)`).join(', ')}.`, 'warn')] : []),
              ...(a.dupRight.length ? [li(`Chaves repetidas na direita: ${a.dupRight.map((d) => `“${d.key}” (${d.count}×)`).join(', ')}.`, 'warn')] : []),
            ]
          : [li(`Cada polígono de “${s.left}” receberá a contagem de pontos de “${s.right}”; a tabela terá as mesmas ${n(a.leftRows)} linhas.`)]),
        ...a.warnings.map((w) => li(w, 'warn')),
        ...a.hints.map((h) => li(h)),
        ...a.blockers.map((b) => li(`Não é possível: ${b}`, 'warn')),
      ),
    );
    const ok = el('button', { type: 'button', className: 'primary', id: 'joinConfirm', disabled: a.blockers.length > 0 }, 'Confirmar relação');
    ok.onclick = () => host.confirm(s);
    const cancel = el('button', { type: 'button', id: 'joinCancel' }, 'Cancelar');
    cancel.onclick = () => redraw();
    out.push(el('div', { className: 'btns' }, cancel, ok));
  }
  box.replaceChildren(el('h2', {}, 'Relacionar tabelas'), el('p', { className: 'muted' }, 'Cruze duas tabelas (de arquivos diferentes ou do mesmo arquivo). Você vê a análise antes de confirmar.'), form, el('div', { className: 'btns' }, go), ...out);
}
