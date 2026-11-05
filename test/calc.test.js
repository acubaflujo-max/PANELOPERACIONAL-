const test = require('node:test');
const assert = require('node:assert');
const { calcular, armarMensaje, turnoActual } = require('../src/calc');

// Valores de ejemplo del Excel: USD/BRL 5,5 y CUP/USD 450 con los supuestos por defecto.
test('coincide con la hoja Calculadora del Excel', () => {
  const r = calcular({ usdBrl: 5.5, cupUsd: 450 });
  assert.ok(Math.abs(r.equilibrio - 78.5786) < 0.001);
  assert.strictEqual(r.tasaCup, 74);
  assert.ok(Math.abs(r.brlPorUsd - 5.9801) < 0.001);
});

test('la tasa siempre se redondea hacia abajo a 0,5 y nunca supera el equilibrio', () => {
  for (const [usd, cup] of [[5.52, 448], [5.55, 452], [5.1, 520], [6, 400]]) {
    const r = calcular({ usdBrl: usd, cupUsd: cup });
    assert.strictEqual((r.tasaCup * 2) % 1, 0);
    assert.ok(r.tasaCup < r.equilibrio);
  }
});

test('rechaza entradas inválidas', () => {
  assert.throws(() => calcular({ usdBrl: 0, cupUsd: 450 }));
  assert.throws(() => calcular({ usdBrl: 5.5, cupUsd: NaN }));
});

test('el mensaje usa coma decimal y el turno', () => {
  const m = armarMensaje({ tasaCup: 74 }, { turno: 'Tarde', fecha: new Date(2026, 10, 1) });
  assert.match(m, /01\/11 · Turno Tarde/);
  assert.match(m, /1 BRL = \*74,0 CUP\*/);
  assert.doesNotMatch(m, /USD/);
});

test('turno según la hora', () => {
  assert.strictEqual(turnoActual(new Date(2026, 10, 1, 9)), 'Mañana');
  assert.strictEqual(turnoActual(new Date(2026, 10, 1, 14)), 'Tarde');
  assert.strictEqual(turnoActual(new Date(2026, 10, 1, 21)), 'Noche');
});
