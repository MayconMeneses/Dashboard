export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

export function download(name: string, mime: string, content: string | Uint8Array) {
  const a = el('a', { href: URL.createObjectURL(new Blob([content as BlobPart], { type: mime })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}
