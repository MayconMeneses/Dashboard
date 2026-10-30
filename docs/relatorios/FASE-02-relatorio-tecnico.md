# Fase 2 — Novo design system (tema escuro azul-marinho + claro)

**Status: PENDENTE (parcial)** — o núcleo está entregue e testado; itens do escopo visual do Prompt Mestre ficaram de fora (lista abaixo). Nenhum cálculo foi alterado.

## Baseline
Branch `feature/dashboard-universal-2`, partindo do commit `e1a6728` (Fase 1).

## O que foi entregue (funciona, não é só visual)
| Item | Onde | Verificação |
|---|---|---|
| Tokens semânticos CSS (escuro padrão e claro) com os valores do Prompt Mestre ajustados onde o contraste exigia | `src/design/tokens.css` | `test/design.test.ts` |
| Seletor de tema (Escuro / Claro / Automático), preferência lembrada, `color-scheme` | `src/design/theme.ts`, `src/app/shell.ts`, `#themeSel` | e2e: padrão escuro, troca, preferência lembrada em outra aba do mesmo navegador |
| Barra lateral compacta e recolhível, com links que levam de fato às seções (Indicadores, Gráficos, Métricas, Dados, Colunas); só aparece com dados carregados | `index.html`, `style.css`, `src/app/shell.ts` | e2e: clique rola a página; recolher/expandir muda `aria-expanded` |
| Cartões, KPIs, controles e foco reestilizados com os tokens; foco visível; `prefers-reduced-motion` respeitado | `src/style.css` | contraste testado; foco por inspeção visual |
| Paleta de séries dos gráficos com contraste ≥ 3:1 sobre o cartão escuro **e** sobre branco (mesma cor serve tela, PDF e impressão) | `src/design/palette.ts` | `test/design.test.ts` |
| Gráficos (canvas) seguem o tema; PDF e impressão saem sempre em tema claro, fundo branco | `src/design/chartTheme.ts`, 3 pontos em `main.ts` | e2e por pixel (ver abaixo) |

## Erros encontrados e causa raiz
1. **Imagens dos gráficos no PDF/impressão ficavam com texto e grade do tema escuro sobre fundo branco** (ilegível). Causa: o Chart.js resolve as cores das escalas e da legenda na criação do gráfico e não relê `Chart.defaults` depois; a primeira correção (mexer em `options.color`) também não funcionou, e a segunda tentou espalhar um proxy do Chart.js e lançou exceção (o PDF ficou sem imagens por um momento). Correção final: gravar as cores propriedade a propriedade nas opções de cada gráfico (`recolor`). **Teste:** e2e abre o relatório com a tela escura, lê os pixels da imagem e exige fundo branco opaco, texto escuro presente e quase nenhum pixel da cor do texto do tema escuro. Verificado com mutação: com `recolor` desligado o teste **falha** ("texto escuro presente: 0").
2. Mapa (Leaflet) cobria o cabeçalho fixo; cabeçalho deixou de ser fixo e o mapa ganhou contexto de empilhamento próprio.
3. `e2e` e `capturas`: caminhos e contexto do navegador ajustados.

## Testes e comandos (resultados reais)
- `vitest run`: **89 passaram** (77 + 12 novos de design: contraste WCAG nos dois temas, paleta, tokens × cores do canvas, preferência de tema).
- `tsc --noEmit`: PASS · `eslint src test`: PASS · `vite build`: PASS (4.342 kB).
- `node e2e/e2e.mjs` (Chrome local): **16 cenários, 0 falhas** (13 anteriores + tema, barra lateral, imagens do PDF).
- Rolagem horizontal em 375 px de largura: 0 px (medido em `e2e/capturas.mjs`).

## Evidências (capturas, dados sintéticos)
`docs/relatorios/img/fase02/`: `desktop-dark.png`, `desktop-light.png`, `desktop-dark-menu-recolhido.png`, `mobile-dark.png`, `pdf-grafico-capturado.png` (imagem do gráfico exatamente como entra no PDF), `impressao-emulada.png` (evento `beforeprint` + mídia print). Geradas por `e2e/capturas.mjs` (exceto as duas últimas, geradas por script de apoio fora do repositório).

## Comparação antes/depois
Antes: tema claro/escuro só por `prefers-color-scheme`, sem barra lateral, cores soltas no CSS, paleta fixa. Depois: tokens, escolha explícita de tema (padrão escuro), navegação lateral, paleta única validada. Layout e funções existentes preservados (e2e anterior segue passando).

## Não implementado / não verificado (do escopo da Fase 2 do Prompt Mestre)
- Alto contraste opcional; skeleton loaders; drag-and-drop e redimensionamento de cards; salvar layout; seletor de período e busca no cabeçalho; painel lateral de filtros e propriedades; grid de 12 colunas; tabela detalhada recolhível. **NOT_RUN / não feito** — são tarefas novas, não regressões.
- Largura de tablet (~768 px), zoom 200% e navegação completa só por teclado: **não testados**; só 1440 px e 375 px foram capturados.
- Paleta "adequada a daltonismo": usa matizes distintos e legendas, mas **não foi simulada** com filtro de daltonismo.
- HTML compartilhável em tema escuro e janela do Electron/instalador: **não verificados** (o e2e do HTML compartilhável passou, mas não checa o tema).
- Texto nos gráficos por mapa (Leaflet) e popups em tema escuro: apenas filtro de brilho nos tiles; sem teste automatizado.
- O texto dos KPIs usa gradiente (`background-clip:text`); em modo de contraste forçado do Windows pode perder o efeito (não testado).

## Riscos
`main.ts` continua grande (só ganhou 3 pontos de integração); a refatoração é a Fase 3.

## Próximos passos
Fase 3 — refatoração modular de `main.ts` e `suggest.ts` com testes de paridade.
