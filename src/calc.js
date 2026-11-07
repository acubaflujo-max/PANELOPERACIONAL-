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

const numBr = (n, dec) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);

// Mensaje para pedirle al cliente lo necesario para la remesa; con monto, dice también cuántos CUP llegan.
function armarPlantillaDatos({ montoBrl, tasa, pix = '' } = {}) {
  const cup = montoBrl * tasa;
  const cotizacion = montoBrl > 0 && tasa > 0
    ? ['', `Envías: *R$ ${numBr(montoBrl, 2)}*`, `Tu familia recibe: *${numBr(cup, Number.isInteger(cup) ? 0 : 1)} CUP* (1 BRL = ${fmt(tasa, 1)} CUP)`]
    : [];
  return [
    '✅ *Datos para tu envío*',
    ...cotizacion,
    '',
    'Para hacerlo, mándame por aquí:',
    '1️⃣ Nombre y apellidos completos del titular de la tarjeta en Cuba',
    '2️⃣ Número de la tarjeta en CUP (16 dígitos)',
    '3️⃣ Teléfono en Cuba para confirmar la entrega',
    '4️⃣ Comprobante del PIX',
    ...(pix ? ['', '💳 *Pago por PIX*', pix] : []),
    '',
    '⚠️ Revisa bien el número de la tarjeta: con un dígito equivocado el dinero llega a otra persona.',
    '',
    'En cuanto tenga todo, hago el envío y te confirmo por aquí ✅',
  ].join('\n');
}

// Tarjeta en grupos de 4; acepta espacios o guiones y exige 16 dígitos.
function formatearTarjeta(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length !== 16) throw new Error('La tarjeta debe tener 16 dígitos');
  return d.replace(/(\d{4})(?=\d)/g, '$1 ');
}

// Mensaje para el grupo de operaciones: todo lo que el socio necesita para pasar los CUP.
function armarOperacion({ cliente, telefonoCliente = '', tarjeta, confirmar = '', montoBrl, tasa }, fecha = new Date()) {
  const nombre = String(cliente || '').trim();
  if (!nombre) throw new Error('Falta el nombre del cliente');
  if (!(montoBrl > 0) || !(tasa > 0)) throw new Error('Faltan el monto y la tasa');
  const cup = montoBrl * tasa;
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  return [
    '🆕 *NUEVA OPERACIÓN*',
    `📅 ${dd}/${mm} · ${hh}:${mi}`,
    '',
    `👤 *Cliente:* ${nombre}`,
    `📱 *Número del cliente:* ${String(telefonoCliente).trim() || '—'}`,
    `💳 *Tarjeta:* ${formatearTarjeta(tarjeta)}`,
    `📞 *Número a confirmar:* ${String(confirmar).trim() || '—'}`,
    '',
    `💵 *Monto:* R$ ${numBr(montoBrl, 2)}`,
    `💱 *Cambio:* 1 BRL = ${fmt(tasa, 1)} CUP`,
    `🇨🇺 *Total a pasar:* ${numBr(cup, Number.isInteger(cup) ? 0 : 1)} CUP`,
  ].join('\n');
}

module.exports = { DEFAULT_SUPUESTOS, DEFAULT_TARIFA, DEFAULT_ENLACE, calcular, turnoActual, armarMensaje, enlaceContacto, armarPlantillaDatos, formatearTarjeta, armarOperacion };
