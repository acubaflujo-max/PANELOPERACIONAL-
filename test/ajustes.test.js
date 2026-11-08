const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-aj-'));
process.env.FLUJOBOT_DATA = DIR;
process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_prueba';
const supabase = require('../src/supabase');

// Supabase falso: una tabla «ajustes» con upsert por clave; con sinTabla responde como PostgREST cuando falta.
const filas = [];
let sinTabla = false;
global.fetch = async (url, opt) => {
  const u = new URL(url);
  const responder = (status, cuerpo) => ({ ok: status < 300, status, text: async () => (cuerpo === undefined ? '' : JSON.stringify(cuerpo)) });
  if (!u.pathname.endsWith('/ajustes')) return responder(404, { message: 'no' });
  if (sinTabla) return responder(404, { code: 'PGRST205', message: "Could not find the table 'public.ajustes'" });
  if (opt.method === 'GET') return responder(200, filas.filter((f) => f.clave === 'config').map((f) => ({ valor: f.valor })));
  for (const f of JSON.parse(opt.body)) {
    const i = filas.findIndex((x) => x.clave === f.clave);
    if (i >= 0) filas[i] = f; else filas.push(f);
  }
  return responder(201);
};

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('los ajustes se guardan y se leen de Supabase; vacío = null', async () => {
  assert.strictEqual(await supabase.leerAjustes(), null);
  await supabase.guardarAjustes({ supuestos: { margin: 0.055 }, tarifa: { restaCup: 3 } });
  await supabase.guardarAjustes({ supuestos: { margin: 0.06 }, tarifa: { restaCup: 3 } }); // upsert: no duplica
  assert.strictEqual(filas.length, 1);
  assert.strictEqual((await supabase.leerAjustes()).supuestos.margin, 0.06);
});

test('si falta la tabla, el error dice qué hacer', async () => {
  sinTabla = true;
  await assert.rejects(supabase.leerAjustes(), /tabla «ajustes»/);
});
