# Fase 1 — Consistência, qualidade e segurança

**Status: APROVADA com ressalvas** (ver "Não verificado")

## Objetivo e escopo
Auditar KPIs/filtros, números, exportações, importação geográfica e entradas compactadas/XML; corrigir inconsistências **confirmadas**; criar testes de regressão. Sem mudanças de interface ou de cálculos fora do necessário.

## Achados e causa raiz
| # | Achado | Evidência | Estado |
|---|---|---|---|
| 1 | Comparação de versões (`compareTables`) lia `"1234.5"` como 12345 (removia todos os pontos) | Reproduzido: soma esperada 1240,5, obtida 12351 | **Corrigido** — passa a usar `toNumber` do próprio painel |
| 2 | Exportação CSV não neutralizava células iniciadas por `=`, `+`, `-`, `@` (injeção de fórmula ao reabrir no Excel) | Leitura de `csvCell` em `main.ts` | **Corrigido** — `csvField` em `csv.ts`; números negativos preservados |
| 3 | Ponto de referência de polígonos GeoJSON contava o vértice de fechamento duas vezes (quadrado 0–10 dava 4,4 em vez de 5,5) | Reproduzido | **Corrigido** (média dos vértices sem repetir o último) |
| 4 | `e2e/e2e.mjs` não rodava no Windows (`file:///C:/C:/…`) | Falha reproduzida | **Corrigido** (`new URL(...).href`) |
| 5 | KPIs e histograma com filtro | Já corrigido na 0.7.5 | Já resolvido |

## Verificações de segurança (resultado dos testes)
- KMZ com KML declarado acima de 50 MB: recusado sem descompactar (teste).
- DOCX com `document.xml` declarado acima de 60 MB: recusado (teste).
- KML e DOCX com `DOCTYPE`: recusados (teste).
- Arquivos corrompidos (KMZ, XLSX): erro compreensível, sem travar (teste).
- XLSX de saída grava texto como `inlineStr` (não vira fórmula) — conferido por leitura de `xlsx.ts`; sem teste novo.
- KMZ de 41 MB bem comprimido (200 mil placemarks): lido em ~6,7 s e truncado em 200.000 linhas **com aviso** (medição manual, não é teste automático).

## Arquivos
Alterados: `src/csv.ts`, `src/main.ts`, `src/parse.ts`, `src/project.ts`, `e2e/e2e.mjs`. Criados: `test/fase1.test.ts`, `docs/relatorios/FASE-00-…`, `FASE-01-…`.

## Testes (comandos reais)
- `vitest run`: **77 passaram** (67 anteriores + 10 novos). Sem os arquivos corrigidos, 2 dos novos falham (decimal e polígono), confirmando que detectam os defeitos; o do CSV valida a função nova.
- `tsc --noEmit`: PASS · `eslint src test`: PASS · `vite build`: PASS (4.334 kB).
- `node e2e/e2e.mjs` (Chrome local, `CHROME_PATH`): PASS, 13 cenários, 0 falhas (inclui PDF real, HTML compartilhável reaberto e arquivo de 120 mil linhas em 1,6 s).

## Não verificado / limitações
- ZIP com cabeçalho que **mente** sobre o tamanho: NOT_RUN (a proteção atual depende do tamanho declarado).
- Instalador Windows e app Electron: NOT_RUN.
- Geometrias GeoJSON/KML continuam reduzidas a um ponto (limitação conhecida, tratada na Fase 6); KML usa só a primeira sequência `coordinates` de cada Placemark.
- Meses sem registro viram 0 também em média (`agg: 'mean'`) em `chartData`; hoje nenhum gráfico sugerido usa esse caso (não alterado).
- Execução em Linux/CI do GitHub: NOT_RUN.

## Próximos passos
Fase 2 (design system escuro) e Fase 3 (refatoração de `main.ts`/`suggest.ts`).
