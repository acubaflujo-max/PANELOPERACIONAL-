// Base de datos del ERP en Supabase, por su API REST (PostgREST). Sin dependencias: usa fetch.
// Solo el servidor usa la clave SECRETA. Las tablas tienen RLS sin políticas y sin permisos para
// anon/authenticated: con la clave pública no se ve nada (los envíos guardan tarjetas y teléfonos).
// La conexión se guarda fuera de Google Drive, en %LOCALAPPDATA%\FlujoBot\supabase.json,
// o se define con las variables de entorno SUPABASE_URL y SUPABASE_SECRET_KEY (servidor/VPS).

const fs = require('fs');
const path = require('path');

const DATOS_LOCALES = process.env.FLUJOBOT_DATA || path.join(process.env.LOCALAPPDATA || __dirname, 'FlujoBot');
const CONF_PATH = path.join(DATOS_LOCALES, 'supabase.json');
const DESDE_ENTORNO = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const PAGINA = 1000; // Supabase devuelve como máximo 1000 filas por petición

// Nombre en el panel → columna en la tabla.
const CAMPOS = {
  lotes: { id: 'id', creado: 'creado', fecha: 'fecha', codigo: 'codigo', usdt: 'usdt', brl: 'brl', cupPorUsdt: 'cup_por_usdt',
    usadosPrevios: 'usados_previos', notas: 'notas' },
  envios: { id: 'id', creado: 'creado', fecha: 'fecha', cliente: 'cliente', montoBrl: 'monto_brl', tasa: 'tasa',
    cupEntregados: 'cup_entregados', lote: 'lote', estado: 'estado', tarjeta: 'tarjeta', telefono: 'telefono', notas: 'notas' },
  gastos: { id: 'id', creado: 'creado', fecha: 'fecha', concepto: 'concepto', categoria: 'categoria', montoBrl: 'monto_brl' },
  tasas: { id: 'id', creado: 'creado', fecha: 'fecha', turno: 'turno', tasaCup: 'tasa_cup', tasaPequena: 'tasa_pequena',
    usdBrl: 'usd_brl', cupUsd: 'cup_usd', notas: 'notas' },
};
const NUMERICOS = new Set(['creado', 'usdt', 'brl', 'cupPorUsdt', 'usadosPrevios', 'montoBrl', 'tasa', 'cupEntregados',
  'tasaCup', 'tasaPequena', 'usdBrl', 'cupUsd']);
const TABLAS = Object.keys(CAMPOS);

function leerConf() {
  if (DESDE_ENTORNO) {
    return { url: process.env.SUPABASE_URL.replace(/\/+$/, ''), key: process.env.SUPABASE_SECRET_KEY };
  }
  try {
    const c = JSON.parse(fs.readFileSync(CONF_PATH, 'utf8'));
    return { url: String(c.url || '').replace(/\/+$/, ''), key: c.key || '' };
  } catch {
    return { url: '', key: '' };
  }
}

const configurado = () => { const c = leerConf(); return !!(c.url && c.key); };

function normalizarConf({ url, key }) {
  if (DESDE_ENTORNO) throw new Error('La base de datos se define con variables de entorno en el servidor');
  const actual = leerConf();
  const nuevo = {
    url: String(url || '').trim().replace(/\/+$/, ''),
    key: String(key || '').trim() || actual.key, // vacío = conservar la actual
  };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(nuevo.url)) throw new Error('La URL debe ser la de tu proyecto: https://xxxx.supabase.co');
  if (!nuevo.key) throw new Error('Falta la clave secreta del proyecto');
  return nuevo;
}

function guardarConf(conf) {
  fs.mkdirSync(DATOS_LOCALES, { recursive: true });
  fs.writeFileSync(CONF_PATH, JSON.stringify(conf, null, 2));
}

function borrarConf() {
  if (DESDE_ENTORNO) throw new Error('La base de datos se define con variables de entorno en el servidor');
  fs.rmSync(CONF_PATH, { force: true });
}

async function llamar(conf, metodo, ruta, { cuerpo, prefer } = {}) {
  const headers = { apikey: conf.key, 'Content-Type': 'application/json' };
  // Las claves antiguas (JWT) también van en Authorization; las nuevas sb_secret_ solo en apikey.
  if (conf.key.startsWith('eyJ')) headers.Authorization = `Bearer ${conf.key}`;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${conf.url}/rest/v1/${ruta}`, {
    method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15000),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = { message: texto }; }
  if (!r.ok) {
    let msg = json?.message || json?.msg || `HTTP ${r.status}`;
    if (json?.code === '42501' || /permission denied/i.test(msg)) msg = 'esa clave no tiene acceso: usa la clave SECRETA del proyecto (no la pública)';
    else if (r.status === 401) msg = 'clave inválida';
    else if (json?.code === '23503') msg = 'ese lote tiene envíos asignados';
    else if (json?.code === '23505') msg = 'ya existe un registro con ese código';
    const e = new Error(`Supabase: ${msg}`);
    e.status = r.status;
    throw e;
  }
  return json;
}

function aFila(coleccion, item) {
  const fila = {};
  for (const [campo, col] of Object.entries(CAMPOS[coleccion])) {
    let v = item[campo];
    if (v === undefined || (campo === 'lote' && v === '')) v = null; // se envían todas las columnas: así editar puede vaciar un campo
    fila[col] = v;
  }
  return fila;
}

function deFila(coleccion, fila) {
  const item = {};
  for (const [campo, col] of Object.entries(CAMPOS[coleccion])) {
    const v = fila[col];
    if (v === null || v === undefined) {
      if (campo === 'lote') item.lote = '';
      continue;
    }
    item[campo] = NUMERICOS.has(campo) ? Number(v) : String(v);
  }
  return item;
}

async function leerTabla(conf, tabla) {
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const lote = await llamar(conf, 'GET', `${tabla}?select=*&order=creado.asc,id.asc&limit=${PAGINA}&offset=${desde}`);
    filas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return filas.map((f) => deFila(tabla, f));
}

async function leerTodo(conf = leerConf()) {
  const listas = await Promise.all(TABLAS.map((t) => leerTabla(conf, t)));
  return { version: 1, ...Object.fromEntries(TABLAS.map((t, i) => [t, listas[i]])) };
}

async function guardarFilas(coleccion, items, conf = leerConf()) {
  if (!items.length) return;
  await llamar(conf, 'POST', `${coleccion}?on_conflict=id`, {
    cuerpo: items.map((i) => aFila(coleccion, i)), prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

async function borrarFila(coleccion, id, conf = leerConf()) {
  await llamar(conf, 'DELETE', `${coleccion}?id=eq.${encodeURIComponent(id)}`, { prefer: 'return=minimal' });
}

// Comprueba URL y clave antes de guardarlas. Devuelve cuántas filas hay en cada tabla.
async function probar(conf) {
  const datos = await leerTodo(conf);
  return Object.fromEntries(TABLAS.map((t) => [t, datos[t].length]));
}

function estado() {
  const c = leerConf();
  return { modo: c.url && c.key ? 'supabase' : 'local', url: c.url, tieneKey: !!c.key, desdeEntorno: DESDE_ENTORNO };
}

module.exports = { TABLAS, configurado, estado, normalizarConf, guardarConf, borrarConf, leerTodo, guardarFilas, borrarFila, probar, aFila, deFila };
