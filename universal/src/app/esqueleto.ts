import { $, el } from './dom.js';

/**
 * Esqueleto de carregamento: blocos cinza no lugar do conteúdo enquanto o arquivo é lido ou o PDF é gerado.
 * Anunciado a leitores de tela (role=status) e sem animação para quem pediu menos movimento.
 */
export async function comEsqueleto<T>(rotulo: string, tarefa: () => Promise<T>): Promise<T> {
  const box = $('carregando');
  box.replaceChildren(el('p', { className: 'carregando-txt' }, rotulo), el('div', { className: 'sk sk-linha' }), el('div', { className: 'sk sk-linha curta' }), el('div', { className: 'sk sk-bloco' }));
  box.setAttribute('role', 'status');
  box.hidden = false;
  // deixa o navegador desenhar o esqueleto antes de o trabalho pesado ocupar a tela
  await new Promise<void>((r) => setTimeout(r, 30));
  try {
    return await tarefa();
  } finally {
    box.hidden = true;
    box.replaceChildren();
  }
}
