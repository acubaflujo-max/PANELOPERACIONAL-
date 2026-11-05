// Misma fórmula que las hojas Calculadora y Tasas_Diarias de Modelo_Remesas_Flujo_Cuba.xlsx.

const DEFAULT_SUPUESTOS = {
  spreadUsd: 0.01, // Supuestos!B5 spread al convertir BRL a USD
  pixFee: 0, // B6 comisión de cobro PIX/banco
  partnerFeeCup: 0.03, // B8 comisión del socio, entrega en CUP
  partnerFeeUsd: 0.02, // B9 comisión del socio, entrega en USD
  margin: 0.04, // B11 margen objetivo
  cushion: 0.015, // B12 colchón por volatilidad
};

function calcular({ usdBrl, cupUsd }, s = DEFAULT_SUPUESTOS) {
  if (!(usdBrl > 0) || !(cupUsd > 0)) {
    throw new Error('USD/BRL y CUP por USD deben ser números mayores que 0');
  }
  const equilibrio =
    (cupUsd * (1 - s.pixFee) * (1 - s.partnerFeeCup)) / (usdBrl * (1 + s.spreadUsd));
  const tasaCup = Math.floor(equilibrio * (1 - s.margin - s.cushion) * 2) / 2;
  const brlPorUsd =
    ((usdBrl * (1 + s.spreadUsd)) / ((1 - s.pixFee) * (1 - s.partnerFeeUsd))) *
    (1 + s.margin + s.cushion);
  return { equilibrio, tasaCup, brlPorUsd };
}

function turnoActual(fecha = new Date()) {
  const h = fecha.getHours();
  return h < 12 ? 'Mañana' : h < 18 ? 'Tarde' : 'Noche';
}

const fmt = (n, dec) => n.toFixed(dec).replace('.', ',');

// Solo se publica la tasa de envío en CUP por real; la entrega en USD no se anuncia.
function armarMensaje({ tasaCup }, { turno, fecha = new Date() }) {
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  return [
    '🇧🇷 *FLUJO CUBA REMESAS* 🇨🇺',
    `📅 ${dd}/${mm} · Turno ${turno}`,
    '',
    '💱 *Envío en CUP*',
    `1 BRL = *${fmt(tasaCup, 1)} CUP*`,
    '',
    'Tasa vigente hasta la próxima actualización.',
    'Escríbenos para hacer tu envío ✉️',
  ].join('\n');
}

module.exports = { DEFAULT_SUPUESTOS, calcular, turnoActual, armarMensaje };
