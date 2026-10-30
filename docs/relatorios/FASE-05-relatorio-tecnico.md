# Fase 5 — BI avançado

Status: **PENDENTE / parcial**. Entregue e testado: correção de regressões da média, métricas adicionais, registro de desenhos, exploração manual, testes de agregação. Não feito: novos gráficos, avaliação de bibliotecas (ver abaixo).

## Regressões da Fase 4 encontradas e corrigidas (introduzido → corrigido)
A Fase 4 passou a usar **média** para percentuais. Os testes de agregação desta fase (escritos antes da correção, 5 falharam) mostraram que o código antigo não tratava a média direito:

| Defeito | Onde | Efeito | Correção |
|---|---|---|---|
| Mês sem registro virava **0%** na série mensal por média | `chartData.ts` (linha mensal) | lacuna falsa; destaque dizia “mínimo: 0” | média de mês sem dado é lacuna (NaN) |
| `pivot` ignorava média | `pivotData` | “média” saía como soma | agregador único com `finish()` |
| Destaque de média dizia “X% do total” | `insights.ts` | somava médias | texto próprio por métrica, sem “% do total” |
| Indicador “Total de …” somava CEP ou percentual | `kpis.ts` | total sem sentido | só medida; percentual vira “Média de …”, código não vira indicador |

## Matriz requisito → implementação → teste → estado
| Requisito (prompt, Fase 5) | Implementação | Teste | Estado |
|---|---|---|---|
| Testes de agregação | `test/agregacao.test.ts`: fixture de vendas, esperados calculados à mão (contagem, soma, média, mínimo, máximo, mediana, lacuna, célula ausente, denominador ausente/zero) | 19 casos; 3 mutações pegas | PASS |
| Métricas adicionais | `min`, `max`, `median` em `chartData.ts` (`finish()` com `switch` exaustivo: métrica nova sem tratamento não compila) | `agregacao.test.ts` › métricas adicionais | PASS |
| Registry de renderizadores | `src/charts/registry.ts` (contrato) + `builtin.ts` (mapa, dispersão, funil, bolha, calor, pequenos múltiplos); `drawChart` consulta o registro | `explorar.test.ts` › registro (3); e2e (mapa, funil/bolha pelos cenários existentes) | PASS |
| Exploração manual | `analytics/explore.ts` (regras) + `app/explorer.ts` (tela “Explorar por conta própria”) | `explorar.test.ts` (6) + e2e 13 | PASS |
| Filtros cruzados | já existiam (clique no gráfico → filtro); **não reconstruídos** | e2e 13: após um clique, KPI “Registros” = 6 = linhas da tabela; exploração respeita o filtro | PASS |
| Comparações | já existiam (`compareTables`, gráfico `change`, “Efeito do filtro” da Fase 4); nada novo | testes anteriores | PASS (sem novidade nesta fase) |
| Novos gráficos | **não feito**: nenhum fixture exigiu um desenho que os existentes (barras, linha, rosca, radar, pareto, calor, funil, bolha, pequenos múltiplos) não cubram | — | NOT_RUN |
| Integração opcional com novas bibliotecas | **nenhuma dependência adicionada** (critério 18). As páginas de Chart.js (desempenho), ECharts, Vega-Lite e Observable Plot **não foram consultadas** nesta fase | — | NOT_RUN |

## Verificação (observada)
- vitest: 134 passam (11 arquivos). `npm run lint`, `tsc --noEmit --noUnusedLocals` e `vite build` sem erro. e2e: 19 cenários, 0 falhas (12 e 13 novos nas Fases 4 e 5).
- Mutações: média sem lacuna (NaN→0): 2 testes falham; média no `pivot` removida: 1 falha; soma de percentual liberada na exploração: 1 falha. Código restaurado depois.
- `main.ts`: 910 linhas, teto reduzido de 930 para 915. Nenhum arquivo novo passa de 400 linhas; sem ciclos (o registro não importa os desenhos).

## Mudança de comportamento a conhecer
- O gráfico da exploração manual entra no PDF/impressão como os demais (o PDF do e2e passou de 5 para 6 páginas e de 6 para 7 imagens).
- A seleção da exploração não é salva no projeto nem no HTML compartilhável (limite).

## Limites
- Mediana guarda os valores do grupo em memória; não medido em arquivo de 120 mil linhas (o e2e de 120 mil linhas passa, mas não usa mediana).
- Regras de papel por nome de coluna continuam heurísticas em português.
- Sem captura de tela da exploração em tema claro/escuro; verificada por DOM e pixel só no que o e2e já cobre.
- Instalador Windows/Electron e CI do GitHub: NOT_RUN.
