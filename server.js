const http = require('http');
const fs = require('fs');
const path = require('path');
const { DEFAULT_SUPUESTOS, DEFAULT_TARIFA, DEFAULT_ENLACE, calcular, turnoActual, armarMensaje, armarPlantillaDatos, armarOperacion } = require('./src/calc');
const { obtenerUsdBrl } = require('./src/rates');
const { obtenerMercado } = require('./src/mercado');
const wa = require('./src/whatsapp');
const n8n = require('./src/n8n');
const sesion = require('./src/sesion');
const erp = require('./src/erp');
const { crearAlmacen } = require('./src/libro');
const supabase = require('./src/supabase');


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

// Entra con la cookie de sesión (página /login, solo contraseña). El encabezado Basic se sigue aceptando
// para scripts, pero el navegador ya no muestra la ventana de usuario y contraseña.
function autorizado(req) {
  if (!PANEL_PASSWORD) return true;
  if (sesion.sesionValida(sesion.leerCookie(req.headers.cookie), PANEL_PASSWORD)) return true;
  const [tipo, cred] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Basic' || !cred) return false;
  const pass = Buffer.from(cred, 'base64').toString().split(':').slice(1).join(':');
  return sesion.claveCorrecta(pass, PANEL_PASSWORD);
}

let fallos = 0;
setInterval(() => { fallos = 0; }, 60_000).unref();
const INDEX = path.join(__dirname, 'public', 'index.html');
const LOGIN = path.join(__dirname, 'public', 'login.html');
const TARJETA_JS = path.join(__dirname, 'public', 'tarjeta.js');
const tarjeta = require('./src/tarjeta');
const entraPorHttps = (req) => req.headers['x-forwarded-proto'] === 'https';

// Con Supabase conectado, los ajustes viven en la tabla «ajustes» (sobreviven a los despliegues del VPS);
// el archivo config.json queda como copia. La lectura sigue siendo síncrona: se usa la copia en memoria.
let configRemota = null;
let ajustesEstado = { en: 'archivo', error: '' };
let ultimaSincronia = 0;

function leerArchivoConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function leerConfig() {
  const c = configRemota || leerArchivoConfig();
  return { destinoId: c.destinoId || '', destinoOpsId: c.destinoOpsId || '', supuestos: { ...DEFAULT_SUPUESTOS, ...c.supuestos }, tarifa: { ...DEFAULT_TARIFA, ...c.tarifa }, enlace: c.enlace || DEFAULT_ENLACE,
    contacto: c.contacto || '', pix: c.pix || '', alertaUsdt: Number.isFinite(c.alertaUsdt) ? c.alertaUsdt : ALERTA_USDT };
}

function escribirArchivoConfig(c) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}

