# Dashboard Universal

Projeto independente do painel de triatomíneos (não altera nada dele). Recebe um arquivo e gera sozinho indicadores, gráficos, mapa (quando há coordenadas) e tabela.

- **Formatos:** CSV/TSV, Excel (XLSX, várias abas), **Word (.docx) com tabelas**, **PDF com tabelas (texto selecionável)**, JSON, GeoJSON, KML e KMZ. PDF escaneado (imagem) não é lido (não há OCR) e o formato antigo .doc não é suportado (salve como .docx).
- **Automático:** reconhece colunas (número, data, categoria, sim/não, identificador, latitude/longitude) e sugere gráficos; o seletor *Gráficos* mostra menos ou mais.
- **Prévia antes de gerar o painel:** mostra arquivo, formato, tamanho, SHA-256, codificação, separador, linhas lidas/ignoradas/não lidas, avisos e decisões da leitura, tipo de cada coluna (corrigível), valores inválidos e as primeiras linhas. Dá para trocar codificação (UTF-8/Windows-1252), separador, ordem de datas (dia/mês ou mês/dia) e formato de números (1.234,56 ou 1,234.56) antes de confirmar.
- **Arquivos grandes:** até 200 mil linhas por tabela (50 MB); acima disso o painel avisa quantas linhas ficaram de fora.
- **Valores inválidos e marcadores de ausência:** coluna numérica com texto isolado continua numérica e lista as linhas problemáticas; “n/d”, “-” e “s/i” contam como sem dado.
- **Categorias parecidas:** acento, caixa e 1 letra de diferença (“Croatá/Croata/CROATÁ”) geram aviso com botão “Juntar” (reversível; o original não é alterado).
- **Tabela de dados:** ordenar por coluna, paginar (25/50/100/500) e filtrar por período.
- **Relatório (PDF):** documento estruturado com origem (arquivo, SHA-256, data da leitura), registros lidos/ignorados/analisados, filtros e ajustes, indicadores, gráficos, critérios de cálculo, limitações e como reproduzir. Use “Salvar como PDF” na impressão.
- **Qualidade:** alertas de duplicatas, colunas vazias/constantes, muitas células vazias e valores muito distantes; dispersão automática quando há correlação ≥ 0,5 entre duas colunas numéricas.
- **Correção manual:** na tabela *Colunas reconhecidas* dá para trocar o tipo de qualquer coluna e os gráficos se refazem.
- **Planilhas de formulário:** títulos soltos e blocos separados por linhas em branco viram uma tabela por bloco (selecionável no topo); linhas de título acima do cabeçalho são ignoradas. Tabelas em que cada linha é um rótulo único (ex.: ciclos) geram um gráfico por indicador, na ordem do arquivo.
- **Comparativos:** colunas de mesma ordem de grandeza são plotadas lado a lado por rótulo (ex.: A.E × ALB por ciclo); em *Mais* também aparecem os gráficos individuais.
- **Título e contexto:** o título do bloco e os textos soltos do cabeçalho (município, mês, ano) aparecem acima dos indicadores.
- **Imprimir / PDF:** botão que usa a impressão do navegador (A4, gráficos redimensionados).
- **Filtro por clique:** clique numa barra ou fatia para filtrar KPIs, gráficos, tabela e o CSV exportado; o filtro aparece como etiqueta removível.
- **Celular:** layout ajustado para telas pequenas, sem rolagem lateral.
- **Blocos repetidos (ex.: um por mês):** planilhas com o mesmo cabeçalho repetido (Mês × Município × indicador) são reunidas numa tabela só, com gráficos de evolução, ranking, composição e comparação; células em branco continuam “sem dado”, coluna de total vazia é ignorada e inconsistências (ex.: “Zica”/“Zika”) viram alerta.
- **Variedade de gráficos com escolha automática:** linhas, colunas, barras, áreas, 100% empilhado, rosca, radar, mapa de calor, gráficos pequenos (um por série, mesma escala), Pareto, funil e bolhas. O sistema escolhe o desenho pelas regras abaixo, explica o motivo em “Por que este gráfico e como ler” e deixa trocar por qualquer alternativa compatível (o recomendado vem marcado).
  - Tempo (eixo em sequência): poucas séries → linha; muitas séries (≥ 6) → gráficos pequenos; um único valor com poucos períodos → colunas.
  - Categorias: ranking → barras horizontais; muitos itens (> 15) → Pareto; 2 a 4 partes de um todo → rosca; categoria × série → colunas empilhadas.
  - Proporção/área/radar só são oferecidos quando todos os valores são positivos.
  - Etapas em sequência (notificados → concluídos → confirmados) → funil; volume × taxa × tamanho por item → bolhas; item × período → mapa de calor.
- **Gerar HTML para compartilhar:** botão no topo; pede título e nome do arquivo e gera um único `.html` que abre exatamente como você está vendo (filtros, tipos de gráfico, gráficos removidos). Opção de versão só para leitura. Os dados vão dentro do arquivo.
- **Positividade sobre as colunas:** quando há situações como confirmados/descartados/notificados, as colunas por mês ganham uma linha (eixo da direita, em %) com a positividade do mesmo mês; um seletor troca a definição (confirmados ÷ concluídos, ou confirmados ÷ notificados). Meses sem casos concluídos ficam sem ponto (não é zero).
- **Cada gráfico se explica:** descrição do que mostra, frase de **destaque calculada dos próprios dados** (maior, menor, pico, variação, pontos sem dado) e “Como ler este gráfico”.
- **Regra de dados:** célula vazia nunca vira zero; aparece como “—” e fica fora das contas.
- **Privacidade:** o arquivo é processado no seu computador e seus dados não vão para nenhum servidor. Acessos externos que existem: o mapa de fundo (Esri) baixa imagens e revela a região vista (há a opção “Sem mapa de fundo”), e o programa instalado consulta o GitHub para checar atualizações (dá para desligar em Ajuda).
- **Compartilhar:** *Baixar HTML compartilhável* gera um único arquivo com os dados embutidos; *Baixar CSV* exporta a tabela.

```bash
cd universal && npm install --no-workspaces
npm run dev      # desenvolvimento
npm run build    # gera dist/index.html (arquivo único)
npm test
```
Próximos passos previstos: filtros interativos, mapa por polígonos e temas por assunto.

## Instaladores (Windows)
Prontos em [`instaladores/`](instaladores/LEIA-ME.md): versão leve (0,2 MB) e versão completa em 2 partes (junte com `JUNTAR.bat`), que se **atualiza sozinha** pelo GitHub. Para gerar de novo: `desktop/README.md`.

## Testes
- `npm test`: testes unitários (leitura de CSV, XLSX, DOCX, PDF, KML/KMZ, GeoJSON, codificação e separador, valores inválidos, datas e números regionais, categorias parecidas, gráficos, tabela e relatório).
- `npm run build && npm run test:e2e`: teste de ponta a ponta no navegador (prévia, juntar grafias, ordenar/paginar, período, relatório, HTML compartilhável, arquivo de 120 mil linhas). Requer Chromium (`CHROME_PATH`) e o `playwright-core` da raiz do repositório; não roda no CI.
