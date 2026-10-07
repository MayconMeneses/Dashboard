# Prompt: Dashboard de Vigilância de Triatomíneos (Barbeiros) – Município de Croatá/CE

> Copie tudo abaixo da linha e cole em um assistente de código (Claude Code, etc.) dentro de um repositório vazio.

---

## 1. PAPEL E OBJETIVO

Você é um desenvolvedor full-stack sênior com experiência em geoprocessamento e dashboards de saúde pública. Construa um **dashboard web de vigilância entomológica da Doença de Chagas** para o **município de Croatá (Ceará, Brasil)**. O sistema lê um arquivo **KML ou KMZ** com as localidades e as capturas de triatomíneos (barbeiros) e gera automaticamente: (a) um gráfico de colunas por localidade, (b) um mapa interativo do município com as localidades e (c) a lista dos barbeiros de cada localidade selecionada.

**Requisito central:** o usuário pode, a qualquer momento, **enviar um novo KML/KMZ atualizado** (upload ou arrastar e soltar) e todo o dashboard é recalculado a partir dele, sem alterar código.

## 2. CONTEXTO DO DOMÍNIO

- Triatomíneos (barbeiros) são os vetores do *Trypanosoma cruzi*, causador da Doença de Chagas.
- Os agentes de endemias capturam insetos em domicílios e peridomicílios de cada localidade. Os insetos são examinados em laboratório e o resultado é **Positivo** (infectado por *T. cruzi*) ou **Negativo**.
- Existem duas situações de registro que o painel deve separar: **Captura** (insetos já capturados e com resultado) e **Em captura** (localidades/pontos com captura em andamento ou aguardando resultado). Para cada uma, o resultado do triatomíneo é **Positivo** ou **Negativo**.
- Termos usados na interface, em português do Brasil: Localidade, Captura, Em captura, Positivo, Negativo, Triatomíneo, Espécie, Data da captura, Ambiente (intra/peridomicílio).

## 3. STACK E RESTRIÇÕES TÉCNICAS

- **Aplicação 100% front-end estática** (sem backend), para publicar em GitHub Pages, Netlify ou abrir `index.html` direto. Todo o processamento do KML/KMZ acontece **no navegador**; nenhum dado é enviado a servidor (são dados de saúde).
- Use **Vite + TypeScript** (ou HTML/JS puro modular se preferir simplicidade; justifique a escolha no README).
- Bibliotecas sugeridas:
  - Mapa: **Leaflet** (+ tiles OpenStreetMap, com alternância para satélite).
  - Gráfico: **Chart.js** ou **Apache ECharts** (colunas empilhadas ou agrupadas).
  - KMZ: **JSZip** para descompactar (KMZ é um ZIP contendo `doc.kml` e imagens).
  - Parse de KML: `DOMParser` nativo ou `@tmcw/togeojson` para converter em GeoJSON.
  - Tabela: implementação própria leve (ordenação + busca) ou TanStack Table.
- Responsivo de 375 px a 1280 px+, sem overflow horizontal da página; alvos de toque ≥ 44 px; foco visível e navegação por teclado; contraste AA; respeitar `prefers-reduced-motion`.
- Suporte a modo claro e escuro.
- Todos os textos em **pt-BR**; datas `dd/mm/aaaa`; números com separador brasileiro.

## 4. ENTRADA DE DADOS: KML/KMZ

### 4.1 Upload
- Área de **arrastar e soltar** + botão "Enviar arquivo KML/KMZ". Aceitar `.kml` e `.kmz`.
- Ao carregar: validar, mostrar um resumo ("N localidades, N registros de barbeiros, N ignorados") e renderizar tudo.
- Persistir o último arquivo carregado em **IndexedDB** para o painel reabrir com os dados anteriores; botão "Limpar dados".
- Incluir um **arquivo de exemplo** (`public/exemplo-croata.kml`) com ~15 localidades fictícias de Croatá e ~60 registros, e botão "Carregar exemplo". Deixar claro na UI que é dado fictício.

### 4.2 Estrutura esperada (tolerante a variações)
O KML pode estar organizado de formas diferentes. O parser deve suportar **todas** as abordagens abaixo e detectar automaticamente a que estiver presente:

1. **Folders = localidades.** Cada `<Folder>` é uma localidade e cada `<Placemark>` dentro dele é um barbeiro/captura.
2. **Placemarks com atributo de localidade.** Cada `<Placemark>` traz a localidade em `ExtendedData` (`<Data name="localidade">` ou `<SimpleData>`) ou na `<description>` (tabela HTML ou linhas `chave: valor`).
3. **Placemarks de localidade (ponto/polígono) + Placemarks de barbeiros** separados; associe cada barbeiro à localidade pelo atributo ou, na falta dele, pela **proximidade espacial / ponto dentro do polígono** (point-in-polygon).