// Trae los ajustes de Supabase. Si la tabla está vacía, sube los que ya había en el archivo (primera vez).
async function sincronizarAjustes(forzar = false) {
  if (!forzar && Date.now() - ultimaSincronia < 10_000) return;
  ultimaSincronia = Date.now();
  if (!supabase.configurado()) { configRemota = null; ajustesEstado = { en: 'archivo', error: '' }; return; }
  try {
    let remoto = await supabase.leerAjustes();
    if (!remoto) {
      const local = leerArchivoConfig();
      if (Object.keys(local).length) { await supabase.guardarAjustes(local); remoto = local; }
    }
    configRemota = remoto;
    ajustesEstado = { en: 'supabase', error: '' };
    if (remoto) { try { escribirArchivoConfig(remoto); } catch {} }
  } catch (e) {
    configRemota = null;
    ajustesEstado = { en: 'archivo', error: e.message };
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

// Las tasas registradas a mano pueden no traer la pequeña: se deduce con el tramo configurado.
const pequenaDe = (t, tarifa) => (Number.isFinite(t.tasaPequena) ? t.tasaPequena
  : Math.max(Math.floor((t.tasaCup - (tarifa.restaCup || 0)) * 2) / 2, 0));

// Solo la tasa más reciente pasa a ser la vigente: corregir una tasa vieja no cambia lo que se publica.
async function avisarTasaVigente(item) {
  const { tarifa, enlace } = leerConfig();
  const ultima = (await estadoErp()).tasas[0];
  if (!ultima || ultima.id !== item.id) return { ok: false, motivo: 'no es la tasa más reciente' };
  const r = await n8n.publicarTasa({ ...item, tasaPequena: pequenaDe(item, tarifa) }, { tarifa, enlace });
  if (!r.ok) console.error('n8n no recibió la tasa vigente:', r.motivo);
  return r;
}

async function guardarConfig(c) {
  escribirArchivoConfig(c);
  if (!supabase.configurado()) return;
  try {
    await supabase.guardarAjustes(c);
    configRemota = c;
    ajustesEstado = { en: 'supabase', error: '' };
  } catch (e) {
    configRemota = null; // sin Supabase se usa el archivo recién escrito
    ajustesEstado = { en: 'archivo', error: e.message };
    throw new Error(`Se guardó en el servidor, pero no en Supabase: ${e.message}`);
  }
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

function leerJson(req, maximo = 1e5) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > maximo) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); }
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
  'GET /api/estado': async () => {
    await sincronizarAjustes();
    return { whatsapp: await wa.obtenerEstado(), config: leerConfig(), ajustes: ajustesEstado };
  },

  'POST /api/evolution': async (body) => {
    wa.guardarConf(body);
    return { ok: true };
  },

  // Envío automático de 3 turnos: qué tasa tiene el bot en n8n y cómo fue el último aviso.
  'GET /api/automatico': async () => ({ ...n8n.estado(), bot: await n8n.consultarBot() }),

  'POST /api/automatico/reenviar': async () => {
    const ultima = (await estadoErp()).tasas[0];
    if (!ultima) throw new Error('Todavía no hay ninguna tasa registrada');
    const r = await avisarTasaVigente(ultima);
    if (!r.ok) throw new Error(r.motivo === 'sin configurar' ? 'El envío automático no está configurado en este servidor' : `El bot no recibió la tasa: ${r.motivo}`);
    return { ok: true, tasaCup: ultima.tasaCup };
  },

  // Plantilla para pedir los datos de la remesa; el monto es opcional y usa la tasa vigente según el tramo.
  'POST /api/plantilla-datos': async (body) => {
    const { tarifa, pix } = leerConfig();
    const montoBrl = Number(body.montoBrl) || 0;
    const ultima = (await estadoErp()).tasas[0];
    const tasa = !ultima ? 0 : montoBrl > 0 && montoBrl < tarifa.umbralBrl ? pequenaDe(ultima, tarifa) : ultima.tasaCup;
    if (montoBrl > 0 && montoBrl < tarifa.montoMinimoBrl) throw new Error(`El envío mínimo es de ${tarifa.montoMinimoBrl} BRL`);
    return { texto: armarPlantillaDatos({ montoBrl, tasa, pix }), tasa, cup: montoBrl * tasa };
  },

  // Mensaje de una operación para el grupo de operaciones (vista previa).
  'POST /api/operacion/mensaje': async (body) => {
    const { tarifa } = leerConfig();
    const montoBrl = Number(body.montoBrl);
    if (montoBrl > 0 && montoBrl < tarifa.montoMinimoBrl) throw new Error(`El envío mínimo es de ${tarifa.montoMinimoBrl} BRL`);
    return { texto: armarOperacion({ ...body, montoBrl, tasa: Number(body.tasa) }) };
  },

  // Manda la operación al grupo OPERACIONES - REMESAS (el que se elige en la pestaña Operaciones).
  'POST /api/operacion/enviar': async (body) => {
    const { destinoOpsId } = leerConfig();
    const texto = String(body.mensaje || '').trim();
    if (!destinoOpsId) throw new Error('Elige primero el grupo de operaciones');
    if (!texto) throw new Error('El mensaje está vacío');
    await wa.enviar(destinoOpsId, texto);
    return { ok: true };
  },

  'GET /api/usdbrl': async () => obtenerUsdBrl(),

  'GET /api/mercado': async () => obtenerMercado(),

  'GET /api/destinos': async () => wa.listarDestinos(),

  'POST /api/calcular': async (body) => {
    const { supuestos, tarifa, enlace, contacto } = leerConfig();
    const r = calcular({ usdBrl: Number(body.usdBrl), cupUsd: Number(body.cupUsd) }, supuestos, tarifa);
    const turno = body.turno || turnoActual();
    // Además del mercado, se compara con lo que de verdad costó el USDT del lote activo.
    let lote = null, avisoDb = null;
    try { lote = erp.loteActivo(await almacen.leer(), supuestos); } catch (e) { avisoDb = e.message; }
    return { ...r, lote, avisoDb, mensaje: armarMensaje(r, { turno, tarifa, enlace, contacto }) };
  },

  'POST /api/config': async (body) => {
    const actual = leerConfig();
    const nuevo = {
      destinoId: typeof body.destinoId === 'string' ? body.destinoId : actual.destinoId,
      destinoOpsId: typeof body.destinoOpsId === 'string' ? body.destinoOpsId : actual.destinoOpsId,
      supuestos: body.supuestos ? validarSupuestos(body.supuestos) : actual.supuestos,
      tarifa: body.tarifa ? validarTarifa(body.tarifa) : actual.tarifa,
      enlace: actual.enlace,
      contacto: actual.contacto,
      pix: actual.pix,
      alertaUsdt: actual.alertaUsdt,
    };
    if (body.alertaUsdt !== undefined) {
      const a = Number(body.alertaUsdt);
      if (!Number.isFinite(a) || a < 0 || a > 1e7) throw new Error('La alerta de USDT debe ser un número válido (0 o mayor)');
      nuevo.alertaUsdt = a;
    }
    if (typeof body.pix === 'string') {
      const p = body.pix.trim();
      if (p.length > 300) throw new Error('Los datos del PIX son muy largos (máximo 300 caracteres)');
      nuevo.pix = p;
    }
    if (typeof body.contacto === 'string') {
      const n = body.contacto.replace(/\D/g, '');
      if (n && !/^[1-9]\d{9,14}$/.test(n)) throw new Error('El WhatsApp de contacto va con código de país, ej. 5548999998888');
      nuevo.contacto = n;
    }
    if (typeof body.enlace === 'string') {
      const e = body.enlace.trim();
      if (!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(e)) throw new Error('El enlace debe ser de la forma https://chat.whatsapp.com/…');
      nuevo.enlace = e;
    }
    await guardarConfig(nuevo);
    return nuevo;
  },

  'POST /api/enviar': async (body) => {
    const texto = String(body.mensaje || '').trim();
    if (!body.destinoId) throw new Error('Elige un grupo o canal de destino');
    if (!texto) throw new Error('El mensaje está vacío');
    await wa.enviar(body.destinoId, texto);
    return { ok: true };
  },

  // Tarjeta de la tasa dibujada en el navegador (PNG en base64) con el mensaje como pie de foto.
  'POST /api/enviar-imagen': async (body) => {
    if (!body.destinoId) throw new Error('Elige un grupo o canal de destino');
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.imagen || ''));
    if (!m) throw new Error('La imagen no es un PNG válido');
    await wa.enviarImagen(body.destinoId, m[1], String(body.mensaje || '').trim());
    return { ok: true };
  },

  // ---- ERP: lotes, envíos, gastos, tasas publicadas ----
  'GET /api/erp': async () => respuestaErp(),

  'POST /api/erp/guardar': async (body) => {
    const item = await almacen.guardar(body.coleccion, body.item || {});
    const n8nTasa = body.coleccion === 'tasas' ? await avisarTasaVigente(item) : undefined;
    return { item, n8nTasa, ...(await respuestaErp()) };
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
    await sincronizarAjustes(true);
    return { ...supabase.estado(), filas, ajustes: ajustesEstado };
  },

  'POST /api/db/desconectar': async () => {
    supabase.borrarConf();
    await sincronizarAjustes(true);
    return supabase.estado();
  },

  'POST /api/db/subir-local': async () => ({ subidos: await almacen.subirLocal(), ...supabase.estado() }),
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const redirigir = (destino, cabeceras = {}) => { res.writeHead(302, { Location: destino, ...cabeceras }); res.end(); };

    // El script de dibujo es público: lo comparten el navegador y el servidor.
    if (req.method === 'GET' && url.pathname === '/tarjeta.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(TARJETA_JS));
    }

    // n8n pide la imagen de la tasa con el mismo token que ya usa el panel para avisarle (sin sesión de panel).
    if (req.method === 'POST' && url.pathname === '/api/automatico/imagen') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return responder(res, 415, { error: 'Se requiere application/json' });
      const b = await leerJson(req);
      const { token } = n8n.leerConf();
      if (!token || !sesion.claveCorrecta(b.token ?? '', token)) return responder(res, 401, { error: 'Token inválido' });
      if (!/^(\d{8,20}@g\.us|\d{8,15})$/.test(String(b.destinoId || ''))) throw new Error('destinoId no válido');
      await wa.enviarImagen(b.destinoId, tarjeta.png(b).toString('base64'));
      return responder(res, 200, { ok: true });
    }

    if (PANEL_PASSWORD) {
      if (url.pathname === '/login' && req.method === 'GET') {
        if (autorizado(req)) return redirigir('/');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(LOGIN));
      }
      if (url.pathname === '/login' && req.method === 'POST') {
        if (fallos >= 10) return responder(res, 429, { error: 'Demasiados intentos, espera un minuto' });
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return responder(res, 415, { error: 'Se requiere application/json' });
        const { clave } = await leerJson(req);
        if (!sesion.claveCorrecta(clave ?? '', PANEL_PASSWORD)) {
          fallos++;
          return responder(res, 401, { error: 'Contraseña incorrecta' });
        }
        res.setHeader('Set-Cookie', sesion.cookieSesion(sesion.crearSesion(PANEL_PASSWORD), entraPorHttps(req)));
        return responder(res, 200, { ok: true });
      }
      if (url.pathname === '/logout') return redirigir('/login', { 'Set-Cookie': sesion.cookieBorrada(entraPorHttps(req)) });
      if (!autorizado(req)) {
        if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return redirigir('/login');
        return responder(res, 401, { error: 'Sesión vencida, vuelve a entrar' });
      }
    } else {
      const host = (req.headers.host || '').split(':')[0];
      if (host !== 'localhost' && host !== '127.0.0.1') return responder(res, 403, { error: 'Host no permitido' });
      if (url.pathname === '/login' || url.pathname === '/logout') return redirigir('/');
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(INDEX));
    }

    const handler = rutas[`${req.method} ${url.pathname}`];
    if (!handler) return responder(res, 404, { error: 'No encontrado' });

    let body = {};
    if (req.method === 'POST') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) {
        return responder(res, 415, { error: 'Se requiere application/json' });
      }
      // La imagen de la tasa viaja en base64 (≈1 MB como máximo).
      body = await leerJson(req, url.pathname === '/api/enviar-imagen' ? 4e6 : 1e5);
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

sincronizarAjustes(true);
server.listen(PORT, HOST, () => {
  console.log(`Panel de tasas escuchando en ${HOST}:${PORT}${PANEL_PASSWORD ? ' (con contraseña)' : ''}`);
});
