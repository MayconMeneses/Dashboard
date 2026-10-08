/** máximo/mínimo sem espalhar o array nos argumentos (o `Math.max(...a)` estoura a pilha com ~100 mil itens) */
export function maxOf(a: readonly number[], init = -Infinity): number {
  let m = init;
  for (const v of a) if (v > m) m = v;
  return m;
}
export function minOf(a: readonly number[], init = Infinity): number {
  let m = init;
  for (const v of a) if (v < m) m = v;
  return m;
}
