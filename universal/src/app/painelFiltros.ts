import { $, el } from './dom.js';
import type { PainelCtx } from './painelCtx.js';

let aberto = false;
let colunaEscolhida = '';

const aplicados = (ctx: PainelCtx): { texto: string; remover: () => void }[] => {
  const out = Object.entries(ctx.filters()).map(([k, v]) => ({ texto: `${k}: ${v}`, remover: () => ctx.setFilter(k, null) }));
  if (ctx.search().trim()) out.push({ texto: `Busca: ${ctx.search().trim()}`, remover: () => ctx.setSearch('') });
  const r = ctx.dateRange();
  if (r.col && (r.from || r.to)) out.push({ texto: `${r.col}: ${r.from ?? '…'} a ${r.to ?? '…'}`, remover: () => ctx.setDateRange({}) });
  return out;
};

function abrir(v: boolean, ctx: PainelCtx) {
  aberto = v;
  ($('painelFiltros') as HTMLElement).hidden = !v;
  $('btnFiltros').setAttribute('aria-expanded', String(v));
  renderPainel(ctx);
  if (v) ($('pfTitulo') as HTMLElement).focus();
  else $('btnFiltros').focus();
}

/** Painel lateral de filtros: o que está aplicado (com remover), um formulário para acrescentar filtro por coluna e valor, e “limpar tudo”. */
export function initPainel(ctx: PainelCtx): void {
  $('btnFiltros').onclick = () => abrir(!aberto, ctx);
  $('pfFechar').onclick = () => abrir(false, ctx);
  // Esc fecha o painel de onde estiver o foco (o foco pode ter saído do painel quando ele se redesenha)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aberto) abrir(false, ctx);
  });
}

export function renderPainel(ctx: PainelCtx): void {
  const lista = aplicados(ctx);
  $('btnFiltros').textContent = lista.length ? `Filtros (${lista.length})` : 'Filtros';
  if (!aberto) return;
  const cols = ctx.prof().filter((p) => (p.type === 'category' || p.type === 'boolean') && (p.top?.length ?? 0) > 0);
  if (!cols.some((c) => c.name === colunaEscolhida)) colunaEscolhida = cols[0]?.name ?? '';
  const atual = cols.find((c) => c.name === colunaEscolhida);
  const colSel = el('select', { id: 'pfColuna', ariaLabel: 'Coluna do filtro' }, ...cols.map((c) => el('option', { value: c.name, selected: c.name === colunaEscolhida }, c.name)));
  colSel.onchange = () => {
    colunaEscolhida = colSel.value;
    renderPainel(ctx);
  };
  const valSel = el('select', { id: 'pfValor', ariaLabel: 'Valor do filtro' }, ...(atual?.top ?? []).slice(0, 200).map((t) => el('option', { value: t.value }, `${t.value} (${t.count})`)));
  const aplicar = el('button', { type: 'button', className: 'primary', id: 'pfAplicar', disabled: !atual }, 'Aplicar filtro');
  aplicar.onclick = () => atual && ctx.setFilter(atual.name, valSel.value);
  const limpar = el('button', { type: 'button', id: 'pfLimpar', disabled: !lista.length }, 'Limpar todos os filtros');
  limpar.onclick = () => ctx.limparTudo();
  const focoAntes = ($('painelFiltros').contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '') || '';
  $('pfCorpo').replaceChildren(
    el('h3', {}, 'Aplicados'),
    lista.length
      ? el('ul', { className: 'pf-lista' }, ...lista.map((a) => {
          const b = el('button', { type: 'button', className: 'mini', ariaLabel: `Remover ${a.texto}` }, 'Remover');
          b.onclick = a.remover;
          return el('li', {}, a.texto, ' ', b);
        }))
      : el('p', { className: 'muted' }, 'Nenhum filtro aplicado. Clique numa barra ou fatia, use a busca do topo ou acrescente um abaixo.'),
    el('h3', {}, 'Acrescentar filtro'),
    cols.length
      ? el('p', { className: 'rate-pick' }, el('label', {}, 'Coluna: ', colSel), ' ', el('label', {}, 'Valor: ', valSel), ' ', aplicar)
      : el('p', { className: 'muted' }, 'Não há colunas de categoria para filtrar.'),
    el('p', {}, limpar),
  );
  // o painel se redesenha a cada mudança: o foco volta ao mesmo controle (ou ao título, se ele sumiu ou ficou desativado)
  if (focoAntes) {
    const igual = document.getElementById(focoAntes) as HTMLButtonElement | null;
    (igual && !igual.disabled ? igual : ($('pfTitulo') as HTMLElement)).focus();
  }
}
