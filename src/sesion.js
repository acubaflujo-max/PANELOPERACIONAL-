// Sesión del panel con solo contraseña: una cookie firmada que dura 30 días.
// Sin estado en el servidor: cambiar PANEL_PASSWORD cierra todas las sesiones abiertas.

const crypto = require('crypto');

const DURACION_MS = 30 * 24 * 3600 * 1000;
const NOMBRE_COOKIE = 'flujo_sesion';

const hash = (s) => crypto.createHash('sha256').update(s).digest();
const firmar = (exp, clave) => crypto.createHmac('sha256', hash('flujo-sesion:' + clave)).update(String(exp)).digest('hex');

function claveCorrecta(intento, clave) {
  return crypto.timingSafeEqual(hash(String(intento)), hash(clave));
}

function crearSesion(clave, ahora = Date.now()) {
  const exp = ahora + DURACION_MS;
  return `${exp}.${firmar(exp, clave)}`;
}

function sesionValida(token, clave, ahora = Date.now()) {
  const [exp, firma] = String(token || '').split('.');
  if (!/^\d+$/.test(exp || '') || !firma || Number(exp) < ahora) return false;
  const esperada = Buffer.from(firmar(exp, clave));
  const recibida = Buffer.from(firma);
  return recibida.length === esperada.length && crypto.timingSafeEqual(recibida, esperada);
}

function leerCookie(cabecera, nombre = NOMBRE_COOKIE) {
  for (const par of String(cabecera || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim() === nombre) return par.slice(i + 1).trim();
  }
  return '';
}

function cookieSesion(token, seguro) {
  return `${NOMBRE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACION_MS / 1000}${seguro ? '; Secure' : ''}`;
}

function cookieBorrada(seguro) {
  return `${NOMBRE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro ? '; Secure' : ''}`;
}

module.exports = { claveCorrecta, crearSesion, sesionValida, leerCookie, cookieSesion, cookieBorrada };
