import { el } from './dom.js';

/** Aplica a ordem salva aos gráficos; os que a ordem não conhece (novos) vão depois, na ordem original. */
export function aplicarOrdem<T extends { id: string }>(specs: T[], ordem: string[]): T[] {
  if (!ordem.length) return specs;
  const pos = new Map(ordem.map((id, i) => [id, i]));
  return [...specs].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity) || specs.indexOf(a) - specs.indexOf(b));
}

/** Nova ordem depois de mover `id` uma posição (delta -1 = para antes, +1 = para depois) dentro da ordem visível `ids`. */
export function moverUma(ids: string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Nova ordem depois de soltar `id` sobre `alvo` (antes dele ou depois, conforme a metade do cartão em que se soltou). */
export function soltarSobre(ids: string[], id: string, alvo: string, depois: boolean): string[] {
  if (id === alvo || !ids.includes(id) || !ids.includes(alvo)) return ids;
  const sem = ids.filter((x) => x !== id);
  sem.splice(sem.indexOf(alvo) + (depois ? 1 : 0), 0, id);
  return sem;
}

/** Marca o cartão com o id do gráfico (a reordenação precisa dele). */
export const comId = (card: HTMLElement, id: string): HTMLElement => {
  card.dataset.id = id;
  return card;
};

/**
 * Reordenar os cartões: botões “para antes / para depois” (teclado e leitor de tela) e alça para arrastar com o mouse.
 * O arrasto começa só na alça, para não competir com os cliques e o arrasto dentro do gráfico.
 */
export function tornarReordenavel(container: HTMLElement, onOrdem: (nova: string[]) => void): void {
  const ids = () => [...container.querySelectorAll<HTMLElement>(':scope > .chart[data-id]')].map((c) => c.dataset.id!);
  for (const card of container.querySelectorAll<HTMLElement>(':scope > .chart[data-id]')) {
    const id = card.dataset.id!;
    const header = card.querySelector('header');
    if (!header) continue;
    const titulo = header.querySelector('h3')?.textContent ?? 'gráfico';
    const antes = el('button', { type: 'button', className: 'mover', ariaLabel: `Mover “${titulo}” para antes`, title: 'Mover para antes' }, '↑');
    const depois = el('button', { type: 'button', className: 'mover', ariaLabel: `Mover “${titulo}” para depois`, title: 'Mover para depois' }, '↓');
    const alca = el('span', { className: 'alca', title: 'Arraste para mudar a posição', ariaHidden: 'true' }, '⠿');
    alca.draggable = true;
    antes.onclick = () => onOrdem(moverUma(ids(), id, -1));
    depois.onclick = () => onOrdem(moverUma(ids(), id, 1));
    alca.ondragstart = (e) => {
      e.dataTransfer?.setData('text/plain', id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      card.classList.add('arrastando');
      e.dataTransfer?.setDragImage(card, 20, 20);
    };
    alca.ondragend = () => card.classList.remove('arrastando');
    card.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };
    card.ondrop = (e) => {
      e.preventDefault();
      const origem = e.dataTransfer?.getData('text/plain');
      if (!origem) return;
      const r = card.getBoundingClientRect();
      onOrdem(soltarSobre(ids(), origem, id, e.clientY > r.top + r.height / 2));
    };
    header.append(el('span', { className: 'ordem' }, alca, antes, depois));
  }
}
