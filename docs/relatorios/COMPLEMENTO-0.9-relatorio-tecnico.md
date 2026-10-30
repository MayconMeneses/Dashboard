# Complemento pós-0.8.0: pendências do relatório final e painel 0.9.0

Pedido do dono: “Instalar o `.exe` de verdade”, “Distribuir o instalador 0.4.0”, “Recursos da Fase 2 não feitos”, “Limites já registrados” e “Rollback”. Trabalho na branch `feature/dashboard-universal-0.9` (a partir do `main` publicado). Estados: PASS, NOT_RUN, PARCIAL.

## Matriz requisito → implementação → teste → estado
| Pendência | Implementação | Prova | Estado |
|---|---|---|---|
| Instalar o `.exe` de verdade | instalador 0.4.0 executado com `/S` por cima do 0.3.0 já instalado nesta máquina | código de saída 0; versão no registro de desinstalação 0.4.0; associações dos 9 tipos inalteradas (“Arquivo de dados”; o PDF seguiu com o Foxit do usuário); atalhos do Menu Iniciar e da Área de Trabalho regravados; app instalado abre com Electron 44.7.0 e, aberto com um CSV na linha de comando (como o clique duplo), mostra a prévia | PASS |
| Atualização no uso real | app instalado aberto com pasta de dados temporária e a rede real | o painel embutido (0.8.0) é igual ao publicado, então nada foi baixado e nenhuma pergunta apareceu — o comportamento esperado; **a pergunta “Atualizar agora / Depois” com versão realmente nova só poderá ser vista na próxima publicação** (provada em ambiente local no `desktop.mjs`) | PARCIAL |
| Distribuir o instalador | `universal/instaladores/Instalador-Completo-0.4.0.parte0.bin` e `parte1.bin` (56,6 MB cada, abaixo do limite de 100 MB), `JUNTAR.bat`, `SHA256SUM.txt`, `LEIA-ME.md`; commit `3aaddfb` no `main` | `JUNTAR.bat` com partes íntegras → SHA-256 confere (`2933ec69…4c06`); com uma parte alterada em 1 byte → recusa e apaga o arquivo montado; partes baixadas do GitHub e juntadas → mesmo SHA-256 | PASS |
| Alto contraste | `data-theme='contrast'` (preto/branco, foco amarelo), opção no seletor, segue o pedido de contraste do sistema no modo automático | `design.test.ts`: texto, destaques, bordas e foco ≥ 7:1 sobre todos os fundos, grade ≥ 3:1, paleta ≥ 3:1 sobre o preto; e2e 18: o tema aplica fundo preto e texto branco | PASS |
| Esqueletos de carregamento | `app/esqueleto.ts` ao ler arquivos (um ou vários) e ao gerar o PDF; sem animação com “menos movimento” | e2e 18: observador registra “Lendo o arquivo…” durante a leitura de 120 mil linhas e o esqueleto some ao aparecer a prévia | PASS |
| Reordenar cartões | alça de arrastar + botões ↑ ↓ (teclado e leitor de tela); ordem no projeto salvo e no relatório | `topo.test.ts` (ordem, mover, soltar); e2e 18: botão desce um gráfico, arrastar traz de volta, `chartOrder` gravado no projeto | PASS |
| Busca e período no topo | busca de texto sem acento/caixa (vale para KPIs, gráficos, tabela e relatório) e período rápido relativo à data mais recente dos dados | `topo.test.ts` (busca, datas nos dois formatos, 30/90 dias, 12 meses, ano atual e anterior); e2e 18: “sao paulo” → 8 de 40; “Este ano” → 16 | PASS |
| Painel lateral de filtros | `app/painelFiltros.ts`: aplicados (remover), acrescentar por coluna e valor, limpar tudo; Esc fecha de qualquer lugar; o foco volta ao controle ao redesenhar | e2e 18 e `acessibilidade.mjs` (abre/fecha por teclado, foco, controles ≥ 24 px). **Defeito achado pelo teste:** depois de “Limpar”, o foco ia para o corpo da página e o Esc não fechava o painel — corrigido | PASS |
| Parquet | `src/parquet.ts` com hyparquet 1.32.0 e hyparquet-compressors 1.1.2 (**MIT**, tamanho e licença conferidos no registro do npm; `hyparquet-writer` só para gerar arquivos de teste) | `parquet.test.ts` (6): nulo continua nulo, INT64 grande vira texto, soma 72,5 sem os nulos, limite de linhas com aviso, arquivo inválido e cortado recusados; e2e 18: abre `.parquet` pelo seletor (12 registros). Pacote do painel: 4.385 → 4.563 kB | PASS |
| Média simples de taxas | `agg: 'ratio'`: indicador “Taxa geral” (Σ ÷ Σ) e gráfico por categoria com a taxa geral | `fixtures-dominios.test.ts`: escolas 86,15% × média 82,5%; Fortaleza 83,33% (média 80%); denominador zero/ausente → sem dado; mutação desligando o cálculo faz 2 testes falharem | PASS |
| Mapa com dois pares de coordenadas | `geo/pares.ts` (`lat_origem`/`lon_origem` + `lat_destino`/`lon_destino`) e mapa de fluxos | `fluxos.test.ts` (8) e e2e 18: 5 linhas para 5 registros. **Defeito achado:** a exportação GeoJSON incluía ponto com latitude 95 — corrigido | PASS |
| Observable Plot | nova tentativa de leitura | HTTP 429 de novo (a página bloqueia o leitor automático) | NOT_RUN |
| Rollback | sem código: o manifesto só avança | uma correção sai como 0.8.1/0.9.1; reverter o commit do manifesto só vale para quem ainda não atualizou | informativo |

## Verificação (observada)
- vitest: 281 passam (23 arquivos). `npm run lint`, `tsc --noEmit --noUnusedLocals` e `vite build` sem erro. e2e: 24 cenários (o 18 é novo); acessibilidade: 7 verificações, com 152 paradas do Tab, todas com foco visível e 106 de 106 controles alcançáveis.
- `main.ts`: 794 linhas (teto 800); nenhum arquivo novo acima de 400.
- CI do `main` após a publicação da 0.8.0: ver o relatório final.

## Versões
Painel 0.9.0 e programa de desktop 0.5.0 (Parquet no “Abrir arquivo” e nas associações). **Nada disto foi publicado**: `universal/atualizacao/versao.json` continua em 0.8.0.

## Limites
GeoParquet não desenha a geometria (WKB); a linha do fluxo é reta; a taxa geral só aparece quando a relação entre colunas é detectada; o instalador 0.5.0 ainda não foi gerado; a pergunta de atualização com versão nova real só será vista na próxima publicação.
