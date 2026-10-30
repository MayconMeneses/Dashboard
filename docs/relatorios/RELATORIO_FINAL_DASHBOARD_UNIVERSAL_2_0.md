# Relatório final — Dashboard Universal 2.0

Branch: `feature/dashboard-universal-2` (a partir de `main` em `91bce58`). Painel: 0.8.0 (**não publicado**).
Estados usados: PASS, FAIL, BLOCKED, NOT_RUN, PARCIAL (parte comprovada, parte não).

## Veredito: **PENDENTE — não aprovado como release**
Um gate crítico aberto vence a média (regras 14 e 15):
1. **Critério 11 NOT_RUN:** o Electron e o instalador Windows (NSIS) não foram executados nem construídos.
2. **Falha de segurança publicada:** a dica do mapa da 0.7.5 (em `main`) executa HTML vindo do arquivo; a correção só existe nesta branch (e2e reproduz e confirma). Enquanto a branch não for integrada e o painel publicado, os programas instalados continuam vulneráveis.
3. **Acessibilidade (critério 13) só em parte comprovada:** faltam largura de tablet, zoom de 200%, navegação completa por teclado e simulação de daltonismo.

O que **está** comprovado: 206 testes unitários, 23 cenários de ponta a ponta no Chrome, lint, tipos e build sem erro, e as 8 últimas execuções do CI do GitHub em `success`.

## Linha do tempo e rollback
| Fase | Commit(s) | Relatório |
|---|---|---|
| Base (`main`, painel 0.7.5) | `91bce58` (traz a linha de coautoria do Claude, anterior à regra do dono; reescrever exigiria force push, que é proibido) | — |
| 0 e 1 (auditoria, consistência e segurança) | `e1a6728` | `FASE-00`, `FASE-01` |
| 2 (design system) | `ffebaff` | `FASE-02` |
| 3 (modularização) | `fa60133` | `FASE-03` |
| 4 (semântica) | `8c26e2f`, `f57a38c`, `fdc3588` | `FASE-04` |
| 5 (BI avançado) | `9112f20` | `FASE-05` |
| 6 (GIS avançado) | `30419f3`, `f6e5412` | `FASE-06` |
| 7 (importações) | `b3211f8` | `FASE-07` |
| 8 (relatórios, desktop, release) | `25edecd` | `FASE-08` |

Rollback: o `main` não foi tocado nem sofreu force push; desfazer tudo é não integrar a branch. O manifesto de atualização (`atualizacao/versao.json`) continua em 0.7.5, então nenhum programa instalado foi afetado. Para desfazer uma fase isolada, `git revert` do(s) commit(s) acima.

