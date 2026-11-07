const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.N8N_TASA_TOKEN = 'token-de-prueba';

test('publicarTasa envía la tasa con el token y no lanza si n8n falla', async () => {
  let recibido = null;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { recibido = JSON.parse(b); res.end('ok'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.N8N_TASA_URL = `http://127.0.0.1:${srv.address().port}/webhook/x`;
  const { publicarTasa } = require('../src/n8n');
  const tasa = { fecha: '2026-11-07', turno: 'Mañana', tasaCup: 187, tasaPequena: 185, usdBrl: 5.3, cupUsd: 1130 };
  const r = await publicarTasa(tasa, { tarifa: { umbralBrl: 100, montoMinimoBrl: 20 }, enlace: 'https://chat.whatsapp.com/abc' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(recibido.token, 'token-de-prueba');
  assert.strictEqual(recibido.tasaCup, 187);
  assert.strictEqual(recibido.umbralBrl, 100);
  srv.close();

  process.env.N8N_TASA_URL = 'http://127.0.0.1:1/caido';
  const caido = await publicarTasa(tasa, { tarifa: { umbralBrl: 100, montoMinimoBrl: 20 }, enlace: 'x' });
  assert.strictEqual(caido.ok, false);
});
