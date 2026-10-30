// "Sem God File" verificado por comando, não por opinião: tamanho por arquivo e ausência de dependências circulares.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listar(p) : /\.(ts|css)$/.test(f) ? [p] : [];
  });
}
const rel = (p: string) => p.slice(SRC.length + 1).split(sep).join('/');
const arquivos = listar(SRC).map((p) => ({ nome: rel(p), texto: readFileSync(p, 'utf8') }));

/** Limite geral por arquivo (linhas). Exceções são temporárias, com teto próprio, e só podem diminuir. */
const LIMITE = 400;
const EXCECOES: Record<string, number> = {
  'main.ts': 930, // orquestração da tela; segue sendo reduzido (relatórios, projeto, prévia e tabela ainda estão aqui)
};

describe('modularidade', () => {
  it(`nenhum arquivo de src/ passa de ${LIMITE} linhas (salvo exceção com teto)`, () => {
    const acima = arquivos
      .map((a) => ({ nome: a.nome, linhas: a.texto.split('\n').length }))
      .filter((a) => a.linhas > (EXCECOES[a.nome] ?? LIMITE));
    expect(acima, acima.map((a) => `${a.nome}: ${a.linhas} linhas`).join('; ')).toEqual([]);
  });

  it('exceções não ficam folgadas: o teto é no máximo 5% acima do tamanho atual', () => {
    for (const [nome, teto] of Object.entries(EXCECOES)) {
      const a = arquivos.find((x) => x.nome === nome)!;
      expect(teto, `${nome} tem ${a.texto.split('\n').length} linhas; reduza o teto`).toBeLessThanOrEqual(Math.ceil(a.texto.split('\n').length * 1.05));
    }
  });

  it('não há dependências circulares entre os módulos', () => {
    const ts = arquivos.filter((a) => a.nome.endsWith('.ts'));
    const grafo = new Map<string, string[]>();
    for (const a of ts) {
      const destinos = [...a.texto.matchAll(/from '(\.[^']+)\.js'/g)].map((m) => posix.join(posix.dirname(a.nome), `${m[1]}.ts`));
      grafo.set(a.nome, destinos);
    }
    const visto = new Set<string>();
    const pilha: string[] = [];
    const ciclos = new Set<string>();
    const visita = (n: string): void => {
      const i = pilha.indexOf(n);
      if (i >= 0) {
        ciclos.add([...pilha.slice(i), n].join(' -> '));
        return;
      }
      if (visto.has(n)) return;
      visto.add(n);
      pilha.push(n);
      for (const m of grafo.get(n) ?? []) visita(m);
      pilha.pop();
    };
    [...grafo.keys()].forEach(visita);
    expect([...ciclos]).toEqual([]);
  });
});
