import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import { can, requirePermission, requireUser } from '../auth.js';
import type { Db } from '../db.js';
import { getAllRecordsForExport } from '../services/queries.js';
import { analytics } from '../../../web/src/static/analytics.js';
import type { SnapshotRec } from '../../../web/src/static/engine.js';
import { getRecForAnalytics } from '../services/queries.js';
import { buildKml } from '../services/kml-export.js';
import { getChart, getFacets, getLocalities, getMapFeatures, getRecords, getSummary, parseFilters } from '../services/queries.js';
import { getActiveImport } from '../services/importer.js';

const ENV: Record<string, string> = { intra: 'Intradomicílio', peri: 'Peridomicílio', intra_peri: 'Intra e peridomicílio' };
const LABEL: Record<string, string> = {
  com_captura: 'Com captura', sem_captura: 'Sem captura', nao_informado: 'Não informado', positivo: 'Positivo', negativo: 'Negativo', pendente: 'Pendente', nao_realizado: 'Não realizado',
  visita: 'Visita', captura: 'Captura', pit: 'PIT', arquivo: 'Arquivo KML/KMZ', manual: 'Registro manual',
};

/** Escapa CSV e neutraliza injeção de fórmula em planilhas. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function registerDataRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/summary', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return getSummary(db, parseFilters(req.query as Record<string, unknown>));
  });

  app.get('/api/chart', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const q = req.query as Record<string, unknown>;
    return getChart(db, parseFilters(q), q.mode === 'exame' ? 'exame' : 'busca', q.sort === 'total' ? 'total' : 'nome', q.hideEmpty === 'true');
  });

  app.get('/api/analytics', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return analytics(getRecForAnalytics(db) as unknown as SnapshotRec[], parseFilters(req.query as Record<string, unknown>));
  });

  app.get('/api/facets', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return getFacets(db);
  });

  app.get('/api/localities', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return getLocalities(db, parseFilters(req.query as Record<string, unknown>));
  });

  app.get('/api/map', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return getMapFeatures(db, parseFilters(req.query as Record<string, unknown>));
  });

  app.get('/api/records', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const q = req.query as Record<string, unknown>;
    const pageSize = Math.min(Math.max(Number(q.pageSize) || 25, 1), 100);
    return getRecords(db, parseFilters(q), {
      page: Math.max(Number(q.page) || 1, 1),
      pageSize,
      sort: typeof q.sort === 'string' ? q.sort : undefined,
      dir: typeof q.dir === 'string' ? q.dir : undefined,
      includeAddress: q.includeAddress === 'true' && can(user, 'restrito'),
    });
  });

  app.get('/api/export/records.csv', async (req, reply) => {
    const user = requirePermission(req, reply, 'exportar');
    if (!user) return;
    const q = req.query as Record<string, unknown>;
    const includeAddress = q.includeAddress === 'true' && can(user, 'restrito');
    const filters = parseFilters(q);
    const active = getActiveImport(db);
    const rows = getAllRecordsForExport(db, filters, includeAddress);
    const head = ['origem', 'arquivo_origem', 'versao', 'data_do_arquivo', 'tipo', 'nome', 'localidade', 'data_visita', 'data_exame', 'resultado_busca', 'resultado_exame', 'quantidade', 'fase', 'sexo', 'especie', 'origem_captura', 'ambiente', 'imovel', 'pit', 'latitude', 'longitude', 'possivel_duplicata'];
    if (includeAddress) head.push('endereco');
    const lines = [head.join(';')];
    for (const r of rows) {
      const isFile = r.origin === 'arquivo';
      const cells = [
        LABEL[String(r.origin)], isFile ? active?.filename : 'registro manual', isFile ? active?.version : '', isFile ? active?.activated_at?.slice(0, 10) : '',
        LABEL[String(r.type)] ?? r.type, r.name, r.locality_raw, r.visit_date, r.exam_date,
        r.type === 'captura' || r.type === 'visita' ? LABEL[String(r.search_result)] : '',
        r.type === 'captura' ? LABEL[String(r.exam_result)] : '',
        r.triatomine_count, r.stage, r.sex, r.species, r.channel === 'pit' ? 'PIT' : r.channel === 'captura' ? 'Captura em campanha' : '', ENV[String(r.environment)] ?? '', r.property_ref, r.pit_ref, r.lat, r.lng, r.duplicate_of != null ? 'sim' : '',
      ];
      if (includeAddress) cells.push(r.address);
      lines.push(cells.map(csvCell).join(';'));
    }
    audit(db, user, 'exportacao_registros', undefined, { filters, linhas: rows.length, includeAddress });
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="registros.csv"').send('﻿' + lines.join('\r\n') + '\r\n');
  });

  app.get('/api/export/records.kml', async (req, reply) => {
    const user = requirePermission(req, reply, 'exportar');
    if (!user) return;
    const filters = parseFilters(req.query as Record<string, unknown>);
    const active = getActiveImport(db);
    const rows = getAllRecordsForExport(db, { ...filters, layers: filters.layers?.length ? filters.layers : ['captura', 'visita', 'pit'] }, false);
    const areas = (getMapFeatures(db, { layers: ['localidade'] }).features as unknown as { geometry: { type: string; coordinates: unknown }; properties: { name: string | null; locality_raw: string | null } }[])
      .filter((f) => f.geometry.type === 'Polygon')
      .map((f) => ({ name: f.properties.name ?? f.properties.locality_raw ?? '', rings: f.geometry.coordinates as [number, number][][] }));
    const kml = buildKml(rows as never, areas, { title: 'Vigilância de triatomíneos – Croatá/CE', source: active?.filename ?? 'registros manuais', generatedAt: new Date().toISOString() });
    audit(db, user, 'exportacao_kml', undefined, { filters, registros: rows.length });
    return reply.header('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8').header('Content-Disposition', 'attachment; filename="registros.kml"').send(kml);
  });

  app.get('/api/export/summary.csv', async (req, reply) => {
    const user = requirePermission(req, reply, 'exportar');
    if (!user) return;
    const filters = parseFilters(req.query as Record<string, unknown>);
    const s = getSummary(db, filters);
    const lines = ['indicador;valor;situacao;unidade;observacao'];
    for (const [k, v] of Object.entries(s.kpis)) lines.push([k, v.value ?? '', v.status, v.unit, v.note].map(csvCell).join(';'));
    lines.push(['arquivo_origem', s.versao?.arquivo ?? '', '', '', `versão ${s.versao?.numero ?? '-'} ativada em ${s.versao?.ativadoEm ?? '-'}`].map(csvCell).join(';'));
    audit(db, user, 'exportacao_resumo', undefined, filters);
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="resumo.csv"').send('﻿' + lines.join('\r\n') + '\r\n');
  });
}
