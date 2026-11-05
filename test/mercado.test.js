const test = require('node:test');
const assert = require('node:assert');
const { analizar } = require('../src/mercado');

const serie = (f) => Array.from({ length: 168 }, (_, i) => f(i));

test('serie al alza → subir', () => {
  const r = analizar(serie((i) => 5 + i * 0.005));
  assert.strictEqual(r.direccion, 'subir');
  assert.ok(r.cambio24h > 0);
});

test('serie a la baja → bajar', () => {
  const r = analizar(serie((i) => 6 - i * 0.005));
  assert.strictEqual(r.direccion, 'bajar');
});

test('serie plana → lateral', () => {
  const r = analizar(serie(() => 5.5));
  assert.strictEqual(r.direccion, 'lateral');
});

test('pocos datos → error', () => {
  assert.throws(() => analizar([5, 5.1]));
});
