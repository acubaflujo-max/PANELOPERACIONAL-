const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Entorno aislado: carpeta temporal y conexión por variables de entorno (antes de cargar los módulos).
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-sb-'));
process.env.FLUJOBOT_DATA = DIR;
process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_prueba';

const supabase = require('../src/supabase');
const { crearAlmacen } = require('../src/libro');
const erp = require('../src/erp');

// Supabase falso en memoria: entiende select con limit/offset, upsert por id y delete por id.
const tablas = { lotes: [], envios: [], gastos: [], tasas: [] };
const peticiones = [];
let fallarCon = null;
global.fetch = async (url, opt) => {
  peticiones.push({ url, opt });
  const u = new URL(url);
  const tabla = u.pathname.replace('/rest/v1/', '');
  const responder = (status, cuerpo) => ({ ok: status < 300, status, text: async () => (cuerpo === undefined ? '' : JSON.stringify(cuerpo)) });
  if (fallarCon) return responder(fallarCon.status, fallarCon.cuerpo);
  if (opt.method === 'GET') {
    const lim = +u.searchParams.get('limit'), off = +u.searchParams.get('offset');
    return responder(200, tablas[tabla].slice(off, off + lim));
  }
  if (opt.method === 'POST') {
    for (const fila of JSON.parse(opt.body)) {
      const i = tablas[tabla].findIndex((f) => f.id === fila.id);
      if (i >= 0) tablas[tabla][i] = fila; else tablas[tabla].push(fila);
    }
    return responder(201);
  }
  if (opt.method === 'DELETE') {
    const id = decodeURIComponent(u.searchParams.get('id').replace(/^eq\./, ''));
    tablas[tabla] = tablas[tabla].filter((f) => f.id !== id);
    return responder(204);
  }
  return responder(405, { message: 'no' });
};

const S = { spreadUsd: 0.01, pixFee: 0, partnerFeeCup: 0, partnerFeeUsd: 0, margin: 0.01, cushion: 0.015 };

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('filas ↔ registros: lote vacío es null y se envían todas las columnas', () => {
  const fila = supabase.aFila('envios', { id: 'a', creado: 1, fecha: '2026-11-02', cliente: 'Ana', montoBrl: 100, tasa: 190, lote: '', estado: 'Pendiente', tarjeta: '', telefono: '', notas: '' });
  assert.strictEqual(fila.lote, null);
  assert.strictEqual(fila.cup_entregados, null); // así editar puede vaciar el campo
  assert.strictEqual(fila.monto_brl, 100);
  const vuelta = supabase.deFila('envios', { ...fila, monto_brl: '100.50', creado: '1' });
  assert.strictEqual(vuelta.lote, '');
  assert.strictEqual(vuelta.montoBrl, 100.5);
  assert.strictEqual(vuelta.creado, 1);
  assert.ok(!('cupEntregados' in vuelta));
});

test('el panel guarda, lee y calcula igual que con el archivo local', async () => {
  const almacen = crearAlmacen(DIR);
  assert.strictEqual(almacen.modo(), 'supabase');
  await almacen.guardar('lotes', { fecha: '2026-11-01', codigo: 'L2', usdt: 178, brl: 986, cupPorUsdt: 1130 });
  await almacen.guardar('envios', { fecha: '2026-11-03', cliente: 'Beto', montoBrl: 300, tasa: 194.5, estado: 'Entregado' });
  assert.strictEqual(tablas.lotes.length, 1);
  assert.strictEqual(tablas.envios[0].monto_brl, 300);
  const c = erp.calcularLibro(await almacen.leer(), S);
  assert.ok(Math.abs(c.envios[0].ganancia - 13.9649) < 1e-3);
  // La clave nueva va solo en «apikey», nunca en Authorization.
  const h = peticiones.at(-1).opt.headers;
  assert.strictEqual(h.apikey, 'sb_secret_prueba');
  assert.ok(!('Authorization' in h));
  // Respaldo diario local de lo que había en Supabase.
  assert.ok(fs.readdirSync(path.join(DIR, 'erp-respaldos')).some((f) => /^supabase-\d{4}-\d{2}-\d{2}\.json$/.test(f)));
});

test('las validaciones siguen activas (lote repetido, lote con envíos fijados)', async () => {
  const almacen = crearAlmacen(DIR);
  await assert.rejects(almacen.guardar('lotes', { fecha: '2026-11-01', codigo: 'l2', usdt: 1, brl: 1, cupPorUsdt: 1 }), /Ya existe/);
  const lote = (await almacen.leer()).lotes[0];
  await almacen.guardar('envios', { fecha: '2026-11-04', cliente: 'X', montoBrl: 10, tasa: 190, lote: 'L2' });
  await assert.rejects(almacen.borrar('lotes', lote.id), /fijados/);
  const x = (await almacen.leer()).envios.find((e) => e.cliente === 'X');
  await almacen.borrar('envios', x.id);
  assert.ok(!tablas.envios.some((e) => e.id === x.id));
});

test('lee más de 1000 filas (paginación)', async () => {
  for (let i = 0; i < 1500; i++) tablas.gastos.push({ id: 'g' + i, creado: i, fecha: '2026-11-01', concepto: 'x', categoria: '', monto_brl: 1 });
  const d = await supabase.leerTodo();
  assert.strictEqual(d.gastos.length, 1500);
  tablas.gastos = [];
});

test('mensajes claros si la clave no sirve', async () => {
  fallarCon = { status: 401, cuerpo: { code: '42501', message: 'permission denied for table lotes' } };
  await assert.rejects(supabase.leerTodo(), /clave SECRETA/);
  fallarCon = { status: 401, cuerpo: { message: 'Invalid API key' } };
  await assert.rejects(supabase.leerTodo(), /clave inválida/);
  fallarCon = null;
});

test('si la conexión viene de variables de entorno (VPS), el panel no la puede cambiar', () => {
  assert.throws(() => supabase.normalizarConf({ url: 'https://demo.supabase.co', key: 'x' }), /variables de entorno/);
  assert.throws(() => supabase.borrarConf(), /variables de entorno/);
  assert.strictEqual(supabase.estado().desdeEntorno, true);
});
