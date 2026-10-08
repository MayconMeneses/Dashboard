# Dashboard Universal – programa para Windows

Instaladores prontos (baixar direto do GitHub): [`../instaladores/`](../instaladores/LEIA-ME.md).

Há dois instaladores:
- **Leve (~0,2 MB)** – `Instalador-Dashboard-Universal-Leve-<versão>.exe`: instala o painel por usuário (sem administrador) e cria atalhos que o abrem como aplicativo no Microsoft Edge (ou Chrome), que já vêm no Windows 10/11. Sem Edge/Chrome, abre no navegador padrão. Gerar: `npm run dist:leve` (depois de `npm run dist:win` ao menos uma vez, para baixar o NSIS).
- **Completo (~110 MB)** – `Instalador-Dashboard-Universal-<versão>.exe`: programa próprio (Electron) com menu *Arquivo → Abrir*, associação de arquivos e janela independente do navegador.

Aplicativo de desktop (Electron) com instalador. Funciona sem internet para os gráficos e tabelas; o mapa de fundo precisa de internet.

## Para quem vai usar
1. Execute `Instalador-Dashboard-Universal-<versão>.exe` e siga os passos (dá para escolher a pasta; cria atalhos na Área de Trabalho e no Menu Iniciar).
2. Abra o programa e arraste um arquivo (CSV, Excel, JSON, GeoJSON, KML, KMZ), ou use **Arquivo → Abrir arquivo** (Ctrl+O). Também dá para abrir com clique duplo nos tipos associados.
3. Nada é enviado pela internet: os dados ficam no seu computador.

O Windows pode exibir “O Windows protegeu o computador” (SmartScreen), porque o instalador não é assinado digitalmente: clique em **Mais informações → Executar assim mesmo**. Assinar exige um certificado pago.

## Para gerar o instalador
```bash
cd universal && npm install --no-workspaces && npm run build
cd desktop && npm install --no-workspaces
npm run start       # testa o programa
npm run dist:win    # gera release/Instalador-Dashboard-Universal-<versão>.exe
```
No Linux é preciso o `wine` (com suporte a 32 bits). No Windows não precisa de nada extra. O workflow `.github/workflows/universal-instalador.yml` gera o instalador num servidor Windows e o disponibiliza como artefato.

## Atualização automática (instalador completo)
- Ao abrir, o programa consulta `universal/atualizacao/versao.json` no GitHub (HTTPS). Se houver painel mais novo, baixa `index.html`, confere o **SHA-256** e a estrutura, guarda em `%APPDATA%` e pergunta se quer atualizar agora. Também há **Ajuda → Verificar atualizações**.
- Só o painel (um HTML de ~0,5 MB) é atualizado; o programa (Electron) muda raramente. Se uma versão exigir programa novo (`programaMinimo` no manifesto), ele avisa para baixar o instalador de novo.
- Sem internet nada acontece: o programa usa o painel já instalado.

### Para publicar uma atualização do painel
```bash
cd universal
# 1. aumente "version" em universal/package.json (e "painelVersao" em desktop/package.json se for rebuildar o instalador)
npm test && npm run build
cd desktop && npm run publicar     # copia dist/index.html e gera versao.json (com SHA-256)
git add ../atualizacao && git commit -m "Atualiza painel" && git push
```
Quem tem o programa instalado recebe a atualização na próxima abertura. Não precisa gerar instalador de novo.

Para testar sem publicar: `UNIVERSAL_UPDATE_URL=http://127.0.0.1:PORTA npm start` (aceita HTTP só com essa variável).
