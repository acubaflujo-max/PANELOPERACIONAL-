// Cotización USD/BRL de referencia. Solo endpoints públicos, sin claves ni cuenta.

const FUENTES = [
  {
    nombre: 'AwesomeAPI (dólar comercial)',
    url: 'https://economia.awesomeapi.com.br/json/last/USD-BRL',
    leer: (j) => parseFloat(j.USDBRL.bid),
  },
  {
    nombre: 'Binance USDT/BRL (público)',
    url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=USDTBRL',
    leer: (j) => parseFloat(j.price),
  },
];

async function obtenerUsdBrl() {
  const errores = [];
  for (const f of FUENTES) {
    try {
      const r = await fetch(f.url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const valor = f.leer(await r.json());
      if (valor > 0) return { valor, fuente: f.nombre };
      throw new Error('valor inválido');
    } catch (e) {
      errores.push(`${f.nombre}: ${e.message}`);
    }
  }
  throw new Error(`No se pudo obtener USD/BRL (${errores.join('; ')})`);
}

module.exports = { obtenerUsdBrl };
