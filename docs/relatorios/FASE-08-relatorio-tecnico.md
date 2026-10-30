# Fase 8 — Relatórios, desktop e release

Status: **PENDENTE / parcial**. Entregue e testado: modelos de PDF, anexo territorial, exportação segura, modo offline, migração de preferências de projetos, benchmarks, documentação e verificações de segurança de release. **Não executado:** Electron e o instalador NSIS (critério 11).

## Matriz requisito → implementação → teste → estado
| Requisito (prompt, Fase 8) | Implementação | Teste | Estado |
|---|---|---|---|
| Templates PDF | `applyTemplate` (completo / resumido) em `src/report.ts`; seletor “Modelo do relatório” em `index.html`; lido em `reports/screen.ts` | `test/relatorio.test.ts` (3 casos) | PASS (lógica) / NOT_RUN (clique no seletor no e2e) |
| Relatórios territoriais | `src/reports/territory.ts` + “Anexo B. Território” no PDF (unidade, geometria, medida, classe por quantis, “sem dado”) | `relatorio.test.ts` (4 casos + PDF) | PASS (lógica) / NOT_RUN (PDF territorial gerado no e2e) |
| Exportação segura | Excel grava texto como `inlineStr` (nunca fórmula); CSV neutraliza `=+-@` (Fase 1); HTML compartilhável escapa `<` no JSON embutido | `release.test.ts` (Excel com 5 entradas perigosas); e2e 17 (dado com `</script><script>` não executa; mutação removendo o escape faz o e2e falhar) | PASS |
| HTML standalone | já existia; agora verificado sem rede | e2e 6 e 17 | PASS |
| Modo offline | cenário e2e com todas as requisições http(s) abortadas e registradas | e2e 17: CSV (pela ponte do desktop), relatório PDF, Excel, CSV, HTML compartilhado, PDF e XLSX importados → **0 requisições externas** | PASS |
| Electron | auditoria estática de `desktop/main.cjs` (abaixo); a ponte `window.__abrirArquivo(nome, base64)` que o Electron usa foi exercitada no Chrome | e2e 17 | PARCIAL: o programa Electron **não foi executado** |
| NSIS | `desktop/package.json` e workflow `universal-instalador.yml` existem; **não construído aqui** | — | NOT_RUN |
| SHA-256 | atualizador confere o hash do painel baixado; relatório e prévia listam o SHA-256 de cada fonte | revisão estática; e2e 16 (prévia); `release.test.ts` | PASS (verificação) / NOT_RUN (instalador novo não gerado, `SHA256SUM.txt` não regenerado) |
| Migração de preferências | `migrateState`/`FUNDO_PADRAO_ATE` em `project.ts`: projeto salvo antes da 0.8.0 com Esri abre sem fundo e avisa | `release.test.ts` (5 casos; mutação desligando a regra faz 3 testes falharem) | PASS |
| E2E | 23 cenários (17 novo) | `npm run test:e2e` | PASS |
| Benchmarks | `npm run bench` (`bench/desempenho.bench.ts`, fora do `npm test`); resultado em `docs/benchmarks/ultimo.json` | uma execução por medida, em Node | PASS (medição) |
| README, changelog, documentação | `universal/README.md` (privacidade, PDF, recursos, testes), `universal/CHANGELOG.md` (com mudanças de comportamento e como publicar), `desktop/README.md` | revisão | PASS |
| Auditoria final | `RELATORIO_FINAL_DASHBOARD_UNIVERSAL_2_0.md` | — | PASS (relatório) — veredito PENDENTE |

## Verificações de release que nenhum teste cobria (agora cobertas em `release.test.ts`)
- O `<title>` do painel é o que o atualizador exige (`<title>Dashboard…`); se mudasse, **todas as cópias instaladas recusariam** a atualização.
- `painelVersao` em `desktop/package.json` estava em **0.7.1**; um instalador gerado desta branch teria “atualizado para trás” para a 0.7.5. Agora igual à versão do painel (0.8.0), com teste.
- A lista de formatos do `main.cjs` e as associações de arquivo do instalador conferem com `src/formats.ts` (associações: `tsv` adicionado; `txt` e `doc` ficam de fora de propósito, para não capturar todo arquivo de texto do Windows).
- O manifesto de atualização publicado (`atualizacao/versao.json`) **não foi alterado** (continua 0.7.5): o teste falha se alguém publicar versão maior sem decisão consciente.

## Auditoria estática de `desktop/main.cjs` (lida, não executada)
- Sólido: `contextIsolation`, `sandbox`, sem `nodeIntegration`; navegação só para `file://`; pop-ups negados (HTTPS vai ao navegador); atualização só por HTTPS, com limite de tamanho, conferência de SHA-256 e de estrutura; instância única; arquivo entregue ao painel em base64.
- Limites: o manifesto e o HTML vêm da mesma origem, então o SHA-256 prova integridade mas **não autenticidade** (se o repositório for comprometido, o painel “atualizado” seria o do atacante); o executável e o instalador **não são assinados** (SmartScreen avisa); a consulta de atualização é ligada por padrão e contacta o GitHub ao abrir; redirecionamentos HTTP são seguidos sem limite de quantidade; a cor de fundo da janela (`#f5f6f8`) não acompanha o tema escuro (pisca claro antes de carregar).
- A abertura pelo menu e pelo Windows é de um arquivo por vez (vários arquivos só pelo seletor/arrastar do painel).

## Benchmarks (uma execução cada; Intel i5-8265U, 7,9 GB, Node 24, Windows; não valem para o navegador)
| Medida | Resultado |
|---|---|
| Ler CSV de 21,7 MB (300 mil linhas × 12 colunas; lê 200 mil) | 1,72 s |
| Perfil das 12 colunas (200 mil linhas) | 2,50 s |
| Analisar relação 200 mil × 5 mil chaves | 0,07 s |
| Criar a relação (200 mil linhas) | 0,15 s |
| 10 mil pontos em 5 mil polígonos | 0,61 s |
| Navegador: 5.000 polígonos desenhados em SVG (e2e 14) | ~0,7 a 1,1 s |
| Navegador: abrir CSV de 120 mil linhas (e2e 7) | ~1,6 s |

## Verificação (observada)
- vitest: 206 passam (16 arquivos). `npm run lint`, `tsc --noEmit --noUnusedLocals` e `vite build` sem erro. e2e: 23 cenários, 0 falhas.
- Mutações (feitas e revertidas): migração de projeto desligada → 3 testes falham; escape de `<` no HTML compartilhado removido → e2e falha (a página quebra).
- CI do GitHub (consulta à API pública): as 8 execuções mais recentes da branch, de `fa60133` a `b3211f8`, terminaram em **success** (lint, tipos, testes e build; o CI não roda e2e nem constrói o instalador).
- `main.ts` 799 linhas (teto 800); nenhum arquivo novo acima de 400; nenhuma dependência adicionada.

## Limites
- Modelos de PDF e seção territorial sem cenário e2e de clique/PDF gerado (só lógica pura).
- Imagem do mapa (exportação cartográfica em imagem): não implementada.
- Instalador, Electron e atualização real: ver relatório final.
