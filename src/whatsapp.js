// Cliente de Evolution API (https://github.com/EvolutionAPI/evolution-api). Sin dependencias: usa fetch.
// Las credenciales se guardan fuera de Google Drive, en %LOCALAPPDATA%\FlujoBot\evolution.json.

const fs = require('fs');
const path = require('path');

const DATOS_LOCALES = process.env.FLUJOBOT_DATA || path.join(process.env.LOCALAPPDATA || __dirname, 'FlujoBot');
const CONF_PATH = path.join(DATOS_LOCALES, 'evolution.json');

// En el VPS las credenciales vienen de variables de entorno y el panel no las puede cambiar.
const DESDE_ENTORNO = !!(process.env.EVOLUTION_URL && process.env.EVOLUTION_APIKEY && process.env.EVOLUTION_INSTANCE);

function leerConf() {
  if (DESDE_ENTORNO) {
    return {
      url: process.env.EVOLUTION_URL.replace(/\/+$/, ''),
      apikey: process.env.EVOLUTION_APIKEY,
      instance: process.env.EVOLUTION_INSTANCE,
    };
  }
  try {
    const c = JSON.parse(fs.readFileSync(CONF_PATH, 'utf8'));
    return { url: String(c.url || '').replace(/\/+$/, ''), apikey: c.apikey || '', instance: c.instance || '' };
  } catch {
    return { url: '', apikey: '', instance: '' };
  }
}

function guardarConf({ url, apikey, instance }) {
  if (DESDE_ENTORNO) throw new Error('La conexión se define con variables de entorno en el servidor');
  const actual = leerConf();
  const nuevo = {
    url: String(url || '').trim().replace(/\/+$/, ''),
    apikey: String(apikey || '').trim() || actual.apikey, // vacío = conservar la actual
    instance: String(instance || '').trim(),
  };
  if (!/^https?:\/\//.test(nuevo.url)) throw new Error('La URL debe empezar por http:// o https://');
  if (!nuevo.apikey) throw new Error('Falta la apikey');
  if (!nuevo.instance) throw new Error('Falta el nombre de la instancia');
  fs.mkdirSync(DATOS_LOCALES, { recursive: true });
  fs.writeFileSync(CONF_PATH, JSON.stringify(nuevo, null, 2));
}

async function llamar(metodo, ruta, cuerpo) {
  const c = leerConf();
  const r = await fetch(c.url + ruta, {
    method: metodo,
    headers: { apikey: c.apikey, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20000),
  });
  const texto = await r.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = { raw: texto }; }
  if (!r.ok) {
    // Evolution v2 manda el detalle en response.message (texto o lista); «error» solo dice «Internal Server Error».
    const m = json.response?.message;
    const detalle = Array.isArray(m) ? m.flat().map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ') : typeof m === 'string' ? m : '';
    const e = new Error(detalle || json.message || json.error || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return json;
}

const qrSrc = (b64) => (b64 ? (b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`) : null);

// El QR se pide como mucho cada 20 s: pedir /connect en cada consulta reinicia el intento de conexión.
let qrGuardado = { cuando: 0, base64: null };

async function estadoConexion(c) {
  return (await llamar('GET', `/instance/connectionState/${encodeURIComponent(c.instance)}`)).instance?.state;
}

// Estado para el panel: el panel consulta seguido mientras WhatsApp no está conectado.
async function obtenerEstado() {
  const c = leerConf();
  if (!c.url || !c.apikey || !c.instance) {
    return { estado: 'sin_configurar', qr: null, error: null, conf: { url: c.url, instance: c.instance, tieneKey: !!c.apikey, desdeEntorno: DESDE_ENTORNO } };
  }
  const conf = { url: c.url, instance: c.instance, tieneKey: true, desdeEntorno: DESDE_ENTORNO };
  try {
    let state;
    try {
      state = await estadoConexion(c);
    } catch (e) {
      if (e.status !== 404) throw e;
      // La instancia no existe todavía: se crea y la respuesta ya trae el QR.
      const nueva = await llamar('POST', '/instance/create', {
        instanceName: c.instance, qrcode: true, integration: 'WHATSAPP-BAILEYS',
      });
      return { estado: 'qr', qr: qrSrc(nueva.qrcode?.base64), error: null, conf };
    }
    if (state === 'open') { qrGuardado = { cuando: 0, base64: null }; return { estado: 'listo', qr: null, error: null, conf }; }
    if (Date.now() - qrGuardado.cuando > 20_000) {
      const q = await llamar('GET', `/instance/connect/${encodeURIComponent(c.instance)}`);
      qrGuardado = { cuando: Date.now(), base64: q.base64 || null };
    }
    return { estado: qrGuardado.base64 ? 'qr' : 'autenticando', qr: qrSrc(qrGuardado.base64), error: null, conf };
  } catch (e) {
    return { estado: 'error', qr: null, error: `Evolution API: ${e.message}`, conf };
  }
}

async function listarDestinos() {
  const c = leerConf();
  const grupos = await llamar('GET', `/group/fetchAllGroups/${encodeURIComponent(c.instance)}?getParticipants=false`);
  return (Array.isArray(grupos) ? grupos : [])
    .map((g) => ({ id: g.id, nombre: g.subject || g.id, tipo: 'Grupo' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function enviar(id, texto) {
  const c = leerConf();
  if (!c.url || !c.apikey || !c.instance) throw new Error('WhatsApp no está configurado (Ajustes → WhatsApp).');
  // Desvinculado, Evolution responde un 500 sin explicación: se avisa antes de intentar.
  let estado;
  try { estado = await estadoConexion(c); } catch (e) { throw new Error(`No se pudo consultar WhatsApp: ${e.message}`); }
  if (estado !== 'open') {
    throw new Error('WhatsApp no está conectado. Ve a Ajustes → WhatsApp y escanea el QR con el teléfono del bot.');
  }
  const ruta = `/message/sendText/${encodeURIComponent(c.instance)}`;
  try {
    await llamar('POST', ruta, { number: id, text: texto });
  } catch (e) {
    if (e.status !== 400) throw e;
    // Versiones antiguas de la API esperan el texto anidado.
    await llamar('POST', ruta, { number: id, textMessage: { text: texto } });
  }
}

async function enviarImagen(id, base64, pie = '') {
  const c = leerConf();
  if (!c.url || !c.apikey || !c.instance) throw new Error('WhatsApp no está configurado (Ajustes → WhatsApp).');
  let estado;
  try { estado = await estadoConexion(c); } catch (e) { throw new Error(`No se pudo consultar WhatsApp: ${e.message}`); }
  if (estado !== 'open') {
    throw new Error('WhatsApp no está conectado. Ve a Ajustes → WhatsApp y escanea el QR con el teléfono del bot.');
  }
  await llamar('POST', `/message/sendMedia/${encodeURIComponent(c.instance)}`, {
    number: id, mediatype: 'image', mimetype: 'image/png', media: base64, fileName: 'tasa-flujo-cuba.png', caption: pie,
  });
}

module.exports = { obtenerEstado, listarDestinos, enviar, enviarImagen, guardarConf };
