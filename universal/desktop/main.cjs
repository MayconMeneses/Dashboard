// Aplicativo de desktop do Dashboard Universal: abre a página local e entrega arquivos escolhidos.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');

const pkg = require('./package.json');
// A atualização troca só o painel (um HTML); o programa em si muda raramente.
const URL_ATUALIZACAO = process.env.UNIVERSAL_UPDATE_URL || 'https://raw.githubusercontent.com/MayconMeneses/Dashboard/HEAD/universal/atualizacao';
const PAGINA_INSTALADORES = 'https://github.com/MayconMeneses/Dashboard/tree/HEAD/universal/instaladores';
const MAX_HTML = 25 * 1024 * 1024;

const EXT = ['csv', 'tsv', 'txt', 'xlsx', 'docx', 'doc', 'pdf', 'json', 'geojson', 'kml', 'kmz'];
let win = null;
let pending = null;

const fileFromArgs = (argv) => argv.slice(1).find((a) => !a.startsWith('-') && EXT.includes(path.extname(a).slice(1).toLowerCase()) && fs.existsSync(a));

async function openPath(file) {
  if (!file) return;
  if (!win) {
    pending = file;
    return;
  }
  try {
    if (fs.statSync(file).size > 50 * 1024 * 1024) throw new Error('Arquivo maior que 50 MB.');
    const b64 = fs.readFileSync(file).toString('base64');
    await win.webContents.executeJavaScript(`window.__abrirArquivo(${JSON.stringify(path.basename(file))}, ${JSON.stringify(b64)})`);
  } catch (e) {
    dialog.showErrorBox('Não foi possível abrir o arquivo', String(e.message || e));
  }
}

async function pick() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir arquivo de dados',
    properties: ['openFile'],
    filters: [{ name: 'Dados', extensions: EXT }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  if (!r.canceled && r.filePaths[0]) await openPath(r.filePaths[0]);
}


// ---------- atualização automática do painel ----------
const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
};

function baixar(url, limite) {
  return new Promise((resolve, reject) => {
    const permitido = url.startsWith('https://') || (process.env.UNIVERSAL_UPDATE_URL && url.startsWith('http://'));
    if (!permitido) return reject(new Error('Endereço de atualização inválido.'));
    const lib = url.startsWith('https://') ? https : http;
    const req = lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'DashboardUniversal/' + pkg.version, 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return baixar(new URL(res.headers.location, url).toString(), limite).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const partes = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > limite) req.destroy(new Error('Arquivo grande demais.'));
        else partes.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(partes)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado.')));
    req.on('error', reject);
  });
}

const dirAtual = () => path.join(app.getPath('userData'), 'painel');
const arqAtual = () => path.join(dirAtual(), 'index.html');
const arqVersao = () => path.join(dirAtual(), 'versao.txt');

/** Painel em uso: o baixado (se for mais novo que o embutido) ou o embutido. */
function painelEmUso() {
  try {
    const v = fs.readFileSync(arqVersao(), 'utf8').trim();
    if (fs.existsSync(arqAtual()) && cmpVer(v, pkg.painelVersao) > 0) return { arquivo: arqAtual(), versao: v };
  } catch {
    /* sem atualização baixada */
  }
  return { arquivo: path.join(__dirname, 'app', 'index.html'), versao: pkg.painelVersao };
}

