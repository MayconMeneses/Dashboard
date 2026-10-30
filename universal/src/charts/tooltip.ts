/** Valor de uma célula como texto puro: o Leaflet trata string como HTML, e o conteúdo vem do arquivo do usuário. */
export function tooltipText(s: string): HTMLElement {
  const span = document.createElement('span');
  span.textContent = s;
  return span;
}