Campos a extrair de cada Placemark (nomes de campo case-insensitive, sem acento, com sinônimos):

| Campo interno | Sinônimos aceitos |
|---|---|
| `localidade` | localidade, comunidade, sitio, distrito, povoado, local |
| `situacao` | situacao, status, etapa (valores: "Captura" / "Em captura") |
| `resultado` | resultado, positividade, t_cruzi, infeccao, exame (valores: Positivo/Negativo, Pos/Neg, P/N, Sim/Não, 1/0) |
| `especie` | especie, espécie, triatomineo, triatomíneo (ex.: *Triatoma brasiliensis*, *T. pseudomaculata*) |
| `quantidade` | quantidade, qtd, n, exemplares (padrão 1) |
| `data` | data, data_captura, dt_captura |
| `ambiente` | ambiente, local_captura (intra/peri) |
| `endereco` / `morador` / `observacao` | opcionais |
| `lat`, `lng` | vindos da geometria `<Point>` (KML usa **lon,lat,alt**; não inverter) |

Também ler: `<name>`, `<description>`, `<styleUrl>`/cor do estilo (usar como pista de Positivo/Negativo **somente se** não houver campo de resultado, e avisar o usuário), `<Polygon>`, `<LineString>`, `<MultiGeometry>`, `NetworkLink` (ignorar com aviso), `<ExtendedData>`/`<SimpleData>`/`<Schema>`.

### 4.3 Mapeamento manual (fallback)
Se campos obrigatórios (`localidade`, `resultado`) não forem encontrados automaticamente, abrir um **assistente de mapeamento de colunas**: mostrar os campos detectados no arquivo, deixar o usuário apontar qual é qual, e salvar o mapeamento em `localStorage` para próximos uploads do mesmo modelo.

### 4.4 Normalização e qualidade
- Normalizar nomes de localidade (trim, caixa, acentos, espaços duplos) e **agrupar variações** ("Sítio Boa Vista" = "SITIO BOA VISTA"). Mostrar lista de possíveis duplicatas para o usuário confirmar a fusão.
- Registros sem resultado ficam como **"Sem resultado"** (categoria própria, cinza), nunca contados como negativos.
- Registros sem coordenadas entram no gráfico e na tabela, mas não no mapa; avisar quantos.
- Painel "Qualidade dos dados" listando: linhas ignoradas e o motivo, coordenadas fora do município, resultados não reconhecidos, datas inválidas.
- Tratar arquivos grandes (até ~20 MB) sem travar a interface (usar Web Worker para o parse).

## 5. LAYOUT DA PÁGINA (padrão "dashboard")

Tela única, nesta ordem (no desktop, grade de 12 colunas; no mobile, uma coluna):

1. **Cabeçalho**: título "Vigilância de Triatomíneos – Croatá/CE", data/hora da última atualização do arquivo, nome do arquivo carregado, botões "Enviar KML/KMZ", "Exemplo", "Exportar" e alternância claro/escuro.
2. **Cartões de indicadores (KPIs)**: total de localidades, total de triatomíneos, total **Positivos**, total **Negativos**, **% de positividade**, localidades com ao menos 1 positivo, e quantidade "Em captura". Cada KPI com rótulo claro e valor grande; sem decoração.
3. **Filtros globais** (afetam gráfico, mapa e tabela simultaneamente): situação (Captura / Em captura / Todas), resultado (Positivo / Negativo / Sem resultado), espécie, ambiente, intervalo de datas, busca por nome de localidade. Mostrar filtros ativos como chips removíveis e botão "Limpar filtros". Refletir o estado dos filtros na **URL** (querystring).
4. **Gráfico de colunas** (esquerda, ~7/12) e **Mapa** (direita, ~5/12 – ou ocupando mais, ver seção 7); ambos sincronizados.
5. **Painel de detalhe da localidade selecionada** com a lista de barbeiros (seção 8).

## 6. GRÁFICO DE COLUNAS POR LOCALIDADE

- Eixo X: **localidades existentes** no arquivo. Eixo Y: quantidade de triatomíneos.
- Cada localidade exibe **colunas por combinação Situação × Resultado**:
  - Captura – Positivo
  - Captura – Negativo
  - Em captura – Positivo
  - Em captura – Negativo
  (mais "Sem resultado" apenas se existir).
