# Dashboard Universal – programa para Windows

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
