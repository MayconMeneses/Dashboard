# Fase 8 — Relatórios, desktop e release

Status: **PENDENTE / parcial**. Entregue e testado: modelos de PDF, anexo territorial, exportação segura, modo offline, migração de preferências de projetos, benchmarks, documentação e verificações de segurança de release. Instalador NSIS **construído** e aplicativo Electron **aberto e testado desempacotado** (ver “Construção local”). **Não exercitado:** instalação real (atalhos, associação de arquivos, desinstalação) e atualização automática de ponta a ponta (critério 11 parcial).

## Matriz requisito → implementação → teste → estado
| Requisito (prompt, Fase 8) | Implementação | Teste | Estado |
|---|---|---|---|
| Templates PDF | `applyTemplate` (completo / resumido) em `src/report.ts`; seletor “Modelo do relatório” em `index.html`; lido em `reports/screen.ts` | `test/relatorio.test.ts` (3 casos) | PASS (lógica) / NOT_RUN (clique no seletor no e2e) |
| Relatórios territoriais | `src/reports/territory.ts` + “Anexo B. Território” no PDF (unidade, geometria, medida, classe por quantis, “sem dado”) | `relatorio.test.ts` (4 casos + PDF) | PASS (lógica) / NOT_RUN (PDF territorial gerado no e2e) |
| Exportação segura | Excel grava texto como `inlineStr` (nunca fórmula); CSV neutraliza `=+-@` (Fase 1); HTML compartilhável escapa `<` no JSON embutido | `release.test.ts` (Excel com 5 entradas perigosas); e2e 17 (dado com `</script><script>` não executa; mutação removendo o escape faz o e2e falhar) | PASS |
| HTML standalone | já existia; agora verificado sem rede | e2e 6 e 17 | PASS |
| Modo offline | cenário e2e com todas as requisições http(s) abortadas e registradas | e2e 17: CSV (pela ponte do desktop), relatório PDF, Excel, CSV, HTML compartilhado, PDF e XLSX importados → **0 requisições externas** | PASS |
| Electron | auditoria estática de `desktop/main.cjs` (abaixo); ponte `window.__abrirArquivo` exercitada no Chrome (e2e 17) **e no próprio Electron 44.7.0** (`npm run test:desktop`) | `e2e/desktop.mjs`: painel empacotado idêntico ao compilado, tema escuro, arquivo entregue pela ponte vira painel, 0 requisições externas | PASS (aplicativo desempacotado) / NOT_RUN (menu “Arquivo → Abrir”, associação de arquivos, atualização real) |
| NSIS | `npm ci` + `npm run dist:win` em `universal/desktop` (electron-builder 26.15.3, NSIS 3.0.4.1) gerou `Instalador-Dashboard-Universal-0.3.0.exe` | construção terminou com código 0; conteúdo inspecionado (arquivo NSIS com `app-64.7z` e desinstalador); versão e nome do produto corretos; sem assinatura | PASS (construção e inspeção) / NOT_RUN (executar o instalador) |
| SHA-256 | atualizador confere o hash do painel baixado; relatório e prévia listam o SHA-256 de cada fonte; SHA-256 do instalador novo calculado (abaixo) | revisão estática; e2e 16 (prévia); `release.test.ts`; `desktop.mjs` (hash do painel dentro do pacote = hash de `dist/index.html`) | PASS (verificação) / NOT_RUN (`instaladores/SHA256SUM.txt` não regenerado: o instalador novo não foi para o repositório) |
| Migração de preferências | `migrateState`/`FUNDO_PADRAO_ATE` em `project.ts`: projeto salvo antes da 0.8.0 com Esri abre sem fundo e avisa | `release.test.ts` (5 casos; mutação desligando a regra faz 3 testes falharem) | PASS |
| E2E | 23 cenários (17 novo) | `npm run test:e2e` | PASS |
| Benchmarks | `npm run bench` (`bench/desempenho.bench.ts`, fora do `npm test`); resultado em `docs/benchmarks/ultimo.json` | uma execução por medida, em Node | PASS (medição) |
| README, changelog, documentação | `universal/README.md` (privacidade, PDF, recursos, testes), `universal/CHANGELOG.md` (com mudanças de comportamento e como publicar), `desktop/README.md` | revisão | PASS |
| Auditoria final | `RELATORIO_FINAL_DASHBOARD_UNIVERSAL_2_0.md` | — | PASS (relatório) — veredito PENDENTE |

