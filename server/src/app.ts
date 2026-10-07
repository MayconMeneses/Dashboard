import { existsSync, readFileSync, statSync } from 'node:fs';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from './audit.js';
import { COOKIE, can, createSession, destroySession, requirePermission, requireUser, userFromToken, verifyPassword } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { registerDataRoutes } from './routes/data.js';
import { loadContextGeojson } from './geo-context.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerImportRoutes } from './routes/imports.js';
import { registerManualRoutes } from './routes/manual.js';
import { ServiceError } from './services/importer.js';

const loginBody = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) });

export function buildApp(db: Db, cfg: Config): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  void app.register(fastifyCookie);
  void app.register(fastifyMultipart, { limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 5 } });

  // Mapas-base permitidos (só quando TILE_URL não está vazio): OpenStreetMap, CARTO e Esri (satélite).
  const tiles = cfg.tileUrl ? ['https://tile.openstreetmap.org', 'https://basemaps.cartocdn.com', 'https://*.basemaps.cartocdn.com', 'https://server.arcgisonline.com', new URL(cfg.tileUrl.replace('{s}', 'a')).origin].join(' ') : '';
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin'); // o OpenStreetMap exige a origem nas requisições de mapa
    reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' data: blob: ${tiles}; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
  });

  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req, reply) => {
    req.user = userFromToken(db, req.cookies[COOKIE]);
    // Defesa CSRF: cookie SameSite=Strict + cabeçalho personalizado em requisições que alteram dados.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'dashboard') {
      return reply.code(403).send({ error: 'csrf', message: 'Requisição recusada.' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ServiceError) return reply.code(err.status).send({ error: err.code, message: err.message });
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'arquivo_grande', message: `O arquivo excede o limite de ${Math.round(cfg.maxUploadBytes / 1048576)} MB.` });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: 'requisicao_invalida', message: 'Requisição inválida.' });
    console.error(err);
    return reply.code(500).send({ error: 'erro_interno', message: 'Algo deu errado. Tente novamente; se persistir, avise o administrador.' });
  });

  // --- autenticação ---
  const attempts = new Map<string, { n: number; until: number }>();
  app.post('/api/auth/login', async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'dados_invalidos', message: 'Informe usuário e senha.' });
    const key = `${req.ip}|${body.data.username.toLowerCase()}`;
    const a = attempts.get(key);
    if (a && a.n >= 5 && a.until > Date.now()) return reply.code(429).send({ error: 'muitas_tentativas', message: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    const u = db.prepare('SELECT id, username, password_hash, role, active FROM users WHERE username = ?').get(body.data.username.toLowerCase()) as
      | { id: number; username: string; password_hash: string; role: 'admin' | 'analista' | 'leitor'; active: number }
      | undefined;
    const ok = u ? verifyPassword(body.data.password, u.password_hash) && u.active === 1 : (verifyPassword(body.data.password, 'scrypt$00$00'), false);
    if (!ok || !u) {
      attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
      audit(db, null, 'login_falhou', body.data.username.slice(0, 60));
      return reply.code(401).send({ error: 'credenciais_invalidas', message: 'Usuário ou senha incorretos.' });
    }
    attempts.delete(key);
    const { token, expires } = createSession(db, u.id, cfg.sessionHours);
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: cfg.secureCookies, path: '/', expires });
    audit(db, u, 'login');
    return { username: u.username, role: u.role };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = req.cookies[COOKIE];
    if (t) destroySession(db, t);
    if (req.user) audit(db, req.user, 'logout');
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    return {
      username: u.username,
      role: u.role,
      permissions: { importar: can(u, 'importar'), manual: can(u, 'manual'), exportar: can(u, 'exportar'), restrito: can(u, 'restrito'), auditoria: can(u, 'auditoria'), administrar: can(u, 'administrar') },
      map: { tileUrl: cfg.tileUrl, attribution: cfg.tileAttribution, maxUploadMb: Math.round(cfg.maxUploadBytes / 1048576), cartoKey: cfg.cartoKey },
    };
  });

  app.get('/api/boundary', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    if (!cfg.boundaryFile || !existsSync(cfg.boundaryFile) || statSync(cfg.boundaryFile).size > 8 * 1024 * 1024) return { geojson: null, source: null };
    try {
      const g = JSON.parse(readFileSync(cfg.boundaryFile, 'utf8')) as { type?: string };
      const ok = ['FeatureCollection', 'Feature', 'Polygon', 'MultiPolygon'].includes(g.type ?? '');
      return ok ? { geojson: g, source: cfg.boundarySource } : { geojson: null, source: null };
    } catch {
      return { geojson: null, source: null };
    }
  });

  let contextMaps: { brasil: unknown; ceara: unknown } | undefined;
  app.get('/api/context-maps', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    contextMaps ??= { brasil: loadContextGeojson(cfg.brasilGeojson), ceara: loadContextGeojson(cfg.cearaGeojson) };
    return contextMaps;
  });

  app.get('/api/audit', async (req, reply) => {
    if (!requirePermission(req, reply, 'auditoria')) return;
    return db.prepare('SELECT at, username, action, target, detail_json FROM audit_log ORDER BY id DESC LIMIT 200').all();
  });

  registerImportRoutes(app, db, cfg);
  registerAdminRoutes(app, db, cfg);
  registerDataRoutes(app, db);
  registerManualRoutes(app, db);

  if (cfg.webDist && existsSync(cfg.webDist)) {
    void app.register(fastifyStatic, { root: cfg.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'nao_encontrado', message: 'Não encontrado.' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