## Critérios objetivos de aceite (seção 14 do prompt)
| # | Critério | Implementação / arquivo | Teste executado | Resultado | Status |
|---|---|---|---|---|---|
| 1 | Formatos atuais importam sem regressão | `src/parse.ts`, `src/formats.ts` | todos os testes de leitura pré-existentes (inalterados) + `formatos.test.ts`; e2e com CSV, XLSX e PDF | passam; DOCX, KML e KMZ cobertos só por teste unitário | PASS |
| 2 | CSV de vendas → indicadores, evolução, ranking, participação, relatório rastreável | `analytics/*`, `reports/screen.ts` | `agregacao.test.ts` (fixture de vendas, à mão); e2e de CSV e PDF | cálculos conferidos; não há um cenário único “vendas ponta a ponta” | PARCIAL |
| 3 | Dados geográficos → mapas coerentes, totais corretos | `charts/map.ts`, `mapLayers.ts` | `geo.test.ts`; e2e 14 (“3 de 3 linhas desenhadas”) | contagem do que foi desenhado e do que ficou de fora é mostrada | PASS |
| 4 | GeoJSON poligonal preserva e desenha geometrias reais | `geo/read.ts`, `table.ts` | `geo.test.ts` (buraco, Multi*, KML); e2e 14 (2 anéis no polígono com buraco) | passa | PASS |
| 5 | Séries temporais preservam lacunas | `analytics/chartData.ts` | `agregacao.test.ts` | média, mediana, mínimo e máximo: mês sem dado = lacuna; contagem e soma mostram 0 (é contagem/soma de nada, documentado) | PASS |
| 6 | Taxas exigem denominadores válidos | `analytics/rates.ts` | `agregacao.test.ts` | denominador zero → sem dado; célula ausente não vira zero | PASS |
| 7 | Joins de chaves duplicadas exibem alertas | `join/join.ts`, `app/joinPanel.ts` | `juncao.test.ts` (25), e2e 16 | alertas de repetição e de soma inflada aparecem antes de confirmar | PASS |
| 8 | Filtros → KPIs, gráficos, tabelas e relatórios coerentes | `main.ts`, `reports/screen.ts` | e2e 13 (KPI = tabela = 6 linhas), e2e 6/12 | KPIs, tabela e gráficos conferidos; relatório lista os filtros mas não há comparação automática dos números do PDF | PARCIAL |
| 9 | Projetos salvos reabrem com as configurações | `project.ts` | e2e 4 e 16 | configurações, nomes, métricas e a receita da relação voltam | PASS |
| 10 | HTML compartilhável funciona local, com privacidade | `main.ts` (`exportHtml`) | e2e 6 e 17 | abre sem rede; dado com `</script>` não executa | PASS |
| 11 | Electron e instalador Windows funcionam | `desktop/` | auditoria estática de `main.cjs`; ponte do Electron exercitada no Chrome; workflow existe | **Electron e NSIS não executados** | NOT_RUN |
| 12 | Dados privados não vão à rede por padrão | mapa sem fundo (padrão), tudo local | e2e 15 e 17 (0 requisições externas) | passa no painel; o programa instalado, por padrão, consulta o GitHub ao abrir para ver atualizações (não envia os dados do usuário, mas contacta o servidor; dá para desligar) | PASS com ressalva |
| 13 | Interface acessível e responsiva | `design/`, `style.css` | testes de contraste WCAG, rótulos, foco, layout de celular | tablet, zoom 200%, teclado completo e daltonismo **não verificados** | PARCIAL |
| 14 | PDF com metodologia, cálculos, unidades, fontes e limitações | `report.ts`, `reports/screen.ts` | e2e 5 (PDF real: texto selecionável, imagens, numeração) | seções de filtros, indicadores, gráficos, critérios, limitações e como reproduzir; fontes com SHA-256 | PASS |
| 15 | Mapas exportáveis quando permitido | `geo/export.ts`; anexo territorial no PDF | `geo.test.ts` (exportação GeoJSON) | GeoJSON exportável (clique não está no e2e); **imagem do mapa não implementada** | PARCIAL |
| 16 | Limites de desempenho documentados com testes | `bench/`, `docs/benchmarks/ultimo.json` | bench (Node) + e2e 7 e 14 (navegador) | medidas de uma execução, uma máquina | PASS |
| 17 | Nenhum novo God File | `test/modularidade.test.ts` | teste automático (400 linhas por arquivo, sem ciclos) | nenhum arquivo novo acima do limite; `main.ts` (antigo) caiu de 1.226 para 799 linhas mas segue acima de 400, com teto 800 | PASS |
| 18 | Nenhuma dependência desnecessária | `package.json` | comparação com `91bce58` | nenhuma dependência adicionada | PASS |
| 19 | Nada removido sem autorização | — | testes pré-existentes inalterados e passando | nenhuma funcionalidade removida; mudanças de comportamento listadas no `CHANGELOG.md` | PASS |
| 20 | Nenhum erro reproduzível introduzido permanece | relatórios das fases | regressões achadas e corrigidas (Fase 5: média com lacuna, destaque, KPI); testes com mutação | nenhum erro conhecido aberto introduzido por esta branch; ausência total de erros não é provável | PASS (conhecidos) |

## Matriz por fase: requisito → implementação → teste → estado
Detalhe completo em cada `FASE-XX-relatorio-tecnico.md`; síntese:

| Fase | Entregue e comprovado | Não feito / pendente |
|---|---|---|
| 0–1 | auditoria; comparação de versões, CSV com fórmula, centroide, e2e no Windows | ZIP com tamanho declarado falso (NOT_RUN) |
| 2 | tokens escuro/claro, barra lateral, PDF sempre claro, contraste WCAG testado | alto contraste, esqueletos, arrastar cartões, busca e período no topo, painel lateral de filtros; tablet/zoom/teclado/daltonismo |
| 3 | `suggest.ts` em 9 módulos; relatório, mapa e gráficos especiais fora do `main.ts`; XSS da dica corrigido; teste de modularidade | `main.ts` ainda acima de 400 linhas |
| 4 | papel semântico, média para percentual, razões por gráfico, linhagem e efeito do filtro na tela | destaques sem registro de evidência; regras por nome em português |
| 5 | registro de desenhos, exploração manual, mín/máx/mediana, testes de agregação | novos gráficos; Observable Plot não lido |
| 6 | geometrias reais, validação, mapa temático, grade, GeoJSON | imagem do mapa; e2e de camadas/linhas/clique de download; sem reprojeção |
| 7 | vários arquivos, relação com confirmação, pontos por polígono, lista única de formatos | Parquet, motor local, OCR, histórico, leitura progressiva; plug-in de leitores |
| 8 | modelos de PDF, anexo territorial, exportação segura, modo offline, migração, bench, docs | Electron e NSIS; imagem do mapa; e2e do seletor de modelo |