- Oferecer alternância **Agrupado ↔ Empilhado** e **Quantidade ↔ Percentual**.
- Cores consistentes em todo o app (e acessíveis a daltônicos; nunca depender só da cor – usar também padrão/hachura ou rótulo): Positivo em tom quente (vermelho/laranja), Negativo em tom frio (azul/verde); "Em captura" com a mesma matiz, porém mais clara ou hachurada, para distinguir de "Captura".
- Ordenação: por total, por positivos, por nome (A–Z); padrão = mais positivos primeiro.
- Com muitas localidades (>20): rolagem horizontal **dentro** do container do gráfico, ou barras horizontais no mobile, e opção "Mostrar top N".
- Tooltip com: localidade, situação, resultado, quantidade, % do total da localidade.
- Legenda clicável (liga/desliga séries).
- **Interação:** clicar em uma coluna/rótulo de localidade **seleciona a localidade** (destaca no gráfico, centraliza o mapa e abre o detalhe). Clicar de novo desseleciona.
- Barra de ferramentas do gráfico: baixar PNG e CSV dos dados do gráfico. Botões só com ícone devem ter tooltip e `aria-label`.
- Alternativa acessível: tabela de dados equivalente ("Ver como tabela").

## 7. MAPA DO MUNICÍPIO DE CROATÁ

- Centralizar e dar `fitBounds` no **limite municipal de Croatá/CE**. Obter o polígono pela **API de malhas do IBGE** (`https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{codigo}?formato=application/vnd.geo+json&qualidade=minima`), descobrindo o código IBGE do município pelo nome via `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/` (filtrar "Croatá" / UF CE; **não** fixar o código de memória sem verificar). Guardar uma cópia do GeoJSON em `public/croata-limite.geojson` como **fallback offline** caso a API falhe.
- Desenhar o limite com contorno marcante e preenchimento quase transparente; restringir o pan/zoom a uma área levemente maior que o município.
- Camadas (controle de camadas ligar/desligar): Limite municipal, Localidades, Barbeiros capturados, Mapa de calor de positivos (opcional), e base OSM / Satélite.
- **Localidades:** se o KML trouxer polígonos, desenhá-los; se trouxer só pontos, desenhar marcadores circulares com **tamanho proporcional ao total de triatomíneos** e **cor pela positividade** (verde/azul = só negativos; laranja = alguns positivos; vermelho = alta positividade). Rótulo com o nome visível a partir de certo zoom.
- **Barbeiros:** marcadores individuais (ou clusters com `leaflet.markercluster` quando muitos), cor por resultado (Positivo/Negativo) e forma/anel diferente para "Em captura".
- Popup/tooltip: nome da localidade, totais por situação × resultado, e botão "Ver barbeiros".
- **Selecionar localidade:** clique no mapa ou no gráfico ou na lista/combobox "Localidade". A selecionada fica destacada (contorno grosso), o mapa dá `flyToBounds` suavemente (sem animação se `prefers-reduced-motion`), as demais ficam atenuadas e os barbeiros daquela localidade são exibidos.
- Botão "Voltar ao município" (reset de zoom e seleção). Legenda do mapa fixa e compacta. Escala e atribuição OSM/IBGE.
- Pontos fora do município: marcar com aviso e listar em "Qualidade dos dados" (não descartar silenciosamente).

## 8. LISTA DE BARBEIROS DA LOCALIDADE SELECIONADA

Ao selecionar uma localidade, abrir painel lateral (desktop) ou gaveta inferior (mobile) com:

- Cabeçalho: nome da localidade, mini-resumo (total, positivos, negativos, % positividade, em captura) e botão "Fechar" / "Desselecionar".
- **Tabela de barbeiros**: ID/nome do ponto, espécie, situação (Captura/Em captura), resultado (selo Positivo/Negativo com texto, não só cor), data, ambiente, quantidade, endereço/morador (se existir), coordenadas.
- Ordenação por coluna, busca textual, filtro rápido por resultado e situação, paginação ou rolagem virtual.
- Clicar em uma linha **centraliza o mapa** no ponto e abre seu popup; passar o mouse na linha destaca o marcador.
- Botão "Exportar esta localidade (CSV)".
- Estado vazio: se a localidade não tiver registros após os filtros, mostrar mensagem objetiva e botão "Limpar filtros".

## 9. EXPORTAÇÃO E COMPARTILHAMENTO

- Exportar tabela filtrada em **CSV** (UTF-8 com BOM para abrir no Excel) e **GeoJSON**.
- Exportar o gráfico em PNG e imprimir o painel em PDF (CSS de impressão limpo).
- Link compartilhável com filtros e localidade selecionada na URL (os dados continuam locais; avisar que o destinatário precisa carregar o arquivo).

## 10. ESTADOS DA INTERFACE

