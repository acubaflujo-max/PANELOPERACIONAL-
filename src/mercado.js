// Evolución de USDT/BRL en Binance (endpoints públicos, sin clave) y una señal de tendencia simple.
// La señal es orientativa: combina medias móviles, momentum y RSI; no es una predicción fiable.

const BASE = 'https://data-api.binance.vision/api/v3/klines?symbol=USDTBRL';
const CACHE_MS = 60_000;
let cache = null;

const ema = (valores, n) => {
  const k = 2 / (n + 1);
  return valores.reduce((acc, v, i) => (i === 0 ? v : v * k + acc * (1 - k)), 0);
};

function rsi(cierres, n = 14) {
  const ult = cierres.slice(-(n + 1));
  if (ult.length < n + 1) return null;
  let sube = 0, baja = 0;
  for (let i = 1; i < ult.length; i++) {
    const d = ult[i] - ult[i - 1];
    if (d > 0) sube += d; else baja -= d;
  }
  if (baja === 0) return 100;
  return 100 - 100 / (1 + sube / baja);
}

// Pendiente de la recta de mínimos cuadrados, en % del precio medio por hora.
function pendientePct(cierres) {
  const n = cierres.length;
  const mx = (n - 1) / 2;
  const my = cierres.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  cierres.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return (num / den / my) * 100;
}

const pct = (a, b) => ((a - b) / b) * 100;

// cierresHora: cierres horarios (más antiguo primero), idealmente 168 (7 días).
function analizar(cierresHora) {
  if (cierresHora.length < 30) throw new Error('Pocos datos para analizar');
  const actual = cierresHora.at(-1);
  const ult24 = cierresHora.slice(-25);
  const ult7d = cierresHora.slice(-168);
  const emaRapida = ema(cierresHora.slice(-60), 12);
  const emaLenta = ema(cierresHora.slice(-60), 26);
  const cruce = pct(emaRapida, emaLenta);
  const cambio24h = pct(actual, ult24[0]);
  const cambio7d = pct(actual, ult7d[0]);
  const rsi14 = rsi(cierresHora);
  const pend = pendientePct(ult24);

  const razones = [];
  let score = 0;
  if (Math.abs(cruce) >= 0.05) {
    score += cruce > 0 ? 1 : -1;
    razones.push(`Media corta ${cruce > 0 ? 'por encima' : 'por debajo'} de la larga (${cruce > 0 ? '+' : ''}${cruce.toFixed(2)} %)`);
  }
  if (Math.abs(cambio24h) >= 0.3) {
    score += cambio24h > 0 ? 1 : -1;
    razones.push(`Últimas 24 h: ${cambio24h > 0 ? '+' : ''}${cambio24h.toFixed(2)} %`);
  }
  if (Math.abs(pend) >= 0.004) {
    score += pend > 0 ? 0.5 : -0.5;
    razones.push(`Pendiente de las últimas 24 h ${pend > 0 ? 'ascendente' : 'descendente'}`);
  }
  if (rsi14 !== null) {
    if (rsi14 >= 70) { score -= 0.5; razones.push(`RSI ${rsi14.toFixed(0)}: sobrecompra, posible corrección a la baja`); }
    else if (rsi14 <= 30) { score += 0.5; razones.push(`RSI ${rsi14.toFixed(0)}: sobreventa, posible rebote`); }
  }

  const direccion = score >= 1 ? 'subir' : score <= -1 ? 'bajar' : 'lateral';
  const confianza = Math.abs(score) >= 2.5 ? 'media' : 'baja';
  if (!razones.length) razones.push('Sin movimiento claro en las últimas 24 h');

  return {
    direccion, confianza, score: Number(score.toFixed(1)), razones,
    rsi: rsi14 === null ? null : Number(rsi14.toFixed(1)),
    cambio24h: Number(cambio24h.toFixed(2)),
    cambio7d: Number(cambio7d.toFixed(2)),
    max7d: Math.max(...ult7d), min7d: Math.min(...ult7d), actual,
  };
}

// Qué significa para la tasa CUP/BRL: si el dólar sube frente al real, cada real compra menos.
function implicacion(direccion) {
  if (direccion === 'subir') return 'USDT/BRL tiende a subir (el real se debilita): tu tasa CUP/BRL probablemente tendrá que bajar. No la subas y revisa antes de publicar.';
  if (direccion === 'bajar') return 'USDT/BRL tiende a bajar (el real se fortalece): podrías mejorar la tasa CUP/BRL un poco, pero no te adelantes al mercado.';
  return 'Mercado lateral: sin razón técnica para mover la tasa.';
}

async function klines(intervalo, limite) {
  const r = await fetch(`${BASE}&interval=${intervalo}&limit=${limite}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Binance respondió HTTP ${r.status}`);
  const filas = await r.json();
  return filas.map((k) => ({ t: k[0], c: parseFloat(k[4]) }));
}

async function obtenerMercado() {
  if (cache && Date.now() - cache.en < CACHE_MS) return cache.datos;
  const [horas, dias] = await Promise.all([klines('1h', 168), klines('1d', 30)]);
  const senal = analizar(horas.map((k) => k.c));
  const datos = { simbolo: 'USDT/BRL', horas, dias, senal, implicacion: implicacion(senal.direccion), actualizado: Date.now() };
  cache = { en: Date.now(), datos };
  return datos;
}

module.exports = { obtenerMercado, analizar, implicacion };
