const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.N8N_TASA_TOKEN = 'token-de-prueba';

// Servidor que hace de n8n: como el flujo real, solo guarda la tasa si el token coincide y siempre contesta 200.
async function n8nFalso(tokenDelFlujo = 'token-de-prueba') {
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/webhook/flujo-tasa-estado') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ tasa: srv.guardada || null, ultimoEstado: 'enviada tasa 187 (Mañana)', ultimoTurno: '2026-11-07T10:00:00.000Z' }));
    }
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      srv.recibido = JSON.parse(b);
      if (srv.recibido.token === tokenDelFlujo) srv.guardada = { tasaCup: srv.recibido.tasaCup, guardada: new Date().toISOString() };
      res.end('Workflow got started.');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.N8N_TASA_URL = `http://127.0.0.1:${srv.address().port}/webhook/flujo-tasa`;
  return srv;
}

const tasa = { fecha: '2026-11-07', turno: 'Mañana', tasaCup: 187, tasaPequena: 185, usdBrl: 5.3, cupUsd: 1130 };
const opciones = { tarifa: { umbralBrl: 100, montoMinimoBrl: 20 }, enlace: 'https://chat.whatsapp.com/abc' };

test('publicarTasa envía la tasa con el token, recuerda el resultado y no lanza si n8n falla', async () => {
  const srv = await n8nFalso();
  const n8n = require('../src/n8n');
  const r = await n8n.publicarTasa(tasa, opciones, [10]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(srv.recibido.token, 'token-de-prueba');
  assert.strictEqual(srv.recibido.tasaCup, 187);
  assert.strictEqual(srv.recibido.umbralBrl, 100);
  assert.strictEqual(n8n.estado().ultimoAviso.ok, true);
  assert.strictEqual(n8n.estado().configurado, true);
  srv.close();

  process.env.N8N_TASA_URL = 'http://127.0.0.1:1/webhook/flujo-tasa';
  const caido = await n8n.publicarTasa(tasa, opciones, [10]);
  assert.strictEqual(caido.ok, false);
  assert.strictEqual(n8n.estado().ultimoAviso.ok, false);
});

test('si el token no coincide, n8n contesta 200 pero el panel no lo da por recibido', async () => {
  const srv = await n8nFalso('otro-token');
  const n8n = require('../src/n8n');
  const r = await n8n.publicarTasa(tasa, opciones, [10, 10]);
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /N8N_TASA_TOKEN/);
  srv.close();
});

test('consultarBot lee la tasa que tiene el bot y avisa si n8n no responde', async () => {
  const srv = await n8nFalso();
  const n8n = require('../src/n8n');
  await n8n.publicarTasa(tasa, opciones, [10]);
  const bot = await n8n.consultarBot();
  assert.strictEqual(bot.ok, true);
  assert.strictEqual(bot.tasa.tasaCup, 187);
  assert.match(bot.ultimoEstado, /enviada/);
  srv.close();

  process.env.N8N_TASA_URL = 'http://127.0.0.1:1/webhook/flujo-tasa';
  assert.strictEqual((await n8n.consultarBot()).ok, false);
});
