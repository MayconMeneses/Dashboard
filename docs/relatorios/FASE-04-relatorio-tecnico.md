# Fase 4 — Perfil semântico, recomendação explicada e linhagem

Status: **PENDENTE / parcial** (itens entregues e itens não feitos listados abaixo). Atualização: `filterEffects` e `lineageOf` agora aparecem na tela.

## O que já existia (preservado)
- Correção manual de tipo por coluna (`forced`), perfil da tabela inteira e perfil do recorte filtrado (`lastKpiProf`), `why` do desenho recomendado, insights calculados dos próprios dados do gráfico (`insightFor`).

## O que foi entregue
| Requisito | Implementação | Teste | Estado |
|---|---|---|---|
| Papel semântico da coluna (identificador, medida, dimensão, tempo, geo, flag, texto) com a regra que decidiu | `src/analytics/semantic.ts` (`semanticOf`, `semanticProfile`) | `test/fase4.test.ts` › papel semântico | PASS |
| Unidade e aditividade (percentual/taxa → média; dinheiro/contagem → soma) | `aggFor`; usado em `recommend.ts` (gráfico por mês e por categoria) | › percentual e taxa…, › média, e não soma… (com mutação) | PASS |
| Código numérico (CEP, CPF, IBGE…) não é medida | `recommend.ts` exclui papel `identifier` de `nums` | › código numérico… (com mutação) | PASS |
| Recomendação com explicação por coluna | `ChartSpec.reasons` preenchido em `suggestCharts`; exibido em “Por que este gráfico e como ler” (`main.ts`) | › cada gráfico traz as razões | PASS |
| Determinismo | mesma entrada → mesma saída | › é determinístico | PASS |
| Perfil filtrado × completo | `filterEffects(full, view)` | › mostra só as colunas que o filtro mudou | PASS; ligado na tela (aviso sob os filtros) e conferido no e2e 12, com mutação |
| Linhagem da coluna | `lineageOf` (renomeação, métrica, tipo, unidade, grafias unificadas) | › linhagem descreve… | PASS; ligado na tela (coluna “Papel e origem”) e conferido no e2e 12 |
| Correção manual de tipo marcada como tal | `Semantic.manual` | › marca a correção manual | PASS |

## Defeito corrigido (comportamento antes → depois)
- Antes: uma coluna numérica de código (ex.: CEP) podia virar “medida”: o teste com mutação mostrou o gráfico `cep × vendas` e o `Soma de cep` por categoria. Depois: não gera gráfico.
- Antes: coluna de percentual por categoria/mês era **somada** (soma de percentuais). Depois: **média**, com o texto “Média de…”.

## Verificação (observada)
- vitest: 104 passam (9 arquivos; 12 novos). tsc `--noUnusedLocals`, `npm run lint` e `vite build` sem erro. e2e: 18 cenários, 0 falhas (o 12 é novo). Observação: `npx eslint` direto falha neste ambiente (“could not determine executable”); o gate válido é `npm run lint`.
- Mutação 3 (aviso do filtro desligado): o e2e 12 falha esperando `.filter-note`.
- Mutação 1 (`aggFor` sempre soma): 2 testes falham. Mutação 2 (identificador volta a `nums`): 2 testes falham. Código restaurado depois.
- Nenhum arquivo novo passa de 400 linhas; `main.ts` está em 917 linhas (teto 930); sem ciclos.

## Limites e o que NÃO foi feito
- Regras de nome (CEP, taxa, valor…) são heurísticas em português; coluna com outro nome pode ser classificada como medida comum. O usuário continua podendo corrigir o tipo.
- “Insights auditáveis” cobre só o que já existia (texto calculado dos dados); não há ainda registro de evidência (n de pontos, fórmula) por insight.
- Sem validação visual (captura) do bloco de razões no cartão; foi verificado só pelos testes e pela execução do e2e existente.
- Instalador Windows/Electron e CI do GitHub: NOT_RUN.
