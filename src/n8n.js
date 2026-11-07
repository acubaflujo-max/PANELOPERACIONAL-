// Avisa a n8n de la tasa vigente para que el envío automático (mañana, tarde y noche) publique siempre la misma.
// La URL y el token se guardan fuera de Google Drive, en %LOCALAPPDATA%\FlujoBot\n8n.json.

const fs = require('fs');
const path = require('path');

const DATOS_LOCALES = process.env.FLUJOBOT_DATA || path.join(process.env.LOCALAPPDATA || __dirname, 'FlujoBot');
const CONF_PATH = path.join(DATOS_LOCALES, 'n8n.json');

// Deben coincidir con el disparador «Turnos» y la regla de pausa del flujo en n8n.
const HORARIOS = ['07:00', '13:00', '19:00'];
const ZONA = 'America/Sao_Paulo';
const UMBRAL_CAMBIO = 0.03;

// Resultado del último aviso a n8n (se pierde al reiniciar el panel).
let ultimoAviso = null;

// En el VPS la conexión viene de variables de entorno.
function leerConf() {
  if (process.env.N8N_TASA_URL && process.env.N8N_TASA_TOKEN) {
    return { url: process.env.N8N_TASA_URL, token: process.env.N8N_TASA_TOKEN };
  }
  try {
    const c = JSON.parse(fs.readFileSync(CONF_PATH, 'utf8'));
    return { url: String(c.url || ''), token: String(c.token || '') };
  } catch {
    return { url: '', token: '' };
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// n8n contesta 200 aunque el token no coincida, así que se confirma leyendo lo que el bot guardó.
async function confirmarEnBot(tasaCup, desde, pausas) {
  for (const ms of pausas) {
    await esperar(ms);
    const b = await consultarBot();
    if (b.ok && b.tasa && b.tasa.tasaCup === tasaCup && Date.parse(b.tasa.guardada) >= desde - 60_000) return true;
  }
  return false;
}

// Nunca lanza: si n8n no responde, el panel sigue funcionando y devuelve el motivo.
async function publicarTasa(tasa, { tarifa, enlace }, pausas = [700, 1500, 2500]) {
  const c = leerConf();
  if (!c.url || !c.token) return { ok: false, motivo: 'sin configurar' };
  const desde = Date.now();
  let r;
  try {
    const resp = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: c.token,
        fecha: tasa.fecha,
        turno: tasa.turno,
        tasaCup: tasa.tasaCup,
        tasaPequena: tasa.tasaPequena,
        usdBrl: tasa.usdBrl ?? null,
        cupUsd: tasa.cupUsd ?? null,
        umbralBrl: tarifa.umbralBrl,
        montoMinimoBrl: tarifa.montoMinimoBrl,
        enlace,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    r = (await confirmarEnBot(tasa.tasaCup, desde, pausas)) ? { ok: true }
      : { ok: false, motivo: 'n8n la rechazó: el token N8N_TASA_TOKEN no coincide con el del flujo' };
  } catch (e) {
    r = { ok: false, motivo: e.message };
  }
  ultimoAviso = { ...r, cuando: new Date().toISOString(), tasaCup: tasa.tasaCup };
  return r;
}

// Lo que el bot tiene guardado y qué hizo en el último turno (webhook de solo lectura en n8n).
async function consultarBot() {
  const { url } = leerConf();
  const urlEstado = url.replace(/\/flujo-tasa\/?$/, '/flujo-tasa-estado');
  if (!url || urlEstado === url) return { ok: false, motivo: 'sin configurar' };
  try {
    const r = await fetch(urlEstado, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { ok: true, ...(await r.json()) };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

function estado() {
  const c = leerConf();
  return { configurado: !!(c.url && c.token), horarios: HORARIOS, zona: ZONA, umbralCambio: UMBRAL_CAMBIO, ultimoAviso };
}

module.exports = { publicarTasa, consultarBot, estado, leerConf };
