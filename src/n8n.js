// Avisa a n8n de la tasa vigente para que el envío automático (mañana, tarde y noche) publique siempre la misma.
// La URL y el token se guardan fuera de Google Drive, en %LOCALAPPDATA%\FlujoBot\n8n.json.

const fs = require('fs');
const path = require('path');

const DATOS_LOCALES = process.env.FLUJOBOT_DATA || path.join(process.env.LOCALAPPDATA || __dirname, 'FlujoBot');
const CONF_PATH = path.join(DATOS_LOCALES, 'n8n.json');

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

// Nunca lanza: si n8n no responde, el panel sigue funcionando y devuelve el motivo.
async function publicarTasa(tasa, { tarifa, enlace }) {
  const c = leerConf();
  if (!c.url || !c.token) return { ok: false, motivo: 'sin configurar' };
  try {
    const r = await fetch(c.url, {
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
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

module.exports = { publicarTasa, leerConf };
