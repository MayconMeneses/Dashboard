# Dashboard Universal

Projeto independente do painel de triatomíneos (não altera nada dele). Recebe um arquivo e gera sozinho indicadores, gráficos, mapa (quando há coordenadas) e tabela.

- **Formatos:** CSV/TSV, Excel (XLSX, várias abas), JSON, GeoJSON, KML e KMZ.
- **Automático:** reconhece colunas (número, data, categoria, sim/não, identificador, latitude/longitude) e sugere gráficos; o seletor *Gráficos* mostra menos ou mais.
- **Qualidade:** alertas de duplicatas, colunas vazias/constantes, muitas células vazias e valores muito distantes; dispersão automática quando há correlação ≥ 0,5 entre duas colunas numéricas.
- **Correção manual:** na tabela *Colunas reconhecidas* dá para trocar o tipo de qualquer coluna e os gráficos se refazem.
- **Planilhas de formulário:** títulos soltos e blocos separados por linhas em branco viram uma tabela por bloco (selecionável no topo); linhas de título acima do cabeçalho são ignoradas. Tabelas em que cada linha é um rótulo único (ex.: ciclos) geram um gráfico por indicador, na ordem do arquivo.
- **Comparativos:** colunas de mesma ordem de grandeza são plotadas lado a lado por rótulo (ex.: A.E × ALB por ciclo); em *Mais* também aparecem os gráficos individuais.
- **Título e contexto:** o título do bloco e os textos soltos do cabeçalho (município, mês, ano) aparecem acima dos indicadores.
- **Imprimir / PDF:** botão que usa a impressão do navegador (A4, gráficos redimensionados).
- **Filtro por clique:** clique numa barra ou fatia para filtrar KPIs, gráficos, tabela e o CSV exportado; o filtro aparece como etiqueta removível.
- **Celular:** layout ajustado para telas pequenas, sem rolagem lateral.
- **Regra de dados:** célula vazia nunca vira zero; aparece como “—” e fica fora das contas.
- **Privacidade:** tudo roda no navegador; nada é enviado.
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
