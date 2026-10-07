// remove caracteres de controle inválidos em XML 1.0
const stripControl = (s: string) => [...s].filter((c) => { const n = c.codePointAt(0)!; return n === 9 || n === 10 || n === 13 || n >= 32; }).join('');
const esc = (s: unknown) =>
  stripControl(String(s ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const br = (iso: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

const EXAM_LABEL: Record<string, string> = { positivo: 'Positivo', negativo: 'Negativo', pendente: 'Pendente', nao_realizado: 'Não realizado', nao_informado: '' };
const ENV_LABEL: Record<string, string> = { intra: 'Intra', peri: 'Peri', intra_peri: 'Intra e Peri' };
// KML usa cores aabbggrr
const STYLE_COLOR: Record<string, string> = { positivo: 'ff2b39c0', negativo: 'ffeb6325', pendente: 'ff0677d9', outro: 'ff80726b' };

interface Row {
  type: string;
  name: string | null;
  locality_raw: string | null;
  visit_date: string | null;
  exam_date: string | null;
  search_result: string;
  exam_result: string;
  species: string | null;
  stage: string | null;
  sex: string | null;
  channel: string | null;
  environment: string | null;
  pit_ref: string | null;
  triatomine_count: number | null;
  lat: number | null;
  lng: number | null;
}
interface Area {
  name: string;
  rings: [number, number][][];
}

function stageSex(r: Row): string {
  const st = (r.stage ?? '').toLowerCase();
  const sx = r.sex ?? '';
  const parts = [st.includes('ninfa') ? 'Ninfa' : '', /macho/i.test(sx) ? 'Macho' : '', /f[eê]mea/i.test(sx) ? 'Fêmea' : ''].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

const data = (o: Record<string, unknown>) =>
  `<ExtendedData>${Object.entries(o).map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>`).join('')}</ExtendedData>`;

/**
 * KML derivado dos dados normalizados (sem endereço, número do imóvel nem dados pessoais).
 * Usa os mesmos nomes de campo do arquivo da campanha, então pode ser reimportado no painel.
 */
export function buildKml(rows: Row[], areas: Area[], meta: { title: string; source: string; generatedAt: string }): string {
  const styles = Object.entries(STYLE_COLOR)
    .map(([k, c]) => `<Style id="e-${k}"><IconStyle><color>${c}</color><scale>1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`)
    .join('');
  const point = (r: Row) => (r.lat != null && r.lng != null ? `<Point><coordinates>${r.lng},${r.lat},0</coordinates></Point>` : '');
  const cap = rows
    .filter((r) => r.type === 'captura' && r.lat != null)
    .map(
      (r) =>
        `<Placemark><name>${esc(r.species ?? r.name ?? 'Triatomíneo')}</name><styleUrl>#e-${r.exam_result === 'positivo' || r.exam_result === 'negativo' || r.exam_result === 'pendente' ? r.exam_result : 'outro'}</styleUrl>${data({
          Localidade: r.locality_raw,
          'Data de Captura': br(r.visit_date),
          'Campanha_Captura ou PIT': r.channel === 'pit' ? 'Pit' : r.channel === 'captura' ? 'Captura' : '',
          'INTRA ou PERI': ENV_LABEL[r.environment ?? ''] ?? '',
          'Ninfa_Macho ou Femea': stageSex(r),
          'Resultado do Exame a Fresco': EXAM_LABEL[r.exam_result] ?? '',
          'Data do exame': br(r.exam_date),
          ...(r.triatomine_count != null ? { Quantidade: r.triatomine_count } : {}),
        })}${point(r)}</Placemark>`,
    )
    .join('');
  const vis = rows
    .filter((r) => r.type === 'visita' && r.lat != null)
    .map(
      (r) =>
        `<Placemark><name>${esc(r.name ?? 'Visita')}</name>${data({
          Localidade: r.locality_raw,
          Data: br(r.visit_date),
          'Resultado da busca': r.search_result === 'sem_captura' ? 'Sem captura' : r.search_result === 'com_captura' ? 'Com captura' : '',
        })}${point(r)}</Placemark>`,
    )
    .join('');
  const pits = rows
    .filter((r) => r.type === 'pit' && r.lat != null)
    .map((r) => `<Placemark><name>${esc(r.name ?? 'PIT')}</name>${data({ 'Nome do PIT': r.pit_ref ?? '', Localidade: r.locality_raw })}${point(r)}</Placemark>`)
    .join('');
  const polys = areas
    .map((a) => {
      const [outer, ...inner] = a.rings;
      if (!outer) return '';
      const ring = (r: [number, number][]) => `<LinearRing><coordinates>${r.map(([x, y]) => `${x},${y},0`).join(' ')}</coordinates></LinearRing>`;
      return `<Placemark><name>${esc(a.name)}</name><Polygon><outerBoundaryIs>${ring(outer)}</outerBoundaryIs>${inner.map((r) => `<innerBoundaryIs>${ring(r)}</innerBoundaryIs>`).join('')}</Polygon></Placemark>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(meta.title)}</name><description>${esc(`Gerado em ${meta.generatedAt} a partir de ${meta.source}. Sem endereço, número do imóvel nem dados pessoais.`)}</description>${styles}<Folder><name>Coleta</name>${cap}</Folder><Folder><name>Visitas</name>${vis}</Folder><Folder><name>pits</name>${pits}</Folder><Folder><name>Area das Localidades</name>${polys}</Folder></Document></kml>\n`;
}