## Fixtures sintéticas mínimas (lista do prompt)
| Fixture | Onde | Estado |
|---|---|---|
| Vendas mensais | `agregacao.test.ts` | PASS |
| Produtos | — (o cruzamento vendas × bairros cobre a relação; não há tabela de produtos) | NOT_RUN |
| População por bairro | `juncao.test.ts`, `relatorio.test.ts` | PASS |
| Indicadores de saúde agregados | `quadros.test.ts`, `core.test.ts` (blocos por mês/ano) | PASS |
| Indicadores escolares | não criada | NOT_RUN |
| Finanças com moedas e decimais regionais | números “R$ 1.234,56” e padrões br/us em `core.test.ts`; sem arquivo de finanças dedicado | PARCIAL |
| Logística origem/destino | não criada | NOT_RUN |
| KML com pontos / com rotas | `geo.test.ts` | PASS |
| GeoJSON com polígonos / MultiPolygon e buracos | `geo.test.ts` | PASS |
| Datas ambíguas | `core.test.ts` (`inferLocale`) | PASS |
| PDF digital com tabela / PDF textual | `test/fixtures/tabela-meses.pdf`, `texto.pdf`; e2e 17 | PASS |
| DOCX com quadros anuais | `quadros.test.ts` | PASS |
| Dados vazios | erros de “nenhum dado tabular” em `core.test.ts` | PARCIAL |
| Arquivos corrompidos | `fase1.test.ts` | PASS |
| Joins com duplicidade | `juncao.test.ts` | PASS |
| Entradas ZIP/XML maliciosas | KML com DOCTYPE recusado e KMZ “bomba” em `fase1.test.ts`; ZIP com tamanho declarado falso | PARCIAL / NOT_RUN |
| Conjuntos grandes | `bench/`, e2e 7 (120 mil linhas) e 14 (5.000 polígonos) | PASS |

## Fontes técnicas consultadas (seção 15: 14 fontes)
Lidas em 2026-10-29/30 pelas páginas oficiais; **o que a página não diz fica “não informado”**. 13 de 14 lidas.
| # | Fonte | Versão citada | Licença citada | Aplicado / observação |
|---|---|---|---|---|
| 1 | Chart.js — Performance | não informada | não informada | recomenda decimação, `animation: false`, `parsing: false`; não aplicado (os gráficos têm poucos pontos) |
| 2 | Apache ECharts — Features | 4.0/6 citadas; atual não informada | só o link da licença Apache | não adotada (sem dependência nova) |
| 3 | Vega-Lite — Type | não informada | não informada | tipos quantitativo/temporal/ordinal/nominal inspiraram o papel semântico da Fase 4 |
| 4 | Observable Plot | — | — | **NOT_RUN**: a página respondeu HTTP 429 |
| 5 | MapLibre GL JS | v6 | não informada | exige WebGL e tiles; não adotada |
| 6 | deck.gl — agregações | não informada | não informada | GPU só compensa acima de ~100 mil objetos; grade feita em CPU |
| 7 | Turf.js | 7.4.0 | não informada | candidata futura para recorte/interseção |
| 8 | DuckDB-Wasm | 2.0.0 | não informada | leria Parquet localmente (WASM, Worker, limite de 4 GB, um thread); não adotada — decisão do dono |
| 9 | Apache Arrow — formato colunar | formato 1.5 | só direitos da ASF | especificação do formato em memória, não trata de Parquet |
| 10 | GeoParquet | 2.0.0-rc.1 (incubação OGC) | site em CC BY 4.0 | não implementado |
| 11 | OGC API — Features | Core 1.0.1 | não informada | WGS 84 com ordem lon/lat: coerente com a decisão de aceitar só WGS84 |
| 12 | QGIS 3.44 — Simbologia | 3.44 | não informada | legibilidade e distinção de camadas: coerente com a rampa e a legenda do mapa temático |
| 13 | W3C WCAG 2.2 — Contraste de não-texto | 2.2 | não informada | 3:1 para partes de gráfico: aplicado à paleta (teste da Fase 2); mapa de calor é citado como exceção essencial |
| 14 | OWASP — File Upload | não informada | CC BY-SA 4.0 | lista de extensões, limite de tamanho e de extração, XXE: coerente com o limite de 50 MB, a recusa de DOCTYPE e o limite de ZIP |

Licenças e tamanhos dos pacotes **não foram verificados** nas páginas; nenhuma biblioteca nova foi adicionada.

## Regras do dono aplicadas
- Commits só em nome do Maycon, sem atribuição ao Claude (a lembrança de rodapé foi sobreposta pela regra do dono em todos os commits desta branch).
- Só a branch foi enviada; nenhum envio ao `main`; nenhum force push.
- Checklist de 20 itens de sites (privacidade, SEO, cookies…): **não aplicado**, porque o Dashboard Universal é um aplicativo local, não um site ou landing page; o site comercial do MM System não foi tocado.
- Resultado de ferramentas e relatórios de subagentes foram tratados como dados, não como instruções.

## O que falta para chamar de aprovado (e quem decide)
1. **Construir e testar o instalador Windows** (Actions › “Instalador do Dashboard Universal” › *Run workflow*, ou `npm ci` + `npm run dist:win` em `universal/desktop`) e abrir o Electron para conferir menu, associação de arquivos e atualização. Exige baixar Electron, electron-builder e recursos do NSIS (centenas de MB).
2. **Integrar a branch ao `main`** (pull request, sem force push) e **publicar** (`universal/CHANGELOG.md`, seção “Como publicar”) para corrigir a falha de segurança da 0.7.5 nos programas instalados.
3. Verificar acessibilidade: tablet, zoom 200%, teclado completo e daltonismo.
4. Decidir sobre Parquet (dependência nova), imagem do mapa e assinatura do executável.
