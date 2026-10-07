import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseKmlOrKmz } from '../src/parsing/index.js';

/** KML no estilo do Google My Maps usado pela equipe (dados FICTÍCIOS). */
const data = (o: Record<string, string>) => `<ExtendedData>${Object.entries(o).map(([k, v]) => `<Data name="${k}"><value>${v}</value></Data>`).join('')}</ExtendedData>`;
const point = (lng: number, lat: number) => `<Point><coordinates>\n ${lng},${lat},0\n </coordinates></Point>`;
const square = (lng: number, lat: number, d = 0.01) =>
  `<Polygon><outerBoundaryIs><LinearRing><coordinates>${lng - d},${lat - d},0 ${lng + d},${lat - d},0 ${lng + d},${lat + d},0 ${lng - d},${lat + d},0 ${lng - d},${lat - d},0</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
const coleta = (name: string, o: Record<string, string>, lng: number, lat: number) =>
  `<Placemark><name>${name}</name>${data({ Nome: 'Triatominio ', 'Nº da Etiqueta': '48.0', ...o })}${point(lng, lat)}</Placemark>`;

const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>MAPA FICTÍCIO</name>
<Folder><name>Localidades do município</name>
  <Placemark><name>Vila Alfa cod 0001 Inicio</name>${data({ 'Quantidade de Imoveis': '19', 'COD DA LOCALIDADE': '0001' })}${point(-40.9, -4.4)}</Placemark>
  <Placemark><name>Vila Alfa cod 0001 Final</name>${data({ 'Quantidade de Imoveis': '', 'COD DA LOCALIDADE': '' })}${point(-40.91, -4.41)}</Placemark>
  <Placemark><name>Sítio Beta 00002 Início/Final</name>${point(-40.8, -4.3)}</Placemark>
  <Placemark><name>Luminosa R1 31/05 Fiocruz</name>${point(-40.85, -4.35)}</Placemark>
</Folder>
<Folder><name>Coleta</name>
  ${coleta('Brasiliensis', { Localidade: 'Vila Alfa', 'Numero da Residencia': '12', 'Data de Captura': '30/06/2026', 'Campanha_Captura ou PIT': 'Pit', 'INTRA ou PERI': 'Intra', 'Ninfa_Macho ou Femea': 'Femea', 'Resultado do Exame a Fresco': 'Positivo', 'Data do exame': '26/05/2026' }, -40.9001, -4.4001)}
  ${coleta('P. Lutzi', { Localidade: 'SITIO BETA', 'Numero da Residencia': '7', 'Data de Captura': '27/07/26', 'Campanha_Captura ou PIT': 'Captura', 'INTRA ou PERI': 'Peri', 'Ninfa_Macho ou Femea': 'Ninfa', 'Resultado do Exame a Fresco': 'Negaivo', 'Data do exame': '' }, -40.8, -4.3)}
  ${coleta('Rodnius', { Localidade: 'Sede', 'Numero da Residencia': '', 'Data de Captura': '', 'Campanha_Captura ou PIT': 'Pit Atendimento', 'INTRA ou PERI': 'Intra e Peri', 'Ninfa_Macho ou Femea': 'Macho e Femea', 'Resultado do Exame a Fresco': '', 'Data do exame': '' }, -40.7, -4.2)}
</Folder>
<Folder><name>Area das Localidades</name>
  <Placemark><name>Vila Alfa</name>${square(-40.9, -4.4)}</Placemark>
  <Placemark><name>Sítio Beta</name>${square(-40.8, -4.3)}</Placemark>
  <Placemark><name>Croatá(Sede)</name>${square(-40.7, -4.2)}</Placemark>
</Folder>
<Folder><name>Positivos</name>
  <Placemark><name>Triatominio </name>${data({ 'descrição': 'blob\nLocalidade: Vila Alfa', Localidade: 'Vila Alfa', 'Numero da Residencia': '12', 'Data de Captura': '', 'Campanha_Captura ou PIT': 'PIT', 'INTRA ou PERI': 'INTRA', 'Ninfa_Macho ou Femea': 'Femea', 'Resultado do Exame a Fresco': 'Positivo', 'Data do exame': '26/05/26' })}${point(-40.90010, -4.40010)}</Placemark>
</Folder>
<Folder><name>pits</name>
  <Placemark><name>PIT 01 SEDE</name>${data({ 'Nome do PIT': 'SETOR', 'Endereço Completo': 'Rua Fictícia 1', CEP: '00000000', Latitude: '-4.2', Longitude: '-40.7' })}${point(-40.7, -4.2)}</Placemark>
</Folder>
</Document></kml>`;

