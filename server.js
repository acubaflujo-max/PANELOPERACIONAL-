const http = require('http');
const fs = require('fs');
const path = require('path');
const { DEFAULT_SUPUESTOS, DEFAULT_TARIFA, calcular, turnoActual, armarMensaje } = require('./src/calc');
const { obtenerUsdBrl } = require('./src/rates');
const { obtenerMercado } = require('./src/mercado');
const wa = require('./src/whatsapp');

const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3030;
const HOST = process.env.HOST || '127.0.0.1';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';
const DATA_DIR = process.env.FLUJOBOT_DATA || __dirname;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// Fuera de localhost el panel exige contraseña: con la apikey detrás, cualquiera podría enviar por tu WhatsApp.
if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !PANEL_PASSWORD) {
  console.error('Define PANEL_PASSWORD para exponer el panel fuera de localhost.');
  process.exit(1);
}

function autorizado(req) {
  if (!PANEL_PASSWORD) return true;
  const h = req.headers.authorization || '';
  const [tipo, cred] = h.split(' ');
  if (tipo !== 'Basic' || !cred) return false;
  const pass = Buffer.from(cred, 'base64').toString().split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(PANEL_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

let fallos = 0;
setInterval(() => { fallos = 0; }, 60_000).unref();
const INDEX = path.join(__dirname, 'public', 'index.html');

function leerConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { destinoId: c.destinoId || '', supuestos: { ...DEFAULT_SUPUESTOS, ...c.supuestos }, tarifa: { ...DEFAULT_TARIFA, ...c.tarifa } };
  } catch {
    return { destinoId: '', supuestos: { ...DEFAULT_SUPUESTOS }, tarifa: { ...DEFAULT_TARIFA } };
  }
}

function guardarConfig(c) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}

function validarSupuestos(s) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SUPUESTOS)) {
    const v = Number(s?.[k]);
    if (!Number.isFinite(v) || v < 0 || v >= 1) throw new Error(`Supuesto "${k}" debe estar entre 0 y 1 (ej. 0.03 = 3%)`);
    out[k] = v;
  }
  return out;
}

function validarTarifa(t) {
  const out = {};
  for (const k of Object.keys(DEFAULT_TARIFA)) {
    const v = Number(t?.[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100000) throw new Error(`«${k}» debe ser un número válido (0 o mayor)`);
    out[k] = v;
  }
  return out;
}

function leerJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > 1e5) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('JSON inválido')); }
    });
  });
}

const responder = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const rutas = {
  'GET /api/estado': async () => ({ whatsapp: await wa.obtenerEstado(), config: leerConfig() }),

  'POST /api/evolution': async (body) => {
    wa.guardarConf(body);
    return { ok: true };
  },

  'GET /api/usdbrl': async () => obtenerUsdBrl(),

  'GET /api/mercado': async () => obtenerMercado(),

  'GET /api/destinos': async () => wa.listarDestinos(),

  'POST /api/calcular': async (body) => {
    const { supuestos, tarifa } = leerConfig();
    const r = calcular({ usdBrl: Number(body.usdBrl), cupUsd: Number(body.cupUsd) }, supuestos, tarifa);
    const turno = body.turno || turnoActual();
    return { ...r, mensaje: armarMensaje(r, { turno, tarifa }) };
  },

  'POST /api/config': async (body) => {
    const actual = leerConfig();
    const nuevo = {
      destinoId: typeof body.destinoId === 'string' ? body.destinoId : actual.destinoId,
      supuestos: body.supuestos ? validarSupuestos(body.supuestos) : actual.supuestos,
      tarifa: body.tarifa ? validarTarifa(body.tarifa) : actual.tarifa,
    };
    guardarConfig(nuevo);
    return nuevo;
  },

  'POST /api/enviar': async (body) => {
    const texto = String(body.mensaje || '').trim();
    if (!body.destinoId) throw new Error('Elige un grupo o canal de destino');
    if (!texto) throw new Error('El mensaje está vacío');
    await wa.enviar(body.destinoId, texto);
    return { ok: true };
  },
};

const server = http.createServer(async (req, res) => {
  try {
    if (PANEL_PASSWORD) {
      if (fallos >= 10) return responder(res, 429, { error: 'Demasiados intentos, espera un minuto' });
      if (!autorizado(req)) {
        fallos++;
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Flujo Cuba Remesas", charset="UTF-8"' });
        return res.end('Autenticación requerida');
      }
    } else {
      const host = (req.headers.host || '').split(':')[0];
      if (host !== 'localhost' && host !== '127.0.0.1') return responder(res, 403, { error: 'Host no permitido' });
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(INDEX));
    }

    const handler = rutas[`${req.method} ${req.url.split('?')[0]}`];
    if (!handler) return responder(res, 404, { error: 'No encontrado' });

    let body = {};
    if (req.method === 'POST') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) {
        return responder(res, 415, { error: 'Se requiere application/json' });
      }
      body = await leerJson(req);
    }
    responder(res, 200, await handler(body));
  } catch (e) {
    responder(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Panel de tasas escuchando en ${HOST}:${PORT}${PANEL_PASSWORD ? ' (con contraseña)' : ''}`);
});
