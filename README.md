# Dashboard da campanha de captura de triatomíneos – Croatá/CE

Painel web que lê arquivos **KML/KMZ** da campanha e mostra, por localidade, o **resultado da busca** (com captura / sem captura) e o **resultado do exame** dos triatomíneos (positivo / negativo / pendente / não realizado), com mapa e tabela de registros. Um arquivo novo pode ser importado a qualquer momento: nada é substituído sem prévia e confirmação, e as versões anteriores ficam guardadas.

> Ferramenta de apoio à análise. Não substitui os formulários nem os procedimentos oficiais da vigilância. O repositório contém só **dados fictícios** de exemplo (`samples/exemplo-ficticio.kml`).

## Como executar

Requisitos: Node.js 22+.

```bash
npm install
npm run build                       # gera web/dist
ADMIN_USER=admin ADMIN_PASSWORD='uma-senha-forte-123' npm start   # cria o 1º administrador (só se não houver usuários)
# abra http://127.0.0.1:3000
```

Desenvolvimento: `npm run dev:server` e, em outro terminal, `npm run dev:web` (Vite em :5173, com proxy para :3000).

Outros usuários: `npm run user:create -- <usuario> <senha(>=10)> <admin|analista|leitor>`.

| Variável | Padrão | Função |
|---|---|---|
| `PORT`, `HOST` | `3000`, `127.0.0.1` | Endereço do servidor. Para expor na rede, use HTTPS (proxy reverso) e `COOKIE_SECURE=true`. |
| `DATA_DIR` | `./data` | Banco SQLite e originais enviados (**faça backup desta pasta**). |
| `MAX_UPLOAD_MB` | `25` | Limite de tamanho do arquivo. |
| `TILE_URL` | OpenStreetMap | Mapa-base. `TILE_URL=` (vazio) desativa e não faz nenhuma requisição a terceiros. |
| `COOKIE_SECURE` | `false` | Marque `true` atrás de HTTPS. |
| `SESSION_HOURS` | `12` | Duração da sessão. |
| `CARTO_API_KEY` | — | Chave dos mapas-base CARTO (https://carto.com/basemaps/apikey). Sem ela os mapas CARTO mostram marca d'água; com ela o padrão passa a ser o “Voyager”. **Nunca grave a chave no código/repositório.** |
| `BOUNDARY_FILE`, `BOUNDARY_SOURCE` | — | GeoJSON do limite municipal oficial (ex.: malha municipal do IBGE de Croatá) e o texto da fonte exibido no mapa. |

## Painel compartilhável (um único arquivo HTML)

Gera um arquivo `.html` com **tudo embutido** (painel, gráficos, mapas, tabela e os dados do KML/KMZ). Quem recebe só precisa abri-lo no navegador (duplo clique): não instala nada, não tem login e não precisa de servidor. É uma fotografia somente leitura dos dados daquele arquivo; para atualizar, gere de novo com o KML novo.

```powershell
npm install
npm run build:static          # uma vez (gera o modelo web/dist-static/index.html)
npm run gerar-html -- "C:\caminho\MAPA DE CROATÁ.kml" painel-croata.html --nome="MAPA DE CROATÁ.kml"
```
Chave de mapas: `--carto-key=SUACHAVE` (ou a variável `CARTO_API_KEY`). **Atenção:** a chave fica gravada dentro do HTML e quem receber o arquivo pode vê-la; restrinja/revogue no painel da CARTO se preciso.
Opções: `--excluir-duplicatas` / `--manter-duplicatas` (padrão: exclui só quando todas as cópias estão em outras pastas, como Resultados/Positivos/Negativos).

- Os números são os mesmos do painel com servidor (há testes de paridade entre os dois).
- **Privacidade:** o arquivo gerado **não leva** endereço, número do imóvel/residência, nº da etiqueta nem os valores brutos do KML; as coordenadas são arredondadas (~1 m). Mesmo assim contém as posições de capturas e PITs: compartilhe só com quem pode ver esses dados.
- O mapa-base precisa de internet; sem ela, áreas e limite continuam aparecendo. O OpenStreetMap padrão é bloqueado pelo provedor quando a página é um arquivo local (erro 403); a CARTO exige chave (sem ela mostra marca d'água).
- A aba **Sobre os dados** explica o arquivo de origem, o que foi excluído e como ler os números.

## Perfis

| Perfil | Pode |
|---|---|
| `leitor` | Ver painel, mapa e tabelas. Não vê endereço, não exporta, não importa. |
| `analista` | Tudo do leitor + importar/ativar/restaurar versões, registrar visitas manuais, exportar CSV, ver endereço. |
| `admin` | Tudo + auditoria (`/api/audit`) e download do arquivo original. |

## Importar um arquivo atualizado

1. **Atualizar dados** → arraste o `.kml`/`.kmz` (limite configurável; no Google Earth/My Maps use *Exportar como KML/KMZ*).
2. Revise a **prévia**: totais, avisos e erros (sem coordenadas, data inválida, coordenada fora da área, localidade não reconhecida, possíveis duplicatas, localidades com nomes parecidos…). Se algo foi reconhecido errado, use **Mapear pastas e campos** e reprocesse.
3. **Ativar esta versão** (com confirmação). A versão anterior fica arquivada e pode ser **restaurada**. Se a importação falhar, os dados ativos não mudam.

O original é guardado em `DATA_DIR/uploads` (nome gerado pelo servidor, SHA-256 registrado) e há um relatório de importação em texto para cada versão.

### O que o leitor de KML entende

Não depende de nomes ou ordem fixa de pastas/tags. Lê `ExtendedData` (`Data/value`, `SchemaData/SimpleData`) e descrições HTML/CDATA (tabelas ou linhas `Campo: valor`); quando a informação aparece nos dois lugares, vale a estruturada. Reconhece, ignorando acentos e caixa, campos como: localidade/comunidade, data da captura/visita, data do exame, resultado da busca, resultado do exame, quantidade, fase, sexo, espécie, imóvel, PIT, endereço, id. Os tipos de registro vêm do nome da pasta (captura, visita, PIT, localidade, rota, área), da geometria (polígono → área/localidade, linha → rota) ou dos campos presentes. O que não for reconhecido pode ser mapeado manualmente na prévia.

#### Formato do arquivo “MAPA DE CROATÁ” (Google My Maps)

O leitor foi ajustado ao arquivo real da campanha:

- **Pasta “Localidades do município de Croatá”:** pontos “Nome cod 0001 Início/Final”. O código e o marcador são removidos e os dois pontos viram a mesma localidade. Pontos que não seguem o padrão (ex.: “Luminosa R1 … Fiocruz”, “SETOR DE ENDEMIAS”) ficam como **pontos de referência**, não como localidade.
- **“Area das Localidades”:** polígonos; são a lista de referência de localidades. Nomes de pontos e de registros são associados a elas (exata, semelhante por erro de digitação, ou parcial — ex.: “Sede” → “Croatá(Sede)”) e cada correção aparece na prévia; o valor original continua no registro. O que não casar (ex.: “Barra do Sotero”, “Aningas”) é listado para você **unificar** manualmente.
- **“Coleta”:** cada ponto é um registro de captura. Campos lidos: Localidade, Data de Captura, Nº da Etiqueta, Numero da Residencia, “Campanha_Captura ou PIT” (origem: captura em campanha × PIT), “INTRA ou PERI” (ambiente), “Ninfa_Macho ou Femea” (separado em fase e sexo), “Resultado do Exame a Fresco” e Data do exame. A espécie é deduzida do nome do registro (“Brasiliensis”, “P. Lutzi”…), com aviso.
- **“Resultados”, “Positivos”, “Negativos”:** são cópias dos registros em outras pastas. O painel as detecta como **possíveis duplicatas** (mesma localidade, imóvel, posição e atributos, ignorando campos vazios) e, nesse caso, já sugere excluir as cópias — decisão que fica com você na ativação. Dois registros no mesmo imóvel com datas diferentes **não** são tratados como cópia.
- **“pits”:** locais de PIT; o endereço é dado restrito.
- Exame em branco = “não informado”; erros de digitação óbvios (“Negaivo”) são corrigidos com aviso; datas com ano de 2 dígitos (27/07/26) são aceitas; exame anterior à captura gera aviso.
- Este arquivo não traz resultado de busca nem quantidade de triatomíneos, nem limite municipal: esses indicadores aparecem como “Sem dado”.

Campos com possíveis dados pessoais (morador, proprietário, telefone, CPF…) são **descartados** na importação (o arquivo original os preserva).

## Mapas

- **Mapa-base:** o seletor “Mapa-base” oferece, quando há `CARTO_API_KEY`, Ruas e relevo (CARTO Voyager, padrão) e Claro (CARTO Positron); além disso Satélite (Esri), OpenStreetMap padrão e “Sem mapa-base”. Sem chave da CARTO, o padrão é Satélite em arquivo local ou OpenStreetMap quando servido por http(s). Só o escolhido é carregado; o provedor recebe a região que está sendo vista. No servidor, `TILE_URL=` (vazio) desliga todos.
- **Filtro de espécie:** lista as espécies encontradas (com contagem) e filtra indicadores, gráfico, mapa e tabela. As áreas das localidades continuam desenhadas quando há filtros de registros.

- **Onde fica Croatá:** três mapas — Brasil (Ceará em destaque), Ceará (posição de Croatá) e Croatá com o limite do IBGE e as **áreas das localidades desenhadas por você no KML** (pasta “Area das Localidades”). Passe o mouse sobre uma área para ver o nome e as contagens (capturas, positivos, negativos); clique para selecionar a localidade (o gráfico, o mapa e a tabela acompanham). As cores seguem os filtros: vermelho = com exame positivo, azul = só negativos/sem resultado, cinza = sem capturas.
- Brasil e Ceará são mapas **esquemáticos** (© @svg-maps/brazil, CC BY 4.0); a posição de Croatá no mapa do Ceará é aproximada. O mapa de Croatá usa dados reais (limite do IBGE + suas áreas).
- **Localidades do município:** mapa só com as áreas da pasta “Area das Localidades” do KML. Ao passar o mouse aparece apenas o nome da localidade (sem dados de triatomíneos); tem zoom, seletor de mapa-base e lista de nomes.
- **Mapa interativo** (Leaflet): as mesmas áreas, com zoom, nome ao passar o mouse e camadas de capturas, PITs, visitas e pontos de referência.

## Regras de significado dos dados

- **Busca** e **exame** são medidas separadas e nunca são somadas. Unidades: o gráfico da busca conta *registros* (capturas e visitas); o do exame conta *registros de captura*. A soma de triatomíneos usa só registros com quantidade informada.
- Um registro do tipo **captura** conta como “com captura”. **“Sem captura” só existe** quando o arquivo informa explicitamente ou quando alguém registra uma **visita manual**. Ausência de ponto nunca vira negativo.
- Indicador sem base nos dados aparece como **“Sem dado”** (não é zero). Zero só é exibido quando o arquivo traz o campo correspondente.
- Exame vazio = “não informado”, nunca “negativo”.

## Segurança e privacidade (o que existe de fato)

- Login com senha (scrypt), sessão em cookie `HttpOnly` + `SameSite=Strict`, cabeçalho anti-CSRF nas ações que alteram dados, bloqueio temporário após 5 tentativas erradas, cabeçalhos de segurança e CSP.
- Upload: extensão, conteúdo (magia do ZIP/XML) e tamanho validados no servidor; KMZ com limites de entradas, tamanho descompactado e razão de compressão, sem caminhos `..`/absolutos nem executáveis; XML com `DOCTYPE`/`ENTITY` é recusado (sem XXE).
- Endereço só para analista/admin e fora do CSV por padrão; CSV neutraliza injeção de fórmula.
- Auditoria de login, importação, ativação/restauração, exportações e registros manuais.
- Nenhum envio de dados a serviços de geocodificação, analytics ou IA. A única chamada externa possível é o **mapa-base** (tiles do OpenStreetMap, que veem a região visualizada); desative com `TILE_URL=`.
- **Backup:** não há backup automático. Copie a pasta `DATA_DIR` com a rotina da sua instituição.

## Limitações atuais

- Sem arquivo real da campanha para validar: o reconhecimento de campos é heurístico. Confirme com a equipe quais campos/pastas o sistema de origem exporta e use o mapeamento.
- **Limite municipal:** o arquivo da campanha não traz o limite de Croatá. O projeto inclui `boundary/croata-ibge.geojson`, extraído do **PDF oficial do IBGE** (Mapa Municipal de Croatá-CE, código 2304236, Malha Territorial ed. 04/2021): o traçado dos limites foi lido do vetor do PDF e georreferenciado pelas graduações da moldura. Não é o arquivo oficial em GeoJSON/shapefile: a precisão é aproximada (algumas dezenas de metros). Conferências feitas: área ≈ 699 km², todos os 58 registros de captura e os 12 PITs do arquivo da campanha caem dentro do limite; alguns pontos de localidades na divisa podem ficar logo fora. Para usar a malha oficial em GeoJSON (IBGE, Malhas Territoriais), inicie com `BOUNDARY_FILE=/caminho/croata.geojson BOUNDARY_SOURCE="IBGE – Malha Municipal"`.
- Não há exportação KML/KMZ derivada, tela de gestão de usuários (use o comando acima) nem backup/restauração de banco.
- Visitas manuais não têm edição (só anular).
- `node:sqlite` ainda é marcado como experimental pelo Node 22 (aviso no console).

## Testes e verificações

```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Cobrem parsing KML/KMZ (estruturas variadas, descrição × ExtendedData, arquivos malformados/maliciosos), contagens e filtros, distinção busca × exame, não inferência de negativos, importação inválida sem alterar dados ativos, versões, permissões e exportação.

## Modelo de dados (resumo)

`imports` (uma linha por arquivo/versão: status, hash, mapeamento, relatório) 1—N `features` (registros normalizados: tipo, localidade original/normalizada, geometria, datas, resultado da busca, resultado do exame, quantidade, valores originais em `raw_json`). `manual_visits` é independente do KML. `users`, `sessions`, `audit_log` completam o esquema.
