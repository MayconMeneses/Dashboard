# Fase 6 — GIS avançado

Status: **PENDENTE / parcial**. Entregue e testado: geometrias reais preservadas e desenhadas, centroide por área, validação geográfica, camadas, mapa temático, densidade em grade, exportação GeoJSON. Não feito ou não verificado: ver “Limites”.

## Antes → depois
- Antes: GeoJSON e KML eram reduzidos a um ponto (média dos vértices); polígonos, rotas e buracos se perdiam. O KML lia só a primeira lista de coordenadas do Placemark. O mapa só desenhava pontos e cortava em 5.000 linhas sem avisar.
- Depois: a forma real é guardada (`Table.shapes` por identificador `id_geom`) e desenhada; o ponto `latitude`/`longitude` passa a ser o centroide ponderado pela área (polígonos, com buracos descontados) ou pelo comprimento (linhas). **Mudança de comportamento:** arquivos poligonais passam a ter latitude/longitude diferentes das de antes (a média dos vértices era enviesada).

## Matriz requisito → implementação → teste → estado
| Requisito (prompt, Fase 6) | Implementação | Teste | Estado |
|---|---|---|---|
| Preservação de geometrias reais | `src/geo/read.ts` (GeoJSON: coleção, feição isolada, geometria solta, Multi*, buracos, GeometryCollection; KML: Point, LineString, Polygon com `innerBoundaryIs`, MultiGeometry), `src/geo/table.ts`, `Table.shapes` | `test/geo.test.ts` (arquivos GeoJSON e KML, centroide, ordem lon,lat) | PASS |
| Polígonos | `charts/mapLayers.ts` (`L.geoJSON`, anéis com buraco) | e2e 14: 3 polígonos desenhados, o com buraco tem 2 subcaminhos | PASS |
| Linhas | idem, camada “Linhas” | `geo.test.ts` (rota KML) ; **desenho de linha sem e2e próprio** | PASS (dado) / NOT_RUN (tela) |
| Camadas | `L.control.layers` (Polígonos, Linhas, Pontos, Calor) | — | NOT_RUN (não exercitado no e2e) |
| CRS | só WGS84: CRS legado diferente de CRS84/4326 e coordenadas em metros geram aviso (“converta para WGS84”); **não reprojeta** | `geo.test.ts` (3 casos) + e2e 14 (prévia avisa) | PASS |
| Validação geográfica | `validateGeometry`: fora do intervalo, não numérica, projetada, anel aberto, anel curto, ponto 0,0; resumo por tipo nas notas da leitura | `geo.test.ts` (6 casos) | PASS |
| Mapas de calor | densidade em grade quadrada (`gridBins`, células “redondas”), sem biblioteca | `geo.test.ts`: soma das células = total de pontos; célula certa por ponto | PASS (cálculo) / NOT_RUN (tela) |
| Agregações espaciais | `containsPoint` (anel externo menos buracos) | `geo.test.ts` (3 casos) | PARCIAL: a função existe e é testada, mas **não há ainda agregação “pontos por polígono” na tela** (precisa de duas camadas: Fase 7) |
| Mapas temáticos | coroplético por medida, classes por quantis (`classBreaks`), legenda com contagem, “sem dado” em cinza, aviso sobre totais brutos | `geo.test.ts` (quebras), e2e 14 (legenda e cores distintas) | PASS |
| Exportações cartográficas | botão “Baixar GeoJSON (linhas atuais)” com a geometria real e as propriedades | `geo.test.ts` (2 casos); **download não exercitado no e2e** | PASS (função) / NOT_RUN (clique) |
| Exportar imagem do mapa | — | — | NOT_RUN (o mapa com fundo da Esri não é exportável como imagem; sem fundo, não implementado) |
| Fallback Leaflet | o mapa continua em Leaflet (sem WebGL); nenhuma dependência nova | e2e inteiro | PASS |
| Avaliação MapLibre / deck.gl / Turf | ver abaixo | — | PASS (leitura) |

## Avaliação de bibliotecas (páginas oficiais lidas em 2026-10-29; o que a página não diz fica “não informado”)
| Biblioteca | O que a página informa | Licença | Versão citada | WebGL / rede | Decisão |
|---|---|---|---|---|---|
| MapLibre GL JS | renderiza mapas vetoriais com WebGL; exemplos de camadas GeoJSON de polígono, linha, ponto, mapa de calor e agrupamentos; guia de otimização para GeoJSON grande (não lido) | não informado na página | v6 (CDN `^6.16.0`, só ES modules) | usa WebGL; exemplos usam estilo e tiles remotos (demotiles, MapTiler) | **não adotada**: exigiria WebGL e fonte de tiles; só faz sentido se 5.000 polígonos em SVG deixarem de bastar |
| deck.gl (agregações) | camadas Contour, Grid, Heatmap, Hexagon, ScreenGrid; GPU mais rápida que CPU acima de ~100 mil objetos e mais lenta em conjuntos pequenos | não informado | não informado | fala em agregação em GPU; rede não informada | **não adotada**: a densidade em grade foi feita em CPU, sem dependência |
| Turf.js | motor geoespacial modular sobre GeoJSON (operações espaciais, classificação, estatística); não desenha mapas | não informado | 7.4.0 | não informado | **não adotada agora**; candidata para interseção/recorte na Fase 7 se `containsPoint` não bastar |

Licenças e tamanhos de pacote **não foram verificados** (as páginas lidas não os trazem). Critério 18 mantido: nenhuma dependência adicionada.

## Verificação (observada)
- vitest: 160 passam (12 arquivos; 26 novos em `test/geo.test.ts`). `npm run lint`, `tsc --noEmit --noUnusedLocals`, `vite build` sem erro. e2e: 20 cenários, 0 falhas (14 novo).
- Mutações (feitas e revertidas): centroide por média de vértices → 6 testes falham; dica do polígono como HTML → e2e falha (“HTML do arquivo não pode executar na dica do mapa”).
- Desempenho (critério 16): 5.000 polígonos (quadrados sintéticos) desenhados em SVG em ~0,7 s no Chrome desta máquina (e2e 14). Medida única, uma máquina, polígonos simples de 5 vértices; não vale para polígonos com milhares de vértices. Limite do desenho mantido em 5.000 feições, informado no cartão.
- Arquivos: `main.ts` 910 linhas (teto 915); nenhum arquivo novo acima de 400; sem ciclos.

## Limites e riscos abertos
- **Fundo do mapa padrão é Esri (acessa a internet)** e revela a região consultada. É uma decisão anterior à Fase 6, não alterada; vai ao usuário (critério 12: “dados privados não saem por padrão”).
- Sem reprojeção: arquivos em UTM/outro CRS são recusados no mapa com aviso, não convertidos.
- Centroide e área são planos, em graus: servem para posicionar, não para medir distância ou área.
- Geometrias muito detalhadas e arquivos de mais de 50 MB não foram medidos.
- Camadas, linhas na tela, download e densidade em grade na tela não têm cenário e2e próprio.
- Seleção de cor/densidade do mapa não é salva no projeto nem no HTML compartilhável.
- Instalador Windows/Electron e CI do GitHub: NOT_RUN.