## Construção local do instalador (observada em 2026-10-30)
- Baixado: 284 pacotes npm (Electron 44.7.0 e electron-builder 26.15.3 com dependências); binário do Electron para Windows x64 (baixado pelo electron-builder); NSIS 3.0.4.1 e nsis-resources 3.4.1; 7-Zip. `npm audit` apontou 3 vulnerabilidades (1 moderada, 2 altas) nas ferramentas de build, **não analisadas**.
- Resultado: `universal/desktop/release/Instalador-Dashboard-Universal-0.3.0.exe`, **113.205.921 bytes (~108 MB)**, SHA-256 `e50d4fa4dcd529cd926e37619ae4d7891f08008023a2f6f917d941bbdc4e2dc0`. Assinatura: **NotSigned** (esperado). Dentro do pacote (`app.asar`): só `index.html`, `main.cjs`, `package.json` e o ícone; `painelVersao` = 0.8.0 e programa 0.3.0 (a versão do programa não mudou, então o nome do arquivo é o mesmo do instalador antigo, que é outro binário).
- Aplicativo desempacotado (`release/win-unpacked/Dashboard Universal.exe`, 235 MB): aberto com pasta de dados temporária e consulta de atualização desligada; 4 verificações passaram (`e2e/desktop.mjs`). O processo foi encerrado ao final.
- **Não feito de propósito:** executar o instalador (cria atalhos, associações de arquivo e entradas no registro do seu Windows) e testar a atualização automática. Os arquivos gerados (`release/`, `app/`, `node_modules/`) estão no `.gitignore` e **não foram enviados ao GitHub**.
- Observação: o `npm ci` não baixou o binário em `node_modules/electron/dist` (npm 11 bloqueia scripts de instalação não aprovados), então `npm run start` em `desktop/` exige rodar `node node_modules/electron/install.js` antes; o `dist:win` não precisa disso.

## Verificações de release que nenhum teste cobria (agora cobertas em `release.test.ts`)
- O `<title>` do painel é o que o atualizador exige (`<title>Dashboard…`); se mudasse, **todas as cópias instaladas recusariam** a atualização.
- `painelVersao` em `desktop/package.json` estava em **0.7.1**; um instalador gerado desta branch teria “atualizado para trás” para a 0.7.5. Agora igual à versão do painel (0.8.0), com teste.
- A lista de formatos do `main.cjs` e as associações de arquivo do instalador conferem com `src/formats.ts` (associações: `tsv` adicionado; `txt` e `doc` ficam de fora de propósito, para não capturar todo arquivo de texto do Windows).
- O manifesto de atualização publicado (`atualizacao/versao.json`) **não foi alterado** (continua 0.7.5): o teste falha se alguém publicar versão maior sem decisão consciente.

## Auditoria estática de `desktop/main.cjs` (lida, não executada)
- Sólido: `contextIsolation`, `sandbox`, sem `nodeIntegration`; navegação só para `file://`; pop-ups negados (HTTPS vai ao navegador); atualização só por HTTPS, com limite de tamanho, conferência de SHA-256 e de estrutura; instância única; arquivo entregue ao painel em base64.
- Limites: o manifesto e o HTML vêm da mesma origem, então o SHA-256 prova integridade mas **não autenticidade** (se o repositório for comprometido, o painel “atualizado” seria o do atacante); o executável e o instalador **não são assinados** (SmartScreen avisa); a consulta de atualização é ligada por padrão e contacta o GitHub ao abrir; redirecionamentos HTTP são seguidos sem limite de quantidade; a cor de fundo da janela (`#f5f6f8`) não acompanha o tema escuro (pisca claro antes de carregar).
- A abertura pelo menu e pelo Windows é de um arquivo por vez (vários arquivos só pelo seletor/arrastar do painel).

