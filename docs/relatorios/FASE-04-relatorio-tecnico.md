# Fase 4 — Perfil semântico, recomendação explicada e linhagem

Status: **PENDENTE / parcial** (itens entregues e itens não feitos listados abaixo).

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
| Perfil filtrado × completo | `filterEffects(full, view)` | › mostra só as colunas que o filtro mudou | PASS (função); **NOT_RUN na tela** |
| Linhagem da coluna | `lineageOf` (renomeação, métrica, tipo, unidade, grafias unificadas) | › linhagem descreve… | PASS (função); **NOT_RUN na tela** |
| Correção manual de tipo marcada como tal | `Semantic.manual` | › marca a correção manual | PASS |

## Defeito corrigido (comportamento antes → depois)
- Antes: uma coluna numérica de código (ex.: CEP) podia virar “medida”: o teste com mutação mostrou o gráfico `cep × vendas` e o `Soma de cep` por categoria. Depois: não gera gráfico.
- Antes: coluna de percentual por categoria/mês era **somada** (soma de percentuais). Depois: **média**, com o texto “Média de…”.

## Verificação (observada)
- vitest: 104 passam (9 arquivos; 12 novos). tsc `--noUnusedLocals`, eslint e `vite build` sem erro. e2e: 17 cenários, 0 falhas.
- Mutação 1 (`aggFor` sempre soma): 2 testes falham. Mutação 2 (identificador volta a `nums`): 2 testes falham. Código restaurado depois.
- Nenhum arquivo novo passa de 400 linhas; `main.ts` segue em 912 (teto 930); sem ciclos.

## Limites e o que NÃO foi feito
- `filterEffects` e `lineageOf` existem e são testadas, mas **não estão ligadas à interface** (falta a coluna/aviso na tabela de colunas e no painel de filtros).
- Regras de nome (CEP, taxa, valor…) são heurísticas em português; coluna com outro nome pode ser classificada como medida comum. O usuário continua podendo corrigir o tipo.
- “Insights auditáveis” cobre só o que já existia (texto calculado dos dados); não há ainda registro de evidência (n de pontos, fórmula) por insight.
- Sem validação visual (captura) do bloco de razões no cartão; foi verificado só pelos testes e pela execução do e2e existente.
- Instalador Windows/Electron e CI do GitHub: NOT_RUN.