- **Vazio inicial:** instrução clara + área de upload + botão "Carregar exemplo". Sem ilustrações infantis.
- **Carregando:** indicador inline para operações curtas, *skeleton* para o painel durante o parse.
- **Erro:** mensagens que não culpam o usuário e oferecem saída. Ex.: "Não conseguimos ler este arquivo. Verifique se é um KML ou KMZ e tente de novo, ou abra o assistente de mapeamento." Casos: arquivo não é ZIP/XML válido, KMZ sem `doc.kml`, nenhum Placemark, campos obrigatórios ausentes, falha ao baixar o limite do IBGE (usar fallback).
- Botões com verbo primeiro: "Enviar arquivo", "Carregar exemplo", "Exportar CSV", "Limpar filtros".

## 11. ARQUITETURA E ORGANIZAÇÃO DO CÓDIGO

```
/
├─ index.html
├─ src/
│  ├─ main.ts
│  ├─ state/            # store central (filtros, seleção, dados) com eventos
│  ├─ parsing/          # kmz-reader.ts, kml-parser.ts, field-mapper.ts, normalize.ts, worker.ts
│  ├─ domain/           # tipos (Localidade, Registro), agregações, KPIs
│  ├─ ui/               # header, kpis, filters, chart, map, detail-panel, quality-panel, mapping-wizard
│  ├─ geo/              # point-in-polygon, bounds, carregamento do limite do IBGE
│  ├─ export/           # csv, geojson, png
│  └─ styles/           # tokens (cores, espaçamento 4/8 pt, tipografia) e componentes
├─ public/
│  ├─ exemplo-croata.kml
│  └─ croata-limite.geojson
├─ tests/
└─ README.md
```

- **Fluxo de dados único**: `arquivo → parser → registros normalizados → store → (gráfico, mapa, tabela, KPIs)`. Os componentes só leem do store; seleção e filtros são estado compartilhado, o que garante a sincronia gráfico ↔ mapa ↔ lista.
- Tipos explícitos (`Registro { id, localidade, situacao, resultado, especie, quantidade, data, ambiente, lat, lng, extras }`).
- Sem dependências desnecessárias; CSS com variáveis (tokens) para claro/escuro; sem glassmorphism ou efeitos decorativos.

## 12. TESTES E CRITÉRIOS DE ACEITE

Escreva testes (Vitest) para o parser e agregações, com fixtures de KML pequenas cobrindo as 3 estruturas da seção 4.2, KMZ, acentos, coordenadas lon/lat, resultados "Pos/Neg/P/N/Sim/Não", registros sem resultado e sem coordenadas.

O trabalho só está pronto quando:

1. Subir `exemplo-croata.kml` e depois um KMZ equivalente produz o **mesmo** dashboard.
2. Trocar por um segundo arquivo com localidades diferentes **atualiza** gráfico, mapa, KPIs e lista sem recarregar a página nem editar código.
3. O gráfico mostra, por localidade, as colunas Captura/Em captura × Positivo/Negativo, e a soma das colunas bate com o total da tabela e dos KPIs.
4. Clicar numa localidade no gráfico, no mapa ou na lista seleciona a mesma localidade nos três e exibe seus barbeiros.
5. O mapa mostra o limite de Croatá e funciona se a API do IBGE estiver indisponível (fallback).
6. Nenhum registro é descartado em silêncio: tudo o que foi ignorado aparece em "Qualidade dos dados".
7. Sem rolagem horizontal da página em 375 px; navegação completa por teclado; contraste AA.
8. `npm run build` e `npm test` passam sem erros; README explica como rodar, publicar e o formato esperado do KML.

## 13. ENTREGAS

1. Código completo conforme a estrutura acima, funcionando com `npm install && npm run dev`.
2. `README.md` em pt-BR: como usar, como preparar o KML/KMZ (exemplo de Placemark com `ExtendedData`), tabela de campos e sinônimos, como publicar no GitHub Pages.
3. Arquivo de exemplo fictício e fixtures de teste.
4. Ao final, um resumo curto com decisões tomadas e **suposições** feitas.

## 14. PERGUNTAS A RESOLVER (se não houver resposta, adote o padrão indicado e registre no README)

- Como o seu KML marca "Captura" vs "Em captura" e "Positivo" vs "Negativo"? (Padrão: campos `situacao` e `resultado` em `ExtendedData`; se ausente, abrir o assistente de mapeamento.)
- Cada Placemark é um inseto/ponto de captura ou já vem com contagem? (Padrão: 1 Placemark = 1 registro; usar `quantidade` se existir.)
- As localidades são pontos ou polígonos no seu arquivo? (Padrão: suportar ambos.)
- Há dados pessoais (nome/endereço de moradores)? (Padrão: exibir só no detalhe e permitir ocultar a coluna; nunca enviar a servidor.)

---
**Comece listando brevemente seu plano e as suposições, depois implemente. Valide rodando o build, os testes e abrindo o app com o arquivo de exemplo antes de dar por concluído.**
