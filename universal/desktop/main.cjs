// Aplicativo de desktop do Dashboard Universal: abre a página local e entrega arquivos escolhidos.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const EXT = ['csv', 'tsv', 'txt', 'xlsx', 'json', 'geojson', 'kml', 'kmz'];
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

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 860, title: 'Dashboard Universal', backgroundColor: '#f5f6f8', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // links externos abrem no navegador; a janela nunca navega para fora
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.once('did-finish-load', () => {
    if (pending) {
      const f = pending;
      pending = null;
      openPath(f);
    }
  });
  win.on('closed', () => (win = null));
}

const menu = Menu.buildFromTemplate([
  { label: 'Arquivo', submenu: [{ label: 'Abrir arquivo…', accelerator: 'CmdOrCtrl+O', click: pick }, { label: 'Imprimir / PDF', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() }, { type: 'separator' }, { role: 'quit', label: 'Sair' }] },
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
    Menu.setApplicationMenu(menu);
    pending = fileFromArgs(process.argv);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