/** Procura, valida e guarda uma versão nova do painel. Devolve a versão nova ou null. */
async function verificarAtualizacao() {
  const m = JSON.parse((await baixar(URL_ATUALIZACAO + '/versao.json', 64 * 1024)).toString('utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(m.versao) || !/^[0-9a-f]{64}$/.test(m.sha256)) throw new Error('Manifesto inválido.');
  if (m.programaMinimo && cmpVer(pkg.version, m.programaMinimo) < 0) return { precisaNovoInstalador: true };
  if (cmpVer(m.versao, painelEmUso().versao) <= 0) return null;
  const html = await baixar(URL_ATUALIZACAO + '/index.html', MAX_HTML);
  if (crypto.createHash('sha256').update(html).digest('hex') !== m.sha256) throw new Error('O arquivo baixado não confere (SHA-256).');
  if (!html.includes('<title>Dashboard') ) throw new Error('Arquivo de atualização inesperado.');
  fs.mkdirSync(dirAtual(), { recursive: true });
  const tmp = arqAtual() + '.novo';
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, arqAtual());
  fs.writeFileSync(arqVersao(), m.versao);
  return { versao: m.versao };
}

async function buscarAtualizacao(manual) {
  try {
    const r = await verificarAtualizacao();
    if (r && r.precisaNovoInstalador) {
      if (manual || !global.__avisouPrograma) {
        global.__avisouPrograma = true;
        const o = await dialog.showMessageBox(win, { type: 'info', message: 'Há uma versão nova do programa.', detail: 'Esta atualização exige baixar o instalador novamente.', buttons: ['Abrir página de download', 'Depois'], cancelId: 1 });
        if (o.response === 0) shell.openExternal(PAGINA_INSTALADORES);
      }
    } else if (r) {
      const o = await dialog.showMessageBox(win, { type: 'info', message: `Atualização ${r.versao} baixada.`, detail: 'Reiniciar o painel agora para usar a nova versão? (os dados abertos serão fechados)', buttons: ['Atualizar agora', 'Depois'], defaultId: 0, cancelId: 1 });
      if (o.response === 0) win.loadFile(painelEmUso().arquivo);
    } else if (manual) {
      dialog.showMessageBox(win, { type: 'info', message: 'Você já está com a versão mais recente.', detail: `Painel ${painelEmUso().versao} · programa ${pkg.version}` });
    }
  } catch (e) {
    if (manual) dialog.showMessageBox(win, { type: 'warning', message: 'Não foi possível verificar atualizações.', detail: `${e.message}\nConfira a conexão com a internet.` });
  }
}

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 860, title: 'Dashboard Universal', backgroundColor: '#f5f6f8', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.loadFile(painelEmUso().arquivo);
  // links externos abrem no navegador; a janela nunca navega para fora
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.once('did-finish-load', () => {
    if (!global.__verificou) {
      global.__verificou = true;
      if (lerConfig().autoUpdate !== false) setTimeout(() => buscarAtualizacao(false), 3000);
    }
    if (pending) {
      const f = pending;
      pending = null;
      openPath(f);
    }
  });
  win.on('closed', () => (win = null));
}

// preferências simples do programa (ex.: verificar atualizações ao abrir)
const arqConfig = () => path.join(app.getPath('userData'), 'config.json');
function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(arqConfig(), 'utf8'));
  } catch {
    return {};
  }
}
function gravarConfig(c) {
  try {
    fs.mkdirSync(path.dirname(arqConfig()), { recursive: true });
    fs.writeFileSync(arqConfig(), JSON.stringify(c));
  } catch {
    /* sem permissão: segue sem salvar */
  }
}

const makeMenu = () => Menu.buildFromTemplate([
  { label: 'Arquivo', submenu: [{ label: 'Abrir arquivo…', accelerator: 'CmdOrCtrl+O', click: pick }, { label: 'Imprimir / PDF', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() }, { type: 'separator' }, { role: 'quit', label: 'Sair' }] },
  { label: 'Ajuda', submenu: [{ label: 'Verificar atualizações agora', click: () => buscarAtualizacao(true) }, { label: 'Verificar atualizações ao abrir (acessa o GitHub)', type: 'checkbox', checked: lerConfig().autoUpdate !== false, click: (item) => gravarConfig({ ...lerConfig(), autoUpdate: item.checked }) }, { label: 'Baixar instaladores (GitHub)', click: () => shell.openExternal(PAGINA_INSTALADORES) }, { type: 'separator' }, { label: `Painel ${pkg.painelVersao} · programa ${pkg.version}`, enabled: false }] },
  { label: 'Exibir', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'togglefullscreen', label: 'Tela cheia' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { role: 'resetZoom', label: 'Tamanho normal' }] },
]);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    openPath(fileFromArgs(argv));
  });
  app.on('open-file', (e, f) => (e.preventDefault(), openPath(f)));
  app.whenReady().then(() => {
    Menu.setApplicationMenu(makeMenu());
    pending = fileFromArgs(process.argv);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
