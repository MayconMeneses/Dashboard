# Dashboard Universal

Projeto independente do painel de triatomíneos (não altera nada dele). Recebe um arquivo e gera sozinho indicadores, gráficos, mapa (quando há coordenadas) e tabela.

- **Formatos:** CSV/TSV, Excel (XLSX, várias abas), JSON, GeoJSON, KML e KMZ.
- **Automático:** reconhece colunas (número, data, categoria, sim/não, identificador, latitude/longitude) e sugere gráficos; o seletor *Gráficos* mostra menos ou mais.
- **Qualidade:** alertas de duplicatas, colunas vazias/constantes, muitas células vazias e valores muito distantes; dispersão automática quando há correlação ≥ 0,5 entre duas colunas numéricas.
- **Correção manual:** na tabela *Colunas reconhecidas* dá para trocar o tipo de qualquer coluna e os gráficos se refazem.
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