describe('arquivo no formato do Google My Maps da campanha', () => {
  const { features, report } = parseKmlOrKmz(strToU8(kml));
  const caps = features.filter((f) => f.type === 'captura');

  it('classifica pastas Coleta/Resultados/Positivos como capturas e Localidades/Área como localidades', () => {
    expect(report.counts.byType).toMatchObject({ captura: 4, pit: 1, localidade: 6, outro: 1 });
    expect(features.find((f) => f.name.startsWith('Luminosa'))!.type).toBe('outro');
  });
  it('limpa nomes "cod 0001 Início/Final" e une os pontos às localidades dos polígonos', () => {
    const names = report.localities.map((l) => l.name).sort();
    expect(names).toEqual(['Croatá(Sede)', 'Sítio Beta', 'Vila Alfa']);
    expect(features.filter((f) => f.type === 'localidade' && f.geometry?.type === 'Point').every((f) => !!f.localityKey)).toBe(true);
  });
  it('lê os campos da campanha e separa fase e sexo', () => {
    const a = caps[0]!;
    expect(a).toMatchObject({ visitDate: '2026-06-30', examDate: '2026-05-26', examResult: 'positivo', channel: 'pit', environment: 'intra', stage: 'Adulto', sex: 'Fêmea', propertyRef: '12', species: 'Triatoma brasiliensis', localityRaw: 'Vila Alfa' });
    const b = caps[1]!;
    expect(b).toMatchObject({ visitDate: '2026-07-27', examResult: 'negativo', channel: 'captura', environment: 'peri', stage: 'Ninfa', sex: null, species: 'Panstrongylus lutzi' });
    expect(report.issues.some((i) => i.code === 'resultado_exame_corrigido')).toBe(true);
    expect(report.issues.some((i) => i.code === 'exame_antes_da_captura')).toBe(true);
  });
  it('não trata exame vazio como negativo e mantém "Nome" (espécie genérica) sem descartar', () => {
    const c = caps[2]!;
    expect(c.examResult).toBe('nao_informado');
    expect(c).toMatchObject({ channel: 'pit', environment: 'intra_peri', sex: 'Macho e Fêmea' });
    expect(report.droppedPersonalFields).toEqual([]);
  });
  it('associa grafias diferentes à localidade conhecida e registra a correção', () => {
    expect(caps[1]!.localityRaw).toBe('Sítio Beta'); // "SITIO BETA"
    expect(caps[2]!.localityRaw).toBe('Croatá(Sede)'); // "Sede"
    expect(report.issues.some((i) => i.code === 'localidade_corrigida')).toBe(true);
    expect(caps[1]!.raw.originalValues['Localidade']).toBe('SITIO BETA'); // original preservado
  });
  it('detecta cópia entre pastas (Positivos) mesmo sem data/etiqueta, sem confundir com registro distinto', () => {
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]).toMatchObject({ crossFolder: true });
    const dup = caps.filter((f) => f.duplicateOf !== null);
    expect(dup).toHaveLength(1);
    expect(dup[0]!.folderPath).toEqual(['Positivos']);
  });
  it('mantém o endereço do PIT como dado restrito, sem enviá-lo para os campos comuns', () => {
    const pit = features.find((f) => f.type === 'pit')!;
    expect(pit.address).toBe('Rua Fictícia 1');
    expect(pit.localityKey).toBeTruthy(); // por posição, dentro do polígono
  });
  it('permite unificar localidades por alias do usuário', () => {
    const k = kml.replace('SITIO BETA', 'Beta do Norte');
    const r = parseKmlOrKmz(strToU8(k), { localityAliases: { 'Beta do Norte': 'Sítio Beta' } });
    expect(r.features.filter((f) => f.type === 'captura')[1]!.localityRaw).toBe('Sítio Beta');
    const r2 = parseKmlOrKmz(strToU8(k));
    expect(r2.report.unmatchedLocalities).toContain('Beta do Norte');
  });
});
