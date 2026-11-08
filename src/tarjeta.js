// Genera en el servidor la misma tarjeta de la tasa que dibuja el navegador (public/tarjeta.js).
// Necesita @napi-rs/canvas (solo en el servidor): en local el panel funciona sin ella.

const T = require('../public/tarjeta.js');

function numero(v, nombre, max = 100000) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new Error(`«${nombre}» debe ser un número válido`);
  return n;
}

function validar(b) {
  return {
    tasaCup: numero(b.tasaCup, 'tasaCup'),
    tasaPequena: numero(b.tasaPequena ?? b.tasaCup, 'tasaPequena'),
    umbralBrl: numero(b.umbralBrl ?? 100, 'umbralBrl'),
    montoMinimoBrl: numero(b.montoMinimoBrl ?? 20, 'montoMinimoBrl'),
    turno: ['Mañana', 'Tarde', 'Noche'].includes(b.turno) ? b.turno : '',
    zona: 'America/Sao_Paulo',
  };
}

function png(body) {
  let canvas;
  try { canvas = require('@napi-rs/canvas'); } catch { throw new Error('Este servidor no tiene instalada la librería @napi-rs/canvas (npm install)'); }
  const c = canvas.createCanvas(T.W, T.H);
  T.dibujar(c.getContext('2d'), validar(body));
  return c.toBuffer('image/png');
}

module.exports = { png, validar };
