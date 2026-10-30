# Fase 3 — Refatoração modular (sem mudar comportamento)

**Status: PENDENTE (parcial)** — `suggest.ts` está dividido por responsabilidade; `main.ts` caiu de 1.226 para 912 linhas, mas **ainda é o maior arquivo** e continua acima do limite geral de 400 linhas (exceção temporária registrada em teste).

## Baseline
Branch `feature/dashboard-universal-2`, a partir do commit `ffebaff` (Fase 2).

## Objetivo e escopo
Reduzir as responsabilidades de `main.ts` e `suggest.ts` mantendo APIs e comportamento. Sem funcionalidade nova.

## Estrutura criada
| Módulo | Conteúdo | Linhas |
|---|---|---|
| `src/analytics/chartData.ts` | `chartData`, `pivotData`, agregação, `SeriesData` | 171 |
| `src/analytics/tidy.ts` | tabelas organizadas: fatos, KPIs, alertas, sugestões | 216 |
| `src/analytics/recommend.ts` | `suggestCharts`, correlação, gráficos por período | 160 |
| `src/analytics/quality.ts` | alertas de qualidade, relações entre colunas | 92 |
| `src/analytics/insights.ts` | frases de destaque e textos "como ler" | 95 |
| `src/analytics/kpis.ts`, `rates.ts`, `format.ts` | indicadores, taxas, formatação | 36 / 29 / 3 |
| `src/suggest.ts` | **fachada** de 9 linhas que reexporta tudo (nenhum import existente mudou) | 9 |
| `src/charts/` (`host`, `dataAlt`, `heatmap`, `small`, `funnel`, `bubble`, `map`, `scatter`) | desenhos de gráfico; recebem um `ChartHost` (registrar gráfico/mapa, filtrar) em vez de usar o estado global | ≤ 70 cada |
| `src/reports/screen.ts` | relatório PDF e de impressão; recebe um `ReportContext` explícito | 198 |
| `src/app/` (`dom`, `format`, `diffBox`, `shell`) | utilitários de DOM, formato de célula, caixa de diferenças, menu/tema | pequenos |

`main.ts`: 1.226 → **912** linhas (−26%). Quebra de dependência circular preexistente `suggest ↔ shapes` (import só de tipo) — agora **nenhum ciclo**.

## Defeito de segurança encontrado e corrigido (preexistente, publicado na 0.7.5)
- **Dica (tooltip) do mapa interpretava o conteúdo da célula como HTML** (o Leaflet trata `string` como HTML). Um arquivo com, por exemplo, `<img src=x onerror=…>` na primeira coluna executava script ao passar o mouse num ponto. **Reproduzido** pelo teste e2e novo (falha com o código antigo: "HTML do arquivo não pode executar na dica do mapa").
- Correção: o conteúdo vai como nó de texto (`tooltipText` em `src/charts/map.ts`). Teste e2e confere que não executa, que nenhum `<img>` é criado e que o texto aparece literal.
- Busca por outros pontos de injeção (`innerHTML`, `insertAdjacentHTML`, `bindPopup`, `document.write`, `DOMParser`): nenhum outro; o único `outerHTML` é o da exportação do HTML compartilhável, que já escapa `<` no JSON embutido.
- **Impacto prático:** o aplicativo instalado roda com `contextIsolation`, sandbox e sem `nodeIntegration`, o que limita o dano, mas a correção deve ir para o `main`. A versão **0.7.5 publicada tem este defeito** até esta branch ser integrada.

## Testes e comandos (resultados reais)
- `vitest run`: **92 passaram** (89 + 3 de modularidade). Os 89 anteriores seguem passando sem alteração (paridade).
- Teste de modularidade (`test/modularidade.test.ts`): limite de 400 linhas por arquivo, com exceção de `main.ts` (teto 930, que só pode diminuir), e ausência de ciclos. Verificado por mutação: arquivo de 450 linhas e ciclo `a ↔ b` criados de propósito **fizeram os testes falharem**; depois removidos.
- `tsc --noEmit --noUnusedLocals`: PASS · `eslint src test`: PASS · `vite build`: PASS (4.343 kB, praticamente igual).
- `node e2e/e2e.mjs` (Chrome local): **17 cenários, 0 falhas** (16 anteriores + dica do mapa). Cobre PDF real, HTML compartilhável reaberto, projeto salvo, arquivo de 120 mil linhas, tema, menu.

## Como a refatoração foi feita (e seus limites)
Extração por script com validação de cada corte e conferência do compilador a cada passo; não foi reescrita à mão. Isso garante que o texto das funções é o mesmo, exceto as trocas de estado global por parâmetros (`host`, `ctx`). **Não há teste unitário dos desenhos de gráfico** (dependem de canvas/DOM); a paridade deles é protegida pelo e2e e pela revisão das capturas, não por comparação pixel a pixel antes/depois.

## Não feito / pendências
- `main.ts` ainda concentra: estado da tela, `render`, tabela de dados, barra de período, métricas e renomear colunas, projeto (salvar/abrir/atualizar), prévia de leitura, exportações (HTML/Excel/CSV) e `init`. Próxima extração sugerida: prévia + projeto + exportações, usando o mesmo padrão de contexto explícito.
- `drawChart` (função principal de desenho, ~180 linhas) continua em `main.ts`.
- Não verificado: instalador Windows e Electron; execução no CI do GitHub.

## Riscos
Os módulos extraídos recebem o estado por parâmetro; uma mudança futura que volte a depender de variáveis globais seria pega por `tsc`, não pelos testes de comportamento.

## Próximos passos
Fase 4 — perfil semântico, recomendação por restrições com explicações e insights auditáveis (sobre os módulos `analytics/` agora separados).