## Benchmarks (uma execução cada; Intel i5-8265U, 7,9 GB, Node 24, Windows; não valem para o navegador)
| Medida | Resultado |
|---|---|
| Ler CSV de 21,7 MB (300 mil linhas × 12 colunas; lê 200 mil) | 1,72 s |
| Perfil das 12 colunas (200 mil linhas) | 2,50 s |
| Analisar relação 200 mil × 5 mil chaves | 0,07 s |
| Criar a relação (200 mil linhas) | 0,15 s |
| 10 mil pontos em 5 mil polígonos | 0,61 s |
| Navegador: 5.000 polígonos desenhados em SVG (e2e 14) | ~0,7 a 1,1 s |
| Navegador: abrir CSV de 120 mil linhas (e2e 7) | ~1,6 s |

## Verificação (observada)
- vitest: 206 passam (16 arquivos). `npm run lint`, `tsc --noEmit --noUnusedLocals` e `vite build` sem erro. e2e: 23 cenários, 0 falhas.
- Mutações (feitas e revertidas): migração de projeto desligada → 3 testes falham; escape de `<` no HTML compartilhado removido → e2e falha (a página quebra).
- CI do GitHub (consulta à API pública): as 8 execuções mais recentes da branch, de `fa60133` a `b3211f8`, terminaram em **success** (lint, tipos, testes e build; o CI não roda e2e nem constrói o instalador).
- `main.ts` 799 linhas (teto 800); nenhum arquivo novo acima de 400; nenhuma dependência adicionada.

## Limites
- Modelos de PDF e seção territorial sem cenário e2e de clique/PDF gerado (só lógica pura).
- Imagem do mapa (exportação cartográfica em imagem): não implementada.
- Instalação real do `.exe`, associação de arquivos, desinstalação e atualização automática: não exercitadas (ver relatório final).

## Complemento (2026-10-30): pendências resolvidas
Pedido do dono: “resolva esses problemas para ficar completo” e “sempre que tiver atualização, peça para atualizar assim que abrir”.

### Atualização ao abrir (programa 0.4.0)
- Lógica separada em `desktop/atualizacao.cjs` (sem Electron, testável) e usada por `main.cjs`. Ao abrir o painel, o programa lê o manifesto na hora (sem os 3 s de espera de antes) e, **se houver painel mais novo, pergunta antes de baixar**: “Atualizar agora / Depois”. “Depois” não baixa nem guarda nada e a pergunta volta na próxima abertura. Aceitando, baixa, confere o SHA-256 e o título, grava, recarrega e **reabre o arquivo que estava aberto**. Sem rede: silêncio. A opção “Verificar atualizações ao abrir” continua no menu, ligada por padrão.
- Endurecido no mesmo passo: HTTP só para 127.0.0.1/localhost (e só em modo de teste), no máximo 5 redirecionamentos, janela com a cor do tema escuro, e um defeito antigo corrigido: um download acima do limite (ou cortado) **resolvia como se estivesse completo** e ainda gerava uma exceção não tratada no processo principal.
- Provas: 14 testes unitários com servidor HTTP local (`test/atualizacao.test.ts`); 7 verificações no Electron empacotado (`npm run test:desktop`), com mutação (SHA-256 desligado → o teste do arquivo adulterado falha); teste que garante que todo módulo local do `main.cjs` vai dentro do pacote (`release.test.ts`).
- **O que isto NÃO muda:** quem já tem o programa 0.3.0 instalado mantém o comportamento antigo (espera 3 s, baixa e depois pergunta; “Depois” não adia de verdade, porque o painel já foi guardado). O novo comportamento só chega com o instalador 0.4.0.
- Instalador 0.4.0: `universal/desktop/release/Instalador-Dashboard-Universal-0.4.0.exe`, **113.208.779 bytes**, SHA-256 `2933ec692978f6aea9ed62d6e2b720a0a3036c45de30745a4fb1516879f84c06`, sem assinatura. Não foi para o repositório.

