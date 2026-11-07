const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const erp = require('../src/erp');
const { crearLibro } = require('../src/libro');

// Supuestos del Excel v2 (sin comisión PIX ni del socio en CUP).
const S = { spreadUsd: 0.01, pixFee: 0, partnerFeeCup: 0, partnerFeeUsd: 0, margin: 0.01, cushion: 0.015 };
const cerca = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

function datosExcel() {
  const d = erp.vacio();
  erp.guardarItem(d, 'lotes', { fecha: '2026-11-01', codigo: 'L2', usdt: 178, brl: 986, cupPorUsdt: 1130 });
  erp.guardarItem(d, 'lotes', { fecha: '2026-11-05', codigo: 'L3', usdt: 100, brl: 555.393, cupPorUsdt: 1130 });
  for (const [fecha, cliente, montoBrl, tasa, cupEntregados] of [
    ['2026-11-02', 'Ana', 55, 188.5, 10367.5], ['2026-11-03', 'Beto', 300, 194.5, 58350],
    ['2026-11-04', 'Carla', 120, 190, 22800], ['2026-11-04', 'Dani', 100, 190, 19000]]) {
    erp.guardarItem(d, 'envios', { fecha, cliente, montoBrl, tasa, cupEntregados, estado: 'Entregado' });
  }
  return d;
}

test('coincide con las hojas Lotes_USDT y Registro del Excel v2', () => {
  const c = erp.calcularLibro(datosExcel(), S);
  const l2 = c.lotes.find((l) => l.codigo === 'L2');
  cerca(l2.costo, 5.5393);
  cerca(l2.equilibrio, 203.9959);
  assert.strictEqual(l2.sugerida, 198.5);
  cerca(l2.disponibles, 80.1969);
  assert.strictEqual(l2.estado, 'ACTIVO');
  const e300 = c.envios.find((e) => e.montoBrl === 300);
  cerca(e300.ganancia, 13.9649);
  assert.deepStrictEqual(e300.partes.map((p) => p.lote), ['L2']);
  cerca(c.resumen.ganancia, 33.2368);
  cerca(c.resumen.margen, 0.0578, 1e-4);
  cerca(c.resumen.socio.saldo, 203622.5); // hoja «Depositos y extraccione», E17
  assert.strictEqual(c.resumen.loteActivo.codigo, 'L2');
});

test('FIFO: si el lote activo no alcanza, el resto sale del siguiente', () => {
  const d = erp.vacio();
  erp.guardarItem(d, 'lotes', { fecha: '2026-11-01', codigo: 'A', usdt: 10, brl: 55, cupPorUsdt: 1000 });
  erp.guardarItem(d, 'lotes', { fecha: '2026-11-02', codigo: 'B', usdt: 100, brl: 600, cupPorUsdt: 1000 });
  erp.guardarItem(d, 'envios', { fecha: '2026-11-03', cliente: 'Ana', montoBrl: 100, tasa: 150 }); // 15.000 CUP = 15 USDT
  const c = erp.calcularLibro(d, S);
  const e = c.envios[0];
  assert.deepStrictEqual(e.partes.map((p) => [p.lote, +p.usdt.toFixed(4)]), [['A', 10], ['B', 5]]);
  cerca(e.costo, 10 * 5.5 + 5 * 6);
  cerca(e.ganancia, 100 - 85);
  assert.strictEqual(c.lotes[0].estado, 'Agotado');
  assert.strictEqual(c.lotes[1].estado, 'ACTIVO');
  cerca(c.lotes[1].disponibles, 95);
});

test('lote fijo, envío cancelado y pérdida', () => {
  const d = erp.vacio();
  erp.guardarItem(d, 'lotes', { fecha: '2026-11-01', codigo: 'L1', usdt: 100, brl: 550, cupPorUsdt: 1130 });
  erp.guardarItem(d, 'envios', { fecha: '2026-11-02', cliente: 'X', montoBrl: 100, tasa: 210, lote: 'l1' });
  erp.guardarItem(d, 'envios', { fecha: '2026-11-02', cliente: 'Y', montoBrl: 500, tasa: 190, estado: 'Cancelado' });
  const c = erp.calcularLibro(d, S);
  const x = c.envios.find((e) => e.cliente === 'X');
  assert.strictEqual(x.lote, 'L1');
  assert.ok(x.ganancia < 0);
  assert.strictEqual(c.resumen.perdidas, 1);
  assert.strictEqual(c.resumen.envios, 1); // el cancelado no cuenta
  assert.ok(c.alertas.some((a) => a.nivel === 'error' && /pérdida/.test(a.texto)));
  assert.strictEqual(c.envios.find((e) => e.cliente === 'Y').ganancia, null);
});

