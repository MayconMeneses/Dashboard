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

Campos com possíveis dados pessoais (morador, proprietário, telefone, CPF…) são **descartados** na importação (o arquivo original os preserva).

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
- **Limite municipal:** não é inventado. Se o arquivo trouxer um polígono de limite (pasta/nome com “limite”, “município”…), ele é desenhado; senão o mapa mostra só os dados. Uma base oficial (ex.: malha do IBGE) pode ser acrescentada se a equipe autorizar.
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
