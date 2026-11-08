const test = require('node:test');
const assert = require('node:assert');
const { validar } = require('../src/tarjeta');

test('la tarjeta del servidor valida los datos que manda n8n', () => {
  const ok = validar({ tasaCup: '187.5', tasaPequena: 185.5, umbralBrl: 100, montoMinimoBrl: 20, turno: 'Noche' });
  assert.deepStrictEqual([ok.tasaCup, ok.tasaPequena, ok.turno], [187.5, 185.5, 'Noche']);
  // Sin tasa pequeña usa la principal; un turno raro se ignora
  const sinPeq = validar({ tasaCup: 190, turno: 'x' });
  assert.strictEqual(sinPeq.tasaPequena, 190);
  assert.strictEqual(sinPeq.turno, '');
  assert.throws(() => validar({ tasaCup: 0 }), /tasaCup/);
  assert.throws(() => validar({ tasaCup: 'abc' }), /tasaCup/);
});
