// Aplicativo de desktop do Dashboard Universal: abre a página local e entrega arquivos escolhidos.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('./package.json');
const upd = require('./atualizacao.cjs');
// A atualização troca só o painel (um HTML); o programa em si muda raramente.
const OVERRIDE = process.env.UNIVERSAL_UPDATE_URL;
const URL_ATUALIZACAO = OVERRIDE || 'https://raw.githubusercontent.com/MayconMeneses/Dashboard/HEAD/universal/atualizacao';
const PAGINA_INSTALADORES = 'https://github.com/MayconMeneses/Dashboard/tree/HEAD/universal/instaladores';
// Modo de teste: só quando o endereço de atualização é o próprio computador (127.0.0.1/localhost). Permite HTTP local e responder o aviso por variável de ambiente.
const MODO_TESTE = !!OVERRIDE && upd.ehLoopback(OVERRIDE);
const RESPOSTA_TESTE = MODO_TESTE ? process.env.UNIVERSAL_TEST_ANSWER : undefined;

const EXT = ['csv', 'tsv', 'txt', 'xlsx', 'docx', 'doc', 'pdf', 'json', 'geojson', 'kml', 'kmz', 'parquet'];
let win = null;
let pending = null;
// último arquivo entregue ao painel: se o painel for recarregado por uma atualização, ele é entregue de novo
let ultimoArquivo = null;

const fileFromArgs = (argv) => argv.slice(1).find((a) => !a.startsWith('-') && EXT.includes(path.extname(a).slice(1).toLowerCase()) && fs.existsSync(a));

// entregas ao painel em fila: uma atualização só recarrega o painel depois que a entrega em andamento terminou
let entregaAtual = Promise.resolve();

function openPath(file) {
  if (!file) return entregaAtual;
  if (!win) {
    pending = file;
    return entregaAtual;
  }
  ultimoArquivo = file;
  entregaAtual = entregaAtual.then(async () => {
    try {
      if (fs.statSync(file).size > 50 * 1024 * 1024) throw new Error('Arquivo maior que 50 MB.');
      const b64 = fs.readFileSync(file).toString('base64');
      await win.webContents.executeJavaScript(`window.__abrirArquivo(${JSON.stringify(path.basename(file))}, ${JSON.stringify(b64)})`);
    } catch (e) {
      ultimoArquivo = null;
      dialog.showErrorBox('Não foi possível abrir o arquivo', String(e.message || e));
    }
  });
  return entregaAtual;
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
const dirAtual = () => path.join(app.getPath('userData'), 'painel');
const painelEmUso = () => upd.painelEmUso({ dirPainel: dirAtual(), embutido: path.join(__dirname, 'app', 'index.html'), versaoEmbutida: pkg.painelVersao });

// no modo de teste nenhuma caixa nativa aparece (ninguém para clicar nela)
const caixa = (opts) => (MODO_TESTE ? Promise.resolve({ response: 1 }) : dialog.showMessageBox(win, opts));

/** Pergunta assim que o programa abre; só baixa se o usuário aceitar. “Depois” não guarda nada e a pergunta volta na próxima abertura. */
async function buscarAtualizacao(manual) {
  const r = await upd.verificarEAtualizar({
    urlBase: URL_ATUALIZACAO,
    programa: pkg.version,
    painelAtual: painelEmUso().versao,
    dirPainel: dirAtual(),
    baixarFn: (u, limite) => upd.baixar(u, limite, { permitirLoopbackHttp: MODO_TESTE, versaoPrograma: pkg.version }),
    perguntar: async ({ versao, atual }) => {
      if (RESPOSTA_TESTE) return RESPOSTA_TESTE === 'sim';
      const o = await caixa({
        type: 'question',
        message: `Atualização disponível: painel ${versao}`,
        detail: `Você está com o painel ${atual}. Atualizar agora?\n\nO painel será recarregado${ultimoArquivo ? '; o arquivo que está aberto será aberto de novo.' : '; dados abertos serão fechados.'}`,
        buttons: ['Atualizar agora', 'Depois'],
        defaultId: 0,
        cancelId: 1,
      });
      return o.response === 0;
    },
  });
  if (r.acao === 'atualizado') {
    await entregaAtual;
    if (win) {
      pending = ultimoArquivo;
      win.loadFile(painelEmUso().arquivo);
    }
  } else if (r.acao === 'programa') {
    if (manual || !global.__avisouPrograma) {
      global.__avisouPrograma = true;
      const o = await caixa({ type: 'info', message: 'Há uma versão nova do programa.', detail: 'Esta atualização exige baixar o instalador novamente.', buttons: ['Abrir página de download', 'Depois'], cancelId: 1 });
      if (o.response === 0) shell.openExternal(PAGINA_INSTALADORES);
    }
  } else if (r.acao === 'sem-atualizacao') {
    if (manual) caixa({ type: 'info', message: 'Você já está com a versão mais recente.', detail: `Painel ${painelEmUso().versao} · programa ${pkg.version}` });
  } else if (r.acao === 'erro') {
    // sem rede na abertura: silêncio; se o usuário aceitou e o download falhou, ele precisa saber
    if (manual || r.etapa === 'download') caixa({ type: 'warning', message: r.etapa === 'download' ? 'Não foi possível baixar a atualização.' : 'Não foi possível verificar atualizações.', detail: `${r.erro}\nConfira a conexão com a internet.` });
  }
}

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 860, title: 'Dashboard Universal', icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#090F1D', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.loadFile(painelEmUso().arquivo);
  // links externos abrem no navegador; a janela nunca navega para fora
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.on('did-finish-load', () => {
    if (!global.__verificou) {
      global.__verificou = true;
      if (lerConfig().autoUpdate !== false) buscarAtualizacao(false);
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
