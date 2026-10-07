import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ImportError, parseKmlOrKmz } from '../src/parsing/index.js';

const sample = readFileSync(new URL('./fixtures/exemplo-ficticio.kml', import.meta.url));

function kml(body: string, header = '<?xml version="1.0" encoding="UTF-8"?>') {
  return strToU8(`${header}<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>T</name>${body}</Document></kml>`);
}
const pt = (name: string, ext: Record<string, string>, coords = '-40.9,-4.4,0', extra = '') =>
  `<Placemark><name>${name}</name>${extra}<ExtendedData>${Object.entries(ext)
    .map(([k, v]) => `<Data name="${k}"><value>${v}</value></Data>`)
    .join('')}</ExtendedData><Point><coordinates>${coords}</coordinates></Point></Placemark>`;

describe('parsing do arquivo de exemplo', () => {
  const { features, report } = parseKmlOrKmz(sample);
  it('reconhece tipos, geometrias e localidades', () => {
    expect(report.counts.byType.localidade).toBe(6);
    expect(report.counts.byType.captura).toBe(20);
    expect(report.counts.byType.visita).toBe(4);
    expect(report.counts.byType.pit).toBe(3);
    expect(report.counts.byType.rota).toBe(1);
    expect(report.counts.byType.area).toBe(1);
    expect(features.filter((f) => f.isBoundary)).toHaveLength(1);
    expect(report.counts.polygons).toBe(7);
    expect(report.counts.lines).toBe(1);
    expect(report.counts.localities).toBe(6);
  });
  it('separa resultado da busca do resultado do exame', () => {
    const cap = features.filter((f) => f.type === 'captura');
    expect(cap.every((f) => f.searchResult === 'com_captura')).toBe(true);
    expect(cap.some((f) => f.examResult === 'positivo')).toBe(true);
    expect(cap.some((f) => f.examResult === 'nao_informado')).toBe(true); // exame vazio ≠ negativo
    const vis = features.filter((f) => f.type === 'visita');
    expect(vis.every((f) => f.searchResult === 'sem_captura' && f.examResult === 'nao_informado')).toBe(true);
  });
  it('descarta dados pessoais e não duplica campos da descrição', () => {
    expect(report.droppedPersonalFields).toContain('Morador');
    const f = features.find((x) => x.type === 'captura')!;
    expect(JSON.stringify(f.raw)).not.toContain('NOME FICTÍCIO');
    expect(Object.keys(f.raw.description)).toEqual([]); // Localidade e Resultado já vinham estruturados
    expect(f.localityRaw).toBeTruthy();
  });
});

describe('regras de domínio', () => {
  it('nunca infere "sem captura" pela ausência de pontos', () => {
    const r = parseKmlOrKmz(kml(`<Folder><name>Localidades</name><Placemark><name>Vila A</name><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark></Folder>`));
    expect(r.features.every((f) => f.searchResult !== 'sem_captura')).toBe(true);
    expect(r.report.seenFields.resultado_busca).toBe(false);
  });
  it('lê descrição quando não há ExtendedData e prioriza o estruturado', () => {
    const desc = `<description><![CDATA[Localidade: Vila B<br/>Resultado do exame: Negativo<br/>Quantidade: 2]]></description>`;
    const r = parseKmlOrKmz(kml(`<Folder><name>Capturas</name><Placemark><name>c</name>${desc}<ExtendedData><Data name="Localidade"><value>Vila X</value></Data></ExtendedData><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark></Folder>`));
    const f = r.features[0]!;
    expect(f.localityRaw).toBe('Vila X');
    expect(f.examResult).toBe('negativo');
    expect(f.triatomineCount).toBe(2);
  });
  it('aceita SimpleData e variações de nomes e valores', () => {
    const body = `<Folder><name>Capturas</name><Placemark><name>c</name><ExtendedData><SchemaData schemaUrl="#s"><SimpleData name="COMUNIDADE">Vila C</SimpleData><SimpleData name="Positividade">POS</SimpleData></SchemaData></ExtendedData><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark></Folder>`;
    const f = parseKmlOrKmz(kml(body)).features[0]!;
    expect(f.localityRaw).toBe('Vila C');
    expect(f.examResult).toBe('positivo');
  });
  it('usa o mapeamento do usuário para campos desconhecidos', () => {
    const body = `<Folder><name>Capturas</name>${pt('c', { Localidade: 'Vila D', 'Situação laboratorial': 'Negativo' })}</Folder>`;
    expect(parseKmlOrKmz(kml(body)).features[0]!.examResult).toBe('nao_informado');
    const mapped = parseKmlOrKmz(kml(body), { fields: { 'Situação laboratorial': 'resultado_exame' } }).features[0]!;
    expect(mapped.examResult).toBe('negativo');
  });
  it('usa o mapeamento de pastas', () => {
    const body = `<Folder><name>Pontos X</name>${pt('c', { Localidade: 'Vila E' })}</Folder>`;
    expect(parseKmlOrKmz(kml(body)).features[0]!.type).toBe('outro');
    expect(parseKmlOrKmz(kml(body), { folders: { 'Pontos X': 'captura' } }).features[0]!.type).toBe('captura');
  });
  it('define localidade por polígono quando o ponto não a informa', () => {
    const body = `<Folder><name>Localidades</name><Placemark><name>Vila F</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-41,-5,0 -40,-5,0 -40,-4,0 -41,-4,0 -41,-5,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder><Folder><name>Capturas</name>${pt('c', {})}</Folder>`;
    const cap = parseKmlOrKmz(kml(body)).features.find((f) => f.type === 'captura')!;
    expect(cap.localityRaw).toBe('Vila F');
  });
  it('marca possíveis duplicatas sem remover registros', () => {
    const body = `<Folder><name>Capturas</name>${pt('a', { ID: '7', Localidade: 'V' })}${pt('b', { ID: '7', Localidade: 'V' })}${pt('c', { ID: '8', Localidade: 'V' })}</Folder>`;
    const r = parseKmlOrKmz(kml(body));
    expect(r.features).toHaveLength(3);
    expect(r.features.filter((f) => f.duplicateOf !== null)).toHaveLength(1);
    expect(r.report.duplicates).toHaveLength(1);
  });
  it('não trava com datas, coordenadas e quantidades inválidas', () => {
    const body = `<Folder><name>Capturas</name>${pt('a', { Localidade: 'V', 'Data da captura': '31/02/2026', Quantidade: 'muitos' }, 'abc,def')}${pt('b', { Localidade: 'V' }, '-4.4,-40.9')}</Folder>`;
    const r = parseKmlOrKmz(kml(body));
    const codes = r.report.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['data_invalida', 'coordenada_invalida', 'quantidade_invalida', 'fora_da_area', 'sem_coordenadas']));
    expect(r.features[0]!.visitDate).toBeNull();
    expect(r.features[0]!.lat).toBeNull();
  });
});

