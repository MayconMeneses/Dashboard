# Changelog — Dashboard Universal

## 0.8.0 (em preparação, branch `feature/dashboard-universal-2`; **não publicado**)

O manifesto de atualização (`atualizacao/versao.json`) continua em 0.7.5: publicar é uma decisão separada (ver “Como publicar”).

### Novidades
- **Design system escuro/claro** (azul-marinho, ciano e roxo), barra lateral recolhível; PDF e impressão saem sempre em tema claro.
- **Papel de cada coluna** (medida, dimensão, tempo, identificador, geográfica…) com a regra que decidiu; razões por gráfico; efeito do filtro e origem de cada coluna na tela.
- **Explorar por conta própria** (agrupar, medida, cálculo) e métricas **mínimo, máximo e mediana**.
- **Registro de desenhos de gráfico** (novos gráficos entram sem mexer no painel).
- **Geografia real**: polígonos, linhas e pontos preservados (GeoJSON e KML), camadas, mapa temático por quantis, densidade em grade, validação de coordenadas e CRS, exportação GeoJSON.
- **Vários arquivos e relações entre tabelas** com análise e confirmação antes de criar; a relação é guardada como receita no projeto; contagem de pontos por polígono.
- **Relatório PDF** com dois modelos (completo e resumo) e anexo territorial; fontes com SHA-256 quando há vários arquivos.
- **Atualização ao abrir (programa 0.4.0):** o aplicativo instalado pergunta “Atualizar agora / Depois” assim que abre, se houver painel novo; baixa só depois do “sim”, confere o SHA-256 e reabre o arquivo que estava aberto. Quem tem o programa 0.3.0 só recebe isso instalando o 0.4.0.
- **Acessibilidade medida por teste:** teclado completo, foco visível, alvos ≥ 24 px, sem rolagem lateral até 320 px, filtro cruzado por teclado, tabela equivalente ao mapa, paleta distinguível em daltonismo.
- **Modo offline verificado** por teste: nenhuma requisição externa em CSV, PDF, XLSX, relatório e HTML compartilhado.

### Correções
- Comparação de versões lia “1234.5” como 12345.
- Exportação CSV neutraliza células que começam com `=`, `+`, `-`, `@`.
- Dica do mapa executava HTML vindo do arquivo (**falha de segurança presente na 0.7.5 publicada**).
- Gráficos do PDF/impressão saíam ilegíveis no tema escuro.
- Download da atualização acima do limite era tratado como completo e gerava exceção no processo principal.
- ZIP que mente sobre o tamanho (KMZ, DOCX) burlava o limite; XLSX com parte gigante travava por mais de um minuto.
- `sku`, `lat_origem` e valores como “0001” entravam como medida (total de código, total de latitude).
- Paleta de gráficos indistinguível para daltônicos (laranja × dourado).
- Média de mês sem registro virava 0%; o destaque falava em “% do total” para médias; indicador “Total de” somava CEP e percentuais.

### Mudanças de comportamento (leia antes de atualizar)
- **Paleta de gráficos nova** (as cores das séries mudam).
- **Colunas de código e de coordenada** (`sku`, `lat_…`, zeros à esquerda) deixam de ser medida.
- **Mapa de fundo padrão: nenhum.** A Esri só entra se escolhida. Projetos antigos que traziam a Esri sem escolha registrada abrem sem fundo e avisam.
- **Latitude/longitude de polígonos e rotas**: agora o centroide ponderado por área/comprimento (antes, média dos vértices); valores mudam em arquivos poligonais.
- **Novas colunas** em GeoJSON/KML: `id_geom` e `geometria`.
- **Percentual e taxa** usam **média** em gráficos por categoria e por mês (antes, soma).
- **Códigos numéricos** (CEP, CPF, IBGE…) não viram medida nem gráfico; o indicador passa a “Média de …” para percentuais.
- O **gráfico da exploração manual** entra no PDF como os demais.
- O **arquivo de dados** pode ser vários: a prévia deixa de oferecer codificação/separador quando há mais de um.

### Limites conhecidos
Sem reprojeção de coordenadas; Parquet e OCR não implementados; o instalador NSIS foi construído e o aplicativo Electron foi aberto e testado desempacotado, mas a **instalação real** (atalhos, associação de arquivos, desinstalação e atualização automática) não foi exercitada; instalador e atualizador não são assinados.

## Como publicar (decisão do dono, depois de integrar a branch)
1. Integrar `feature/dashboard-universal-2` ao `main` (pull request), sem force push.
2. `cd universal && npm run build` e, em `universal/desktop`, `npm run publicar` (gera `atualizacao/index.html` e `versao.json` com SHA-256).
3. Conferir `atualizacao/versao.json` e fazer o commit/push do manifesto. Só então os programas instalados passam a baixar a 0.8.0.
4. Instalador novo (opcional): Actions › “Instalador do Dashboard Universal” › *Run workflow* (constrói o NSIS no Windows do GitHub).

Rollback: não publicar o manifesto, ou voltar `atualizacao/` ao commit anterior; o `main` anterior (`91bce58`) permanece intacto até a integração.

## 0.7.5
Filtro do histograma e indicadores acompanham o filtro (publicado em `main`).
