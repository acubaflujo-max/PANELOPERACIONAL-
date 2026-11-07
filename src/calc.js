// Misma fórmula que las hojas Calculadora y Tasas_Diarias de Modelo_Remesas_Flujo_Cuba.xlsx.

const DEFAULT_SUPUESTOS = {
  spreadUsd: 0.01, // Supuestos!B5 spread al convertir BRL a USD
  pixFee: 0, // B6 comisión de cobro PIX/banco
  partnerFeeCup: 0, // B8 comisión del socio, entrega en CUP (sin comisión de socio)
  partnerFeeUsd: 0.02, // B9 comisión del socio, entrega en USD
  margin: 0.04, // B11 margen objetivo
  cushion: 0.015, // B12 colchón por volatilidad
};

// Tramos por monto en reales. Los envíos por debajo del umbral usan una tasa más baja (restaCup menos CUP por BRL).
const DEFAULT_TARIFA = { montoMinimoBrl: 20, umbralBrl: 100, restaCup: 2 };

const DEFAULT_ENLACE = 'https://chat.whatsapp.com/Bt9vc5sUWGiDJIo84A5viX';

function calcular({ usdBrl, cupUsd }, s = DEFAULT_SUPUESTOS, tarifa = DEFAULT_TARIFA) {
  if (!(usdBrl > 0) || !(cupUsd > 0)) {
    throw new Error('USD/BRL y CUP por USD deben ser números mayores que 0');
  }
  const equilibrio =
    (cupUsd * (1 - s.pixFee) * (1 - s.partnerFeeCup)) / (usdBrl * (1 + s.spreadUsd));
  const tasaCup = Math.floor(equilibrio * (1 - s.margin - s.cushion) * 2) / 2;
  const brlPorUsd =
    ((usdBrl * (1 + s.spreadUsd)) / ((1 - s.pixFee) * (1 - s.partnerFeeUsd))) *
    (1 + s.margin + s.cushion);
  const tasaPequena = Math.max(Math.floor((tasaCup - (tarifa.restaCup || 0)) * 2) / 2, 0);
  return { equilibrio, tasaCup, tasaPequena, brlPorUsd };
}

function turnoActual(fecha = new Date()) {
  const h = fecha.getHours();
  return h < 12 ? 'Mañana' : h < 18 ? 'Tarde' : 'Noche';
}

const fmt = (n, dec) => n.toFixed(dec).replace('.', ',');

// Enlace que abre el chat con el negocio y el texto ya escrito: hace de botón en cualquier teléfono.
const enlaceContacto = (numero) =>
  `https://wa.me/${numero}?text=${encodeURIComponent('Hola, quiero hacer un envío a Cuba')}`;

// Solo se publica la tasa de envío en CUP por real; la entrega en USD no se anuncia.
function armarMensaje({ tasaCup, tasaPequena }, { turno, fecha = new Date(), tarifa = DEFAULT_TARIFA, enlace = DEFAULT_ENLACE, contacto = '' }) {
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  return [
    '🇧🇷 *FLUJO CUBA REMESAS* 🇨🇺',
    `📅 ${dd}/${mm} · Turno ${turno}`,
    '',
    '💱 *Envío en CUP*',
    `Desde ${tarifa.umbralBrl} BRL: 1 BRL = *${fmt(tasaCup, 1)} CUP*`,
    `Menos de ${tarifa.umbralBrl} BRL: 1 BRL = *${fmt(tasaPequena, 1)} CUP*`,
    `Envío mínimo: ${tarifa.montoMinimoBrl} BRL`,
    '',
    'Tasa vigente hasta la próxima actualización.',
    ...(contacto ? ['', '📲 *Toca aquí para hacer tu envío:*', enlaceContacto(contacto)] : ['Escríbenos para hacer tu envío ✉️']),
    '',
    '👥 Puedes unir a cualquier persona al grupo con este enlace:',
    enlace,
  ].join('\n');
}

module.exports = { DEFAULT_SUPUESTOS, DEFAULT_TARIFA, DEFAULT_ENLACE, calcular, turnoActual, armarMensaje, enlaceContacto };