describe('KMZ', () => {
  it('abre KMZ equivalente ao KML', () => {
    const kmz = zipSync({ 'doc.kml': new Uint8Array(sample), 'files/icon.png': new Uint8Array([1, 2, 3]) });
    const a = parseKmlOrKmz(kmz);
    const b = parseKmlOrKmz(sample);
    expect(a.report.counts).toEqual(b.report.counts);
  });
});

describe('arquivos inválidos e maliciosos', () => {
  const fails = (bytes: Uint8Array, code: string, limits?: Parameters<typeof parseKmlOrKmz>[2]) => {
    try {
      parseKmlOrKmz(bytes, {}, limits);
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect((e as ImportError).code).toBe(code);
      return;
    }
    throw new Error('deveria falhar');
  };
  it('vazio, texto e binário', () => {
    fails(new Uint8Array(), 'arquivo_vazio');
    fails(new Uint8Array([0, 1, 2, 3, 4, 5]), 'formato_invalido');
  });
  it('XML malformado ou não-KML', () => {
    fails(strToU8('<kml><Document><Placemark></Document>'), 'xml_invalido');
    fails(strToU8('<?xml version="1.0"?><html><body/></html>'), 'kml_invalido');
  });
  it('rejeita DOCTYPE/ENTITY (XXE, billion laughs)', () => {
    fails(strToU8('<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml><Document><name>&x;</name></Document></kml>'), 'xml_dtd_proibido');
  });
  it('rejeita KMZ com traversal, executável, sem kml, corrompido e ZIP bomb', () => {
    fails(zipSync({ '../evil.kml': new Uint8Array(sample) }), 'kmz_caminho_invalido');
    fails(zipSync({ 'doc.kml': new Uint8Array(sample), 'run.exe': new Uint8Array([1]) }), 'kmz_arquivo_proibido');
    fails(zipSync({ 'a.txt': new Uint8Array([1]) }), 'kmz_sem_kml');
    fails(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9, 9, 9]), 'kmz_invalido');
    const bomb = zipSync({ 'doc.kml': new Uint8Array(3 * 1024 * 1024) });
    fails(bomb, 'kmz_muito_grande', { maxFileBytes: 1e7, maxEntries: 10, maxUncompressedBytes: 1024 * 1024, maxRatio: 200 });
  });
  it('registra erro quando não há placemarks', () => {
    const r = parseKmlOrKmz(kml(''));
    expect(r.report.issues.some((i) => i.severity === 'erro' && i.code === 'sem_registros')).toBe(true);
  });
});

describe('codificação', () => {
  it('aceita KML UTF-8 com BOM', () => {
    const body = new TextEncoder().encode(`\uFEFF<?xml version="1.0" encoding="UTF-8"?><kml><Document><Folder><name>Capturas</name><Placemark><name>c</name><Point><coordinates>-40.9,-4.4</coordinates></Point></Placemark></Folder></Document></kml>`);
    expect(parseKmlOrKmz(body).features).toHaveLength(1);
  });
});