test('sin lotes: el envío se guarda pero avisa que no hay costo', () => {
  const d = erp.vacio();
  erp.guardarItem(d, 'envios', { fecha: '2026-11-02', cliente: 'X', montoBrl: 100, tasa: 190 });
  const c = erp.calcularLibro(d, S);
  assert.strictEqual(c.envios[0].ganancia, null);
  assert.ok(c.envios[0].avisos.length);
});

test('validaciones', () => {
  const d = erp.vacio();
  assert.throws(() => erp.guardarItem(d, 'envios', { fecha: '2026-11-02', montoBrl: 10, tasa: 190 }), /cliente/);
  assert.throws(() => erp.guardarItem(d, 'envios', { fecha: '2026-11-02', cliente: 'X', montoBrl: 10, tasa: 190, lote: 'L9' }), /No existe el lote/);
  assert.throws(() => erp.guardarItem(d, 'envios', { fecha: '02/11/2026', cliente: 'X', montoBrl: 10, tasa: 190 }), /fecha/);
  assert.throws(() => erp.guardarItem(d, 'envios', { fecha: '2026-11-02', cliente: 'X', montoBrl: -5, tasa: 190 }));
  assert.throws(() => erp.guardarItem(d, 'nada', {}), /desconocida/);
  erp.guardarItem(d, 'lotes', { fecha: '2026-11-01', codigo: 'L1', usdt: 10, brl: 55, cupPorUsdt: 1130 });
  assert.throws(() => erp.guardarItem(d, 'lotes', { fecha: '2026-11-01', codigo: 'l1', usdt: 10, brl: 55, cupPorUsdt: 1130 }), /Ya existe/);
  const e = erp.guardarItem(d, 'envios', { fecha: '2026-11-02', cliente: ' Ana ', montoBrl: '100,5', tasa: 190, lote: 'L1' });
  assert.strictEqual(e.cliente, 'Ana');
  assert.strictEqual(e.montoBrl, 100.5);
  assert.throws(() => erp.borrarItem(d, 'lotes', d.lotes[0].id), /fijados/);
});

test('editar conserva id y fecha de creación; renombrar un lote arrastra los envíos', () => {
  const d = erp.vacio();
  const l = erp.guardarItem(d, 'lotes', { fecha: '2026-11-01', codigo: 'L1', usdt: 10, brl: 55, cupPorUsdt: 1130 });
  erp.guardarItem(d, 'envios', { fecha: '2026-11-02', cliente: 'X', montoBrl: 10, tasa: 190, lote: 'L1' });
  const l2 = erp.guardarItem(d, 'lotes', { ...l, codigo: 'L7' });
  assert.strictEqual(l2.id, l.id);
  assert.strictEqual(l2.creado, l.creado);
  assert.strictEqual(d.lotes.length, 1);
  assert.strictEqual(d.envios[0].lote, 'L7');
});

test('CSV para Excel: «;», coma decimal, BOM y sin fórmulas inyectadas', () => {
  const csv = erp.aCsv([{ a: 1.5, b: '=HYPERLINK("x")', c: 'hola; chau' }], [['a', 'A'], ['b', 'B'], ['c', 'C']]);
  assert.ok(csv.startsWith('﻿A;B;C\r\n'));
  assert.match(csv, /^﻿A;B;C\r\n1,5;"'=HYPERLINK\(""x""\)";"hola; chau"$/);
  const todo = erp.exportar(erp.calcularLibro(datosExcel(), S), 'envios');
  assert.match(todo, /Ganancia BRL/);
  assert.throws(() => erp.exportar(erp.calcularLibro(datosExcel(), S), 'nada'));
});

test('libro: guarda, relee y hace respaldo diario', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flujo-erp-'));
  try {
    const libro = crearLibro(dir);
    assert.deepStrictEqual(libro.leer().lotes, []);
    libro.modificar((d) => erp.guardarItem(d, 'gastos', { fecha: '2026-11-01', concepto: 'Chip', montoBrl: 20 }));
    libro.modificar((d) => erp.guardarItem(d, 'gastos', { fecha: '2026-11-02', concepto: 'Ads', montoBrl: 30 }));
    assert.strictEqual(libro.leer().gastos.length, 2);
    const respaldos = fs.readdirSync(path.join(dir, 'erp-respaldos'));
    assert.strictEqual(respaldos.length, 1);
    fs.writeFileSync(libro.archivo, '{roto');
    assert.throws(() => libro.leer(), /No se pudo leer erp.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
