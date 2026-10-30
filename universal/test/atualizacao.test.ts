// Atualização automática do painel (desktop/atualizacao.cjs): servidor HTTP local de verdade, pasta temporária de verdade, sem mocks de rede.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const upd = createRequire(import.meta.url)('../desktop/atualizacao.cjs') as {
  cmpVer: (a: string, b: string) => number;
  ehLoopback: (u: string) => boolean;
  urlPermitida: (u: string, loop: boolean) => boolean;
  baixar: (u: string, limite: number, o?: { permitirLoopbackHttp?: boolean }) => Promise<Buffer>;
  painelEmUso: (o: { dirPainel: string; embutido: string; versaoEmbutida: string }) => { arquivo: string; versao: string };
  verificarEAtualizar: (o: Record<string, unknown>) => Promise<{ acao: string; etapa?: string; erro?: string; versao?: string }>;
};

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const HTML = '<!doctype html><title>Dashboard Universal</title><p>painel novo</p>';

let server: Server;
let base = '';
let pedidos: string[] = [];
let rotas: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {};
let dir = '';

beforeEach(async () => {
  pedidos = [];
  rotas = {};
  dir = mkdtempSync(join(tmpdir(), 'universal-upd-'));
  server = createServer((req, res) => {
    pedidos.push(req.url ?? '');
    const h = rotas[req.url ?? ''];
    if (h) h(req, res);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const servir = (manifesto: Record<string, unknown>, html: string | Buffer = HTML) => {
  rotas['/versao.json'] = (_q, res) => res.end(JSON.stringify(manifesto));
  rotas['/index.html'] = (_q, res) => res.end(html);
};
const baixarFn = (u: string, limite: number) => upd.baixar(u, limite, { permitirLoopbackHttp: true });
const rodar = (extra: Record<string, unknown> = {}) =>
  upd.verificarEAtualizar({ urlBase: base, programa: '0.4.0', painelAtual: '0.8.0', dirPainel: join(dir, 'painel'), baixarFn, perguntar: async () => true, ...extra });

describe('versões e endereços', () => {
  it('compara versões numericamente (0.10.0 > 0.9.0)', () => {
    expect(upd.cmpVer('0.10.0', '0.9.0')).toBe(1);
    expect(upd.cmpVer('0.8.0', '0.8.0')).toBe(0);
    expect(upd.cmpVer('0.7.5', '0.8.0')).toBe(-1);
  });
  it('só HTTPS; HTTP apenas para o próprio computador e com o modo de teste ligado', () => {
    expect(upd.urlPermitida('https://raw.githubusercontent.com/x', false)).toBe(true);
    expect(upd.urlPermitida('http://127.0.0.1:9/x', false)).toBe(false);
    expect(upd.urlPermitida('http://127.0.0.1:9/x', true)).toBe(true);
    expect(upd.urlPermitida('http://exemplo.com/x', true)).toBe(false);
    expect(upd.urlPermitida('http://localhost.evil.com/x', true)).toBe(false);
    expect(upd.ehLoopback('http://localhost:80/')).toBe(true);
  });
});

describe('perguntar antes de baixar', () => {
  const manifesto = () => ({ versao: '0.9.0', sha256: sha(HTML), programaMinimo: '0.2.0' });
  it('versão nova + “sim”: baixa, confere e grava; o painel em uso passa a ser o novo', async () => {
    servir(manifesto());
    let perguntou: unknown;
    const r = await rodar({ perguntar: async (i: unknown) => ((perguntou = i), true) });
    expect(r).toEqual({ acao: 'atualizado', versao: '0.9.0' });
    expect(perguntou).toEqual({ versao: '0.9.0', atual: '0.8.0' });
    expect(readFileSync(join(dir, 'painel', 'index.html'), 'utf8')).toBe(HTML);
    expect(readFileSync(join(dir, 'painel', 'versao.txt'), 'utf8')).toBe('0.9.0');
    expect(upd.painelEmUso({ dirPainel: join(dir, 'painel'), embutido: 'embutido.html', versaoEmbutida: '0.8.0' })).toEqual({ arquivo: join(dir, 'painel', 'index.html'), versao: '0.9.0' });
  });
  it('“Depois”: não baixa nada, não grava nada e pergunta de novo na próxima abertura', async () => {
    servir(manifesto());
    const r = await rodar({ perguntar: async () => false });
    expect(r.acao).toBe('adiada');
    expect(pedidos).toEqual(['/versao.json']);
    expect(existsSync(join(dir, 'painel'))).toBe(false);
    const de_novo = await rodar({ perguntar: async () => true });
    expect(de_novo.acao).toBe('atualizado');
  });
  it('sem versão nova: nem pergunta', async () => {
    servir({ versao: '0.8.0', sha256: sha(HTML) });
    let perguntou = false;
    const r = await rodar({ perguntar: async () => ((perguntou = true), true) });
    expect(r.acao).toBe('sem-atualizacao');
    expect(perguntou).toBe(false);
  });
  it('versão mais velha que a atual (alguém reverteu o manifesto) não faz voltar atrás', async () => {
    servir({ versao: '0.7.5', sha256: sha(HTML) });
    expect((await rodar()).acao).toBe('sem-atualizacao');
  });
});

describe('integridade', () => {
  it('SHA-256 diferente: erro no download, nada é gravado e o painel anterior continua', async () => {
    servir({ versao: '0.9.0', sha256: sha('outro conteudo') });
    const anterior = join(dir, 'painel');
    const r = await rodar();
    expect(r).toMatchObject({ acao: 'erro', etapa: 'download' });
    expect(r.erro).toMatch(/SHA-256/);
    expect(existsSync(join(anterior, 'index.html'))).toBe(false);
    expect(upd.painelEmUso({ dirPainel: anterior, embutido: 'embutido.html', versaoEmbutida: '0.8.0' }).versao).toBe('0.8.0');
  });
  it('arquivo sem o título do painel é recusado mesmo com o hash certo', async () => {
    const estranho = '<!doctype html><title>Outra coisa</title>';
    servir({ versao: '0.9.0', sha256: sha(estranho) }, estranho);
    const r = await rodar();
    expect(r).toMatchObject({ acao: 'erro', etapa: 'download' });
    expect(r.erro).toMatch(/inesperado/);
  });
  it('manifesto inválido (versão ou hash fora do formato)', async () => {
    servir({ versao: '9', sha256: 'abc' });
    expect(await rodar()).toMatchObject({ acao: 'erro', etapa: 'manifesto' });
    servir({ versao: '0.9.0', sha256: 'Z'.repeat(64) });
    expect(await rodar()).toMatchObject({ acao: 'erro', etapa: 'manifesto' });
  });
  it('arquivo maior que o limite é interrompido', async () => {
    rotas['/grande'] = (_q, res) => res.end(Buffer.alloc(2048));
    await expect(upd.baixar(`${base}/grande`, 1024, { permitirLoopbackHttp: true })).rejects.toThrow(/grande demais/);
  });
});

describe('programa novo e rede', () => {
  it('manifesto pede programa mais novo: avisa e não baixa o painel', async () => {
    servir({ versao: '0.9.0', sha256: sha(HTML), programaMinimo: '0.5.0' });
    const r = await rodar();
    expect(r.acao).toBe('programa');
    expect(pedidos).toEqual(['/versao.json']);
  });
  it('sem rede: erro na etapa do manifesto (a abertura fica em silêncio)', async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const r = await rodar();
    expect(r).toMatchObject({ acao: 'erro', etapa: 'manifesto' });
    server = createServer();
    await new Promise<void>((r2) => server.listen(0, '127.0.0.1', r2));
  });
  it('até 5 redirecionamentos; o sexto é recusado', async () => {
    for (let i = 1; i <= 7; i++) rotas[`/r${i}`] = (_q, res) => ((res.statusCode = 302), res.setHeader('location', `/r${i + 1}`), res.end());
    rotas['/r8'] = (_q, res) => res.end('fim');
    rotas['/c1'] = (_q, res) => ((res.statusCode = 302), res.setHeader('location', '/c2'), res.end());
    rotas['/c2'] = (_q, res) => res.end('ok');
    expect((await upd.baixar(`${base}/c1`, 100, { permitirLoopbackHttp: true })).toString()).toBe('ok');
    await expect(upd.baixar(`${base}/r1`, 100, { permitirLoopbackHttp: true })).rejects.toThrow(/Redirecionamentos/);
  });
});

describe('painel em uso', () => {
  it('o baixado só vale se for mais novo que o embutido e estiver completo', () => {
    const d = join(dir, 'painel');
    expect(upd.painelEmUso({ dirPainel: d, embutido: 'e.html', versaoEmbutida: '0.8.0' }).arquivo).toBe('e.html');
    servir({ versao: '0.9.0', sha256: sha(HTML) });
    writeFileSync(join(dir, 'x'), '');
    return rodar().then(() => {
      expect(upd.painelEmUso({ dirPainel: d, embutido: 'e.html', versaoEmbutida: '0.9.0' }).arquivo).toBe('e.html'); // empate: vale o embutido
      expect(upd.painelEmUso({ dirPainel: d, embutido: 'e.html', versaoEmbutida: '1.0.0' }).arquivo).toBe('e.html'); // programa novo traz painel mais novo
      writeFileSync(join(d, 'versao.txt'), 'lixo');
      expect(upd.painelEmUso({ dirPainel: d, embutido: 'e.html', versaoEmbutida: '0.8.0' }).arquivo).toBe('e.html'); // versao.txt corrompido
    });
  });
});