### Acessibilidade medida (critério 13) — defeitos achados pelos testes e corrigidos
| Defeito | Evidência | Correção |
|---|---|---|
| Paleta indistinguível para daltônicos: laranja × dourado a CIEDE2000 **2,1** (deuteranopia) e 4,3 (protanopia) | `test/daltonismo.test.ts` | paleta nova por busca: 6 cores a ≥ 13 em todas as visões (8: ≥ 9; 10: ≥ 8), mantendo contraste ≥ 3:1 sobre o escuro e o branco; medidas em `docs/benchmarks/daltonismo.json` |
| Filtro cruzado só pelo mouse (clique no canvas) | e2e de teclado | botões na tabela de dados de cada gráfico, mesma função do clique (`app/filtro.ts`) |
| Valores do mapa só no mouse | e2e | tabela equivalente do mapa e região nomeada |
| Caixa de período (data) sem anel de foco ao entrar pelo Tab | e2e (computed style) | `input[type=date]:focus-within` |
| Área de arquivo sem contorno de foco (`outline:none`) | e2e (tema claro) | contorno restaurado |
| Alvos menores que 24×24 px: botão ✕ do gráfico (20×23), botões de ordenar (13–60×20), resumos (20 px) | e2e | tamanho mínimo de 24 px |
Medido e aprovado: sem rolagem horizontal da página em 1280, 768 (tablet), 640 (equivale a zoom de 200%) e 320 px; 137 paradas do Tab, todas com foco visível; 91 de 91 controles visíveis alcançáveis. Exceção documentada: o link “Leaflet” da atribuição do mapa (link dentro de frase, WCAG 2.5.8).

### Segurança de arquivos
- **ZIP com tamanho declarado falso:** o filtro por tamanho declarado do `unzipSync` era burlável — um KMZ de 120 MB reais que declarava 100 bytes era descompactado inteiro e um DOCX de 100 MB (limite 60 MB) abria. Agora `src/zipSeguro.ts` descompacta em fatias de 16 KB e para ao passar do limite; as demais entradas nunca são lidas. XLSX: uma parte de 150 MB honesta travava a leitura por **72 s** e falhava; agora é recusada na hora (limites de 60 MB por parte e 200 MB no total, pelo diretório do ZIP). Testes: `test/zipSeguro.test.ts` (11).
- **Colunas que parecem medida mas são código:** `sku`, `ean`, `pedido`… e valores com zeros à esquerda (“0001”) viram identificador; `lat_origem`, `lon_destino`… viram geográficas. Antes, o primeiro indicador do painel podia ser o “Total de sku” ou o “Total de lat_origem”. Testes: `test/fixtures-dominios.test.ts` (13, com mutação).

### Fixtures
Produtos, indicadores escolares, finanças e logística criadas (valores à mão). Limites registrados: a média simples de uma taxa difere da taxa ponderada (82,5% × 86,15% nas escolas); dois pares de coordenadas (origem e destino) não geram mapa nem fluxo.

### Não feito
Instalação real do `.exe`; itens de interface da Fase 2 (alto contraste, esqueletos, arrastar cartões, busca/período no topo, painel lateral de filtros); leitura de Parquet; Observable Plot não lido (HTTP 429). Integrar a branch ao `main` e publicar a 0.8.0 continua sendo decisão do dono (a falha de segurança da 0.7.5 só some para quem atualiza).
