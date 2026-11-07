const test = require('node:test');
const assert = require('node:assert');
const { calcular, armarMensaje, turnoActual, armarPlantillaDatos, armarOperacion } = require('../src/calc');

// Valores de ejemplo del Excel: USD/BRL 5,5 y CUP/USD 450 con los supuestos por defecto.
test('coincide con la hoja Calculadora del Excel', () => {
  const r = calcular({ usdBrl: 5.5, cupUsd: 450 });
  assert.ok(Math.abs(r.equilibrio - 81.0081) < 0.001); // sin comisión de socio
  assert.strictEqual(r.tasaCup, 76.5);
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
  const m = armarMensaje({ tasaCup: 74, tasaPequena: 72 }, { turno: 'Tarde', fecha: new Date(2026, 10, 1) });
  assert.match(m, /01\/11 · Turno Tarde/);
  assert.match(m, /1 BRL = \*74,0 CUP\*/);
  assert.doesNotMatch(m, /USD/);
  assert.match(m, /Menos de 100 BRL: 1 BRL = \*72,0 CUP\*/);
  assert.match(m, /Envío mínimo: 20 BRL/);
  assert.match(m, /unir a cualquier persona[^\n]*\nhttps:\/\/chat\.whatsapp\.com\/\w+$/);
  assert.match(m, /Escríbenos para hacer tu envío/);
  assert.doesNotMatch(m, /wa\.me/);
});

test('con número de contacto, el mensaje lleva el enlace que abre el chat', () => {
  const m = armarMensaje({ tasaCup: 74, tasaPequena: 72 }, { turno: 'Tarde', fecha: new Date(2026, 10, 1), contacto: '5511999998888' });
  assert.match(m, /Toca aquí para hacer tu envío:\*\nhttps:\/\/wa\.me\/5511999998888\?text=Hola%2C%20quiero%20hacer%20un%20env%C3%ADo%20a%20Cuba\n/);
  assert.doesNotMatch(m, /Escríbenos/);
  assert.match(m, /chat\.whatsapp\.com\/\w+$/);
});

test('plantilla de datos: pide los 4 datos y, con monto, cotiza en CUP', () => {
  const base = armarPlantillaDatos({});
  for (const dato of ['Nombre y apellidos completos del titular', 'Número de la tarjeta', 'Teléfono en Cuba', 'Comprobante del PIX']) {
    assert.match(base, new RegExp(dato));
  }
  assert.doesNotMatch(base, /Envías|Pago por PIX/);

  const c = armarPlantillaDatos({ montoBrl: 100, tasa: 184.5, pix: 'Chave PIX: abc' });
  assert.match(c, /Envías: \*R\$ 100,00\*/);
  assert.match(c, /Tu familia recibe: \*18\.450 CUP\* \(1 BRL = 184,5 CUP\)/);
  assert.match(c, /Pago por PIX\*\nChave PIX: abc/);
  assert.match(armarPlantillaDatos({ montoBrl: 55, tasa: 179.5 }), /9\.872,5 CUP/);
});

test('operación para el grupo: tarjeta en grupos de 4, total en CUP y datos de contacto', () => {
  const m = armarOperacion({ cliente: ' Ana Pérez ', telefonoCliente: '+55 48 99999-8888', tarjeta: '9238-1299 79598952', confirmar: '56530422', montoBrl: 100, tasa: 190 }, new Date(2026, 10, 7, 9, 5));
  assert.match(m, /07\/11 · 09:05/);
  assert.match(m, /Cliente:\* Ana Pérez\n/);
  assert.match(m, /Número del cliente:\* \+55 48 99999-8888/);
  assert.match(m, /Tarjeta:\* 9238 1299 7959 8952/);
  assert.match(m, /Número a confirmar:\* 56530422/);
  assert.match(m, /Monto:\* R\$ 100,00/);
  assert.match(m, /1 BRL = 190,0 CUP/);
  assert.match(m, /Total a pasar:\* 19\.000 CUP/);
  assert.match(armarOperacion({ cliente: 'X', tarjeta: '9238129979598952', montoBrl: 55, tasa: 179.5 }), /9\.872,5 CUP[\s\S]*$/);
  assert.throws(() => armarOperacion({ cliente: 'X', tarjeta: '1234', montoBrl: 10, tasa: 190 }), /16 dígitos/);
  assert.throws(() => armarOperacion({ cliente: '', tarjeta: '9238129979598952', montoBrl: 10, tasa: 190 }), /cliente/);
});

test('turno según la hora', () => {
  assert.strictEqual(turnoActual(new Date(2026, 10, 1, 9)), 'Mañana');
  assert.strictEqual(turnoActual(new Date(2026, 10, 1, 14)), 'Tarde');
  assert.strictEqual(turnoActual(new Date(2026, 10, 1, 21)), 'Noche');
});
