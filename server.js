const http = require('http');
const fs = require('fs');
const path = require('path');
const { DEFAULT_SUPUESTOS, DEFAULT_TARIFA, DEFAULT_ENLACE, calcular, turnoActual, armarMensaje } = require('./src/calc');
const { obtenerUsdBrl } = require('./src/rates');
const { obtenerMercado } = require('./src/mercado');
const wa = require('./src/whatsapp');
const erp = require('./src/erp');
const { crearAlmacen } = require('./src/libro');
const supabase = require('./src/supabase');

const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3030;
const HOST = process.env.HOST || '127.0.0.1';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';
const DATA_DIR = process.env.FLUJOBOT_DATA || __dirname;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const almacen = crearAlmacen(DATA_DIR);
const ALERTA_USDT = 50;

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
    return { destinoId: c.destinoId || '', supuestos: { ...DEFAULT_SUPUESTOS, ...c.supuestos }, tarifa: { ...DEFAULT_TARIFA, ...c.tarifa }, enlace: c.enlace || DEFAULT_ENLACE,
      alertaUsdt: Number.isFinite(c.alertaUsdt) ? c.alertaUsdt : ALERTA_USDT };
  } catch {
    return { destinoId: '', supuestos: { ...DEFAULT_SUPUESTOS }, tarifa: { ...DEFAULT_TARIFA }, enlace: DEFAULT_ENLACE, alertaUsdt: ALERTA_USDT };
  }
}

async function estadoErp(datos) {
  const { supuestos, alertaUsdt } = leerConfig();
  return erp.calcularLibro(datos || await almacen.leer(), supuestos, { alertaUsdt });
}

async function respuestaErp() {
  const datos = await almacen.leer();
  return { datos, calculo: await estadoErp(datos), db: supabase.estado() };
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
    const { supuestos, tarifa, enlace } = leerConfig();
    const r = calcular({ usdBrl: Number(body.usdBrl), cupUsd: Number(body.cupUsd) }, supuestos, tarifa);
    const turno = body.turno || turnoActual();
    // Además del mercado, se compara con lo que de verdad costó el USDT del lote activo.
    let lote = null, avisoDb = null;
    try { lote = erp.loteActivo(await almacen.leer(), supuestos); } catch (e) { avisoDb = e.message; }
    return { ...r, lote, avisoDb, mensaje: armarMensaje(r, { turno, tarifa, enlace }) };
  },

  'POST /api/config': async (body) => {
    const actual = leerConfig();
    const nuevo = {
      destinoId: typeof body.destinoId === 'string' ? body.destinoId : actual.destinoId,
      supuestos: body.supuestos ? validarSupuestos(body.supuestos) : actual.supuestos,
      tarifa: body.tarifa ? validarTarifa(body.tarifa) : actual.tarifa,
      enlace: actual.enlace,
      alertaUsdt: actual.alertaUsdt,
    };
    if (body.alertaUsdt !== undefined) {
      const a = Number(body.alertaUsdt);
      if (!Number.isFinite(a) || a < 0 || a > 1e7) throw new Error('La alerta de USDT debe ser un número válido (0 o mayor)');
      nuevo.alertaUsdt = a;
    }
    if (typeof body.enlace === 'string') {
      const e = body.enlace.trim();
      if (!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(e)) throw new Error('El enlace debe ser de la forma https://chat.whatsapp.com/…');
      nuevo.enlace = e;
    }
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

  // ---- ERP: lotes, envíos, gastos, tasas publicadas ----
  'GET /api/erp': async () => respuestaErp(),

  'POST /api/erp/guardar': async (body) => {
    const item = await almacen.guardar(body.coleccion, body.item || {});
    return { item, ...(await respuestaErp()) };
  },

  'POST /api/erp/borrar': async (body) => {
    await almacen.borrar(body.coleccion, String(body.id || ''));
    return respuestaErp();
  },

  // Calcula costo y ganancia de un envío sin guardarlo (vista previa del formulario).
  'POST /api/erp/simular': async (body) => {
    const { supuestos } = leerConfig();
    const datos = await almacen.leer();
    const item = erp.guardarItem(datos, 'envios', { ...body.item, estado: 'Pendiente' });
    return erp.calcularLibro(datos, supuestos).envios.find((e) => e.id === item.id);
  },

  'GET /api/erp/exportar': async (_body, url) => {
    const que = url.searchParams.get('c') || '';
    const csv = erp.exportar(await estadoErp(), que);
    return { __csv: csv, nombre: `flujo-${que}-${new Date().toISOString().slice(0, 10)}.csv` };
  },

  // ---- Base de datos: archivo local o Supabase ----
  'GET /api/db': async () => supabase.estado(),

  'POST /api/db': async (body) => {
    const conf = supabase.normalizarConf(body);
    const filas = await supabase.probar(conf); // solo se guarda si la conexión funciona
    supabase.guardarConf(conf);
    return { ...supabase.estado(), filas };
  },

  'POST /api/db/desconectar': async () => {
    supabase.borrarConf();
    return supabase.estado();
  },

  'POST /api/db/subir-local': async () => ({ subidos: await almacen.subirLocal(), ...supabase.estado() }),
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

    const url = new URL(req.url, 'http://localhost');
    const handler = rutas[`${req.method} ${url.pathname}`];
    if (!handler) return responder(res, 404, { error: 'No encontrado' });

    let body = {};
    if (req.method === 'POST') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) {
        return responder(res, 415, { error: 'Se requiere application/json' });
      }
      body = await leerJson(req);
    }
    const resultado = await handler(body, url);
    if (resultado && resultado.__csv !== undefined) {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${resultado.nombre}"` });
      return res.end(resultado.__csv);
    }
    responder(res, 200, resultado);
  } catch (e) {
    responder(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Panel de tasas escuchando en ${HOST}:${PORT}${PANEL_PASSWORD ? ' (con contraseña)' : ''}`);
});
