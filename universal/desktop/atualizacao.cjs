// Atualização automática do painel, sem Electron: dependências injetadas para poder testar a lógica de verdade (test/atualizacao.test.ts).
// Fluxo: lê o manifesto (versao.json) -> se há painel mais novo, PERGUNTA -> só então baixa, confere o SHA-256 e a estrutura e grava.
'use strict';
const crypto = require('node:crypto');
const fsReal = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');

const MAX_HTML = 25 * 1024 * 1024;
const MAX_MANIFESTO = 64 * 1024;
const MAX_REDIRECIONAMENTOS = 5;
/** Título que todo painel legítimo tem (conferido ao baixar). */
const TITULO_ESPERADO = '<title>Dashboard';

const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
};

const ehLoopback = (u) => {
  try {
    const h = new URL(u).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
};

/** Só HTTPS; HTTP apenas para o próprio computador (127.0.0.1/localhost) e só quando o teste liga a opção. */
const urlPermitida = (url, permitirLoopbackHttp) => url.startsWith('https://') || (!!permitirLoopbackHttp && url.startsWith('http://') && ehLoopback(url));

function baixar(url, limite, opts = {}) {
  const { permitirLoopbackHttp = false, versaoPrograma = '0', redirecionamentos = 0 } = opts;
  return new Promise((resolve, reject) => {
    if (!urlPermitida(url, permitirLoopbackHttp)) return reject(new Error('Endereço de atualização inválido.'));
    if (redirecionamentos > MAX_REDIRECIONAMENTOS) return reject(new Error('Redirecionamentos demais.'));
    const lib = url.startsWith('https://') ? https : http;
    const req = lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'DashboardUniversal/' + versaoPrograma, 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return baixar(new URL(res.headers.location, url).toString(), limite, { ...opts, redirecionamentos: redirecionamentos + 1 }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const partes = [];
      let total = 0;
      let excedeu = false;
      res.on('data', (c) => {
        total += c.length;
        if (total > limite) {
          // sem passar erro ao destroy: com a resposta já inteira recebida, o erro não tem para onde ir e vira exceção não tratada no processo principal
          excedeu = true;
          reject(new Error('Arquivo grande demais.'));
          res.destroy();
        } else partes.push(c);
      });
      // resposta cortada no meio ou acima do limite nunca vira um arquivo “completo” (antes, o fim do fluxo resolvia com o que tinha chegado)
      res.on('end', () => (excedeu ? reject(new Error('Arquivo grande demais.')) : resolve(Buffer.concat(partes))));
      res.on('close', () => {
        if (!res.complete) reject(new Error(excedeu ? 'Arquivo grande demais.' : 'Conexão interrompida.'));
      });
      res.on('error', reject);
    });
    req.on('timeout', () => {
      reject(new Error('Tempo esgotado.'));
      req.destroy();
    });
    req.on('error', reject);
  });
}

async function lerManifesto(urlBase, baixarFn) {
  const m = JSON.parse((await baixarFn(urlBase + '/versao.json', MAX_MANIFESTO)).toString('utf8'));
  if (!m || !/^\d+\.\d+\.\d+$/.test(m.versao) || !/^[0-9a-f]{64}$/.test(m.sha256)) throw new Error('Manifesto inválido.');
  return m;
}

/** Painel em uso: o baixado (se for mais novo que o embutido) ou o embutido. */
function painelEmUso({ dirPainel, embutido, versaoEmbutida, fs = fsReal }) {
  try {
    const v = fs.readFileSync(path.join(dirPainel, 'versao.txt'), 'utf8').trim();
    const arq = path.join(dirPainel, 'index.html');
    if (/^\d+\.\d+\.\d+$/.test(v) && fs.existsSync(arq) && cmpVer(v, versaoEmbutida) > 0) return { arquivo: arq, versao: v };
  } catch {
    /* sem atualização baixada */
  }
  return { arquivo: embutido, versao: versaoEmbutida };
}

/** Baixa o painel, confere o SHA-256 do manifesto e o título, e só então grava (arquivo temporário + troca). */
async function baixarEGravar({ urlBase, manifesto, dirPainel, baixarFn, fs = fsReal }) {
  const html = await baixarFn(urlBase + '/index.html', MAX_HTML);
  if (crypto.createHash('sha256').update(html).digest('hex') !== manifesto.sha256) throw new Error('O arquivo baixado não confere (SHA-256).');
  if (!html.includes(TITULO_ESPERADO)) throw new Error('Arquivo de atualização inesperado.');
  fs.mkdirSync(dirPainel, { recursive: true });
  const destino = path.join(dirPainel, 'index.html');
  const tmp = destino + '.novo';
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, destino);
  fs.writeFileSync(path.join(dirPainel, 'versao.txt'), manifesto.versao);
}

/**
 * Verifica e, se o usuário aceitar, atualiza. Devolve a ação tomada:
 * 'sem-atualizacao' | 'programa' (precisa de instalador novo) | 'adiada' (usuário escolheu “Depois”; nada foi baixado) |
 * 'atualizado' | 'erro' (com `etapa`: 'manifesto' = sem rede ou manifesto inválido; 'download' = falha depois do “sim”).
 */
async function verificarEAtualizar({ urlBase, programa, painelAtual, dirPainel, baixarFn, perguntar, fs = fsReal }) {
  let manifesto;
  try {
    manifesto = await lerManifesto(urlBase, baixarFn);
  } catch (e) {
    return { acao: 'erro', etapa: 'manifesto', erro: e.message };
  }
  if (manifesto.programaMinimo && cmpVer(programa, manifesto.programaMinimo) < 0) return { acao: 'programa', versao: manifesto.versao };
  if (cmpVer(manifesto.versao, painelAtual) <= 0) return { acao: 'sem-atualizacao' };
  if (!(await perguntar({ versao: manifesto.versao, atual: painelAtual }))) return { acao: 'adiada', versao: manifesto.versao };
  try {
    await baixarEGravar({ urlBase, manifesto, dirPainel, baixarFn, fs });
  } catch (e) {
    return { acao: 'erro', etapa: 'download', erro: e.message };
  }
  return { acao: 'atualizado', versao: manifesto.versao };
}

module.exports = { cmpVer, ehLoopback, urlPermitida, baixar, lerManifesto, painelEmUso, baixarEGravar, verificarEAtualizar, TITULO_ESPERADO, MAX_REDIRECIONAMENTOS };
