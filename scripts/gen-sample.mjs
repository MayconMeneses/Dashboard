// Gera samples/exemplo-ficticio.kml — DADOS 100% FICTÍCIOS, só para testar o painel.
import { writeFileSync } from 'node:fs';
const locs = [
  ['Sítio Boa Vista', -4.385, -40.915],
  ['Lagoa do Mato', -4.41, -40.89],
  ['Riacho Fundo', -4.43, -40.93],
  ['Serrote Alto', -4.37, -40.87],
  ['Passagem Funda', -4.45, -40.9],
  ['Cacimba Nova', -4.4, -40.95],
];
const species = ['Triatoma brasiliensis', 'Triatoma pseudomaculata', 'Panstrongylus lutzi'];
const exams = ['Positivo', 'Negativo', 'Negativo', 'Pendente', 'Não realizado', ''];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ext = (o) => `<ExtendedData>${Object.entries(o).map(([k, v]) => `<Data name="${k}"><value>${esc(v)}</value></Data>`).join('')}</ExtendedData>`;
const sq = (lat, lng, d = 0.012) => `${lng - d},${lat - d},0 ${lng + d},${lat - d},0 ${lng + d},${lat + d},0 ${lng - d},${lat + d},0 ${lng - d},${lat - d},0`;
let out = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Exemplo FICTÍCIO – Croatá</name>\n`;
out += `<Folder><name>Limite</name><Placemark><name>Limite do município (exemplo fictício)</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${sq(-4.41, -40.91, 0.07)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder>\n`;
out += `<Folder><name>Localidades</name>${locs.map(([n, la, ln]) => `<Placemark><name>${n}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${sq(la, ln)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`).join('')}</Folder>\n`;
let n = 1;
out += `<Folder><name>Capturas</name>`;
for (const [name, la, ln] of locs) {
  const k = 2 + Math.floor(rnd() * 5);
  for (let i = 0; i < k; i++) {
    const d = `${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}/0${3 + Math.floor(rnd() * 5)}/2026`;
    const e = pick(exams);
    const f = { ID: `C${String(n).padStart(4, '0')}`, Localidade: name, 'Data da captura': d, Espécie: pick(species), Quantidade: 1 + Math.floor(rnd() * 3), Fase: pick(['Adulto', 'Ninfa']), Sexo: pick(['M', 'F']), 'Resultado do exame': e, Imóvel: String(100 + n), Morador: 'NOME FICTÍCIO' };
    out += `<Placemark><name>Captura ${n}</name><description><![CDATA[<table><tr><td>Localidade</td><td>${name}</td></tr><tr><td>Resultado do exame</td><td>${e}</td></tr></table>]]></description>${ext(f)}<Point><coordinates>${(ln + (rnd() - 0.5) * 0.02).toFixed(6)},${(la + (rnd() - 0.5) * 0.02).toFixed(6)},0</coordinates></Point></Placemark>`;
    n++;
  }
}
out += `</Folder>\n<Folder><name>Visitas</name>`;
for (const [name, la, ln] of locs.slice(0, 4)) {
  out += `<Placemark><name>Visita ${name}</name>${ext({ Localidade: name, Data: '10/04/2026', 'Resultado da busca': 'Sem captura', Imóvel: String(900 + n++) })}<Point><coordinates>${ln + 0.004},${la + 0.004},0</coordinates></Point></Placemark>`;
}
out += `</Folder>\n<Folder><name>PITs</name>`;
for (const [name, la, ln] of locs.slice(0, 3)) out += `<Placemark><name>PIT ${name}</name>${ext({ Localidade: name, PIT: `PIT-${name.slice(0, 3).toUpperCase()}` })}<Point><coordinates>${ln - 0.004},${la - 0.004},0</coordinates></Point></Placemark>`;
out += `</Folder>\n<Folder><name>Rotas</name><Placemark><name>Rota de busca 1</name><LineString><coordinates>${locs.slice(0, 3).map(([, la, ln]) => `${ln},${la},0`).join(' ')}</coordinates></LineString></Placemark></Folder>\n</Document></kml>\n`;
writeFileSync(new URL('../samples/exemplo-ficticio.kml', import.meta.url), out);
console.log('ok', n - 1, 'capturas');
