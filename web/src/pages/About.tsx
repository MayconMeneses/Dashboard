import { formatDateTime } from '../lib/format';
import type { Snapshot } from '../static/engine';

const TYPE_LABEL: Record<string, string> = { localidade: 'Localidades (pontos e áreas)', captura: 'Registros de captura', pit: 'PITs', visita: 'Visitas', area: 'Áreas', rota: 'Rotas', outro: 'Pontos de referência / outros' };

const FIELD_USE: [string, string][] = [
  ['Pasta/nome da localidade, Localidade', 'Agrupa os registros por localidade (gráficos de localidade, mapas e tabela).'],
  ['Area das Localidades (polígonos)', 'Áreas desenhadas nos mapas; nome ao passar o mouse; cores pela positividade.'],
  ['Data de Captura', 'Linha do tempo, filtro de período e tempo até o resultado.'],
  ['Data do exame', 'Tempo entre a captura e o resultado do exame.'],
  ['Resultado do Exame a Fresco', 'Positivo/negativo/pendente em todos os gráficos, indicadores e cores. Em branco = “não informado”.'],
  ['Nome do registro (espécie)', 'Espécie do triatomíneo (gráficos de espécie, positividade e mapa de calor).'],
  ['Ninfa_Macho ou Femea', 'Gráfico de fase e sexo.'],
  ['INTRA ou PERI', 'Gráfico de ambiente, filtro e mapa de calor espécie × ambiente.'],
  ['Campanha_Captura ou PIT', 'Origem da captura (campanha × PIT): gráfico, filtro e tabela.'],
  ['Quantidade de Imoveis', 'Indicador de imóveis e gráfico de capturas por 100 imóveis.'],
  ['Pasta pits: Nome do PIT, Zona', 'Lista de PITs (unidade e zona).'],
  ['Endereço, Numero da Residencia, Nº da Etiqueta', 'Não aparecem neste painel (dado restrito); a etiqueta e o imóvel só servem para detectar cópias.'],
  ['Resultado da busca (com/sem captura), Quantidade de triatomíneos', 'Não constam no arquivo atual; os indicadores correspondentes aparecem como “Sem dado”.'],
];

export function AboutPage({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) return <div className="notice erro">Este arquivo não contém dados.</div>;
  const s = snapshot.sobre;
  return (
    <div className="stack">
      <section className="card stack">
        <h2>Sobre estes dados</h2>
        <p style={{ margin: 0 }}>
          Painel gerado a partir do arquivo <strong>{snapshot.arquivo}</strong> em {formatDateTime(snapshot.geradoEm)}. É uma fotografia dos dados desse arquivo: não se atualiza sozinho nem permite alterações.
          Ferramenta de apoio à análise; não substitui os formulários nem os procedimentos oficiais da vigilância.
        </p>
        <div className="table-wrap">
          <table>
            <tbody>
              {Object.entries(snapshot.byType).filter(([, v]) => v > 0).map(([k, v]) => (
                <tr key={k}><th>{TYPE_LABEL[k] ?? k}</th><td>{v}</td></tr>
              ))}
              <tr><th>Registros lidos no arquivo</th><td>{s.registrosLidos}</td></tr>
              <tr><th>Cópias excluídas dos números</th><td>{s.duplicatasExcluidas}</td></tr>
            </tbody>
          </table>
        </div>
        {s.duplicatasExcluidas > 0 && (
          <div className="notice info">
            {s.duplicatasExcluidas} registro(s) idêntico(s) a outros (cópias em pastas como Resultados, Positivos e Negativos) foram excluídos para não contar o mesmo triatomíneo duas vezes. Os registros originais continuam no arquivo de origem.
          </div>
        )}
      </section>

      <section className="card stack">
        <h3>Como ler os números</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Resultado da busca</strong> e <strong>resultado do exame</strong> são medidas diferentes e nunca são somadas.</li>
          <li>“Sem dado” significa que o arquivo não traz a informação. <strong>Não é zero.</strong> Exame em branco é “não informado”, nunca “negativo”.</li>
          <li>O sistema não conclui que uma busca foi negativa só porque não há ponto no mapa.</li>
          <li>Nomes de localidade escritos de formas diferentes foram associados à localidade mais provável quando havia correspondência clara.</li>
        </ul>
      </section>

      <section className="card stack">
        <h3>Privacidade</h3>
        <p className="small" style={{ margin: 0 }}>Não constam neste painel: {s.camposRestritosRemovidos.join('; ')}.{s.camposDescartados.length ? ` Campos descartados por possível dado pessoal: ${s.camposDescartados.join(', ')}.` : ''} As coordenadas dos pontos aparecem arredondadas (cerca de 1 metro).</p>
      </section>

      <section className="card">
        <h3>Campos do arquivo e onde são usados</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Campo do KML</th><th>Como é usado no painel</th></tr></thead>
            <tbody>
              {FIELD_USE.map(([c, u]) => <tr key={c}><td style={{ whiteSpace: 'normal' }}>{c}</td><td style={{ whiteSpace: 'normal' }}>{u}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      {s.avisos.length > 0 && (
        <section className="card">
          <h3>Avisos da leitura do arquivo</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Aviso</th><th>Qtd</th></tr></thead>
              <tbody>{s.avisos.map((a) => <tr key={a.codigo}><td style={{ whiteSpace: 'normal' }}>{a.mensagem}</td><td>{a.quantidade}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
