# Fase 0 — Auditoria e baseline

**Status: APROVADA** (somente leitura e medições; nenhuma funcionalidade alterada nesta fase)

## Objetivo e escopo
Registrar o estado real de `universal/` antes das mudanças da versão 2.0, conforme o Prompt Mestre (fase 0).

## Baseline
- Repositório: `MayconMeneses/Dashboard`, branch de origem `main`, commit `91bce58b2d3d832ef91cf18014519165fec31e09` (painel 0.7.5).
- Branch de trabalho: `feature/dashboard-universal-2`.
- Ambiente: Windows 11, Node 24.20.0, Chrome instalado (usado só no e2e).

## Comandos executados (em `universal/`) e resultados reais
| Comando | Resultado |
|---|---|
| `npm ci --no-workspaces` | OK, 0 vulnerabilidades reportadas |
| `npx tsc --noEmit` | PASS (sem erros) |
| `eslint src test` | PASS (sem avisos) |
| `vitest run` | PASS — 67 testes em 5 arquivos |
| `vite build` | PASS — `dist/index.html` 4.334 kB (gzip 1.666 kB) |
| `node e2e/e2e.mjs` | NÃO executava no Windows (ver Fase 1); após correção do caminho, PASS |

## Inventário (tamanho dos módulos de `universal/src`, em linhas)
`main.ts` 1226 · `suggest.ts` 781 · `parse.ts` 359 · `formula.ts` 237 · `profile.ts` 186 · `project.ts` 179 · `report.ts` 176 · `grid.ts` 152 · `types.ts` 133 · `docx.ts` 126 · `shapes.ts` 106 · `pdf.ts` 86 · `similar.ts` 75 · `quadros.ts` 76 · `csv.ts` 59 · `xlsx.ts` 51 · `tableview.ts` 45 · `util.ts` 48.
- `main.ts` e `suggest.ts` concentram responsabilidades (interface, estado, gráficos, mapa, exportação, relatório) — alvo da Fase 3.

## Funcionalidades existentes confirmadas por leitura do código e por testes
Importação CSV/TSV/TXT, XLSX, DOCX, PDF digital, JSON, GeoJSON, KML, KMZ; prévia de leitura (codificação, separador); perfil de colunas e correção de tipo; recomendação de gráficos por nível; filtros por clique e por período; métricas por fórmula (sem `eval`); projetos salvos e "Atualizar dados"; relatório PDF; Excel de saída; HTML compartilhável; mapa Leaflet.

## CI existente
`.github/workflows/ci.yml` (lint, typecheck, testes, build; job do Dashboard Universal) e `universal-instalador.yml` (build do instalador no Windows, por tag/manual).

## Não verificado nesta fase
- Geração do instalador Windows (electron-builder/NSIS): NOT_RUN (exige baixar Electron e NSIS; fora do que foi feito aqui).
- Funcionamento do app Electron instalado: NOT_RUN.

## Riscos e pendências levantados
Ver Fase 1 (achados confirmados) e a lista de limitações geográficas (geometrias reduzidas a um ponto).
