# Fase 7 — Importações expandidas

Status: **PENDENTE / parcial**. Entregue e testado: vários arquivos no mesmo painel, relação entre tabelas com análise e confirmação, alertas de chave duplicada, relação refeita ao reabrir o projeto, contagem de pontos por polígono (cálculo), lista única de formatos. Não feito: Parquet e motor local (dependem de decisão sua), OCR, histórico, processamento progressivo.

## Antes → depois
- Antes: um arquivo por vez; não havia como cruzar tabelas (só “juntar por ano” interno de quadros do Word).
- Depois: o seletor aceita vários arquivos (também arrastando); cada tabela entra como “arquivo › aba”; o painel “Relacionar tabelas” mostra a análise **antes** de criar qualquer coisa. O projeto guarda a **receita** da relação (não as linhas) e a refaz ao abrir.
- Preparação (sem mudar comportamento): o fluxo de importação e prévia saiu de `main.ts` para `src/app/importFlow.ts`; `main.ts` caiu de 910 para 799 linhas e o teto passou de 915 para 800.

## Matriz requisito → implementação → teste → estado
| Requisito (prompt, Fase 7 e critérios 7 e 9) | Implementação | Teste | Estado |
|---|---|---|---|
| Múltiplos arquivos | `handleFiles` (importFlow), `mergeDatasets` (nomes únicos, `Dataset.sources` com nome, tamanho, SHA-256) | `juncao.test.ts` › vários arquivos (3); e2e 16 (prévia lista as duas fontes com SHA-256) | PASS |
| Relacionamentos com confirmação | `analyzeJoin` + `joinTables`; painel `app/joinPanel.ts` (analisar → confirmar/cancelar) | `juncao.test.ts` (20 casos); e2e 16: cancelar não cria tabela, confirmar cria e abre | PASS |
| Critério 7: junção de chaves duplicadas exibe alertas | cardinalidade (1:1, N:1, 1:N, N:N), chaves repetidas, linhas sem par com exemplos, chave vazia nunca casa, aviso de coluna que “se repete em até N linhas; somar superestima”, bloqueio de tabela com formas multiplicada | testes à mão (ex.: soma 500 em vez de 300 em 1:N); e2e 16 confere os avisos na tela | PASS |
| Chaves de código (zeros à esquerda) | comparação como texto sem espaços; “0123” ≠ 123, com sugestão e **sem correção automática** | `juncao.test.ts` › regras da chave | PASS |
| Critério 9: projeto reaberto preserva configurações | `ProjectState.joins`; `applyJoins`/`stripJoined`; relação descartada com motivo se faltar uma fonte | e2e 16: salvar, reabrir com os mesmos arquivos (tabela relacionada aberta, 5 registros) e com um arquivo só (aviso “descartada”) | PASS |
| Agregação espacial (pendência da Fase 6) | `join/spatial.ts` (`countPointsIn`, caixa envolvente + ponto em polígono, buraco não conta); tipo “Contar pontos dentro de polígonos” no painel | `juncao.test.ts` (3: A=2, B=1, C=1) | PASS (cálculo) / NOT_RUN (e2e do painel no modo “pontos”) |
| Adaptadores | `src/formats.ts`: lista única usada por seletor, mensagem de erro e prévia; teste garante que todo formato listado é lido por `parseFile` | `formatos.test.ts` (3) | PARCIAL: o `switch` de leitura continua em `parse.ts`; não há plug-in de leitores |
| Arquivos grandes | medido, sem mudança | ver abaixo | PASS (medição) |
| Processamento progressivo | não implementado | — | NOT_RUN |
| Parquet / motor local (DuckDB-Wasm) | **não implementado**: exige dependência nova (critério 18) | — | NOT_RUN — decisão sua |
| Histórico | não implementado: nomes de arquivo podem ser sensíveis; “projetos salvos” já cobrem reabrir | — | NOT_RUN (por escolha) |
| OCR | não feito, por desenho: só após validação e autorização | — | NOT_RUN |

## Medição de arquivo grande (critério 16)
CSV sintético de 300.000 linhas × 12 colunas (21,7 MB), em Node nesta máquina: leitura 1,9 s, perfil das colunas 2,6 s; lê 200.000 linhas e avisa das 100.000 restantes (limite já existente). O e2e de 120 mil linhas abre em ~1,6 s no Chrome. Medida única; não cobre 50 MB com muitas colunas de texto nem o navegador com o arquivo de 21,7 MB. Sem evidência de necessidade, não criei Web Worker nem progresso.

## Avaliação de Parquet, DuckDB-Wasm, Arrow e GeoParquet (páginas lidas em 2026-10-30; o que a página não diz fica “não informado”)
| Fonte | O que a página informa | Licença | Versão citada |
|---|---|---|---|
| DuckDB-Wasm | roda em WebAssembly, “no data leaving the user's machine”; lê Parquet no navegador; usa Worker de mesma origem; um único thread por padrão (multithread experimental); limite de 4 GB de memória; tamanho de download e cabeçalhos COOP/COEP não informados | não informado na página | 2.0.0 |
| Apache Arrow (formato colunar) | é a especificação do formato em memória; **não trata de Parquet nem de navegador** | não informado (só direitos da Apache Software Foundation) | formato 1.5 |
| GeoParquet | padrão em incubação do OGC; validador e conversor rodam no navegador; se o validador envia o arquivo a um servidor: não informado | site em CC BY 4.0; licença da especificação não informada | 2.0.0-rc.1 |

Conclusão: ler Parquet localmente é viável com DuckDB-Wasm, mas traz WebAssembly, Worker, limite de 4 GB e tamanho de pacote **não verificado**; a licença do pacote também **não foi verificada**. Por isso não adicionei nada. Perguntado ao usuário no fim da fase.

## Verificação (observada)
- vitest: 188 passam (14 arquivos; 28 novos: `juncao.test.ts` 25, `formatos.test.ts` 3). `npm run lint`, `tsc --noEmit --noUnusedLocals` e `vite build` sem erro. e2e: 22 cenários, 0 falhas (16 novo).
- Mutações (feitas e revertidas): chave vazia casando com chave vazia → 4 testes falham; correção automática de zeros → 2 falham; sem aviso de repetição → 2 falham; projeto salvo sem a receita (`joins: []`) → e2e 16 falha.
- Arquivos: `main.ts` 799 linhas (teto 800); nenhum arquivo novo acima de 400; sem ciclos (a receita `JoinSpec` mora em `types.ts` para não criar ciclo).

## Limites
- Uma tabela é escolhida pelo título ou nome; duas tabelas com o mesmo título dentro do mesmo arquivo seriam confundidas.
- A interpretação de datas e números (dia/mês, vírgula/ponto) é uma só para todos os arquivos abertos juntos; arquivos que discordam não são tratados separadamente.
- HTML compartilhado leva só as tabelas de origem e a receita; a volta (abrir esse HTML com a relação refeita) não tem e2e próprio.
- A relação é refeita ao abrir; “Atualizar dados” com vários arquivos não foi exercitado.
- Instalador Windows/Electron e CI do GitHub: NOT_RUN.
