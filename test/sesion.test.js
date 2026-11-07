const test = require('node:test');
const assert = require('node:assert');
const s = require('../src/sesion');

test('la contraseña correcta entra y la incorrecta no', () => {
  assert.strictEqual(s.claveCorrecta('secreta', 'secreta'), true);
  assert.strictEqual(s.claveCorrecta('otra', 'secreta'), false);
  assert.strictEqual(s.claveCorrecta('', 'secreta'), false);
});

test('la sesión vale 30 días y se invalida al cambiar la contraseña', () => {
  const t0 = Date.parse('2026-11-07T10:00:00Z');
  const token = s.crearSesion('secreta', t0);
  assert.strictEqual(s.sesionValida(token, 'secreta', t0 + 29 * 24 * 3600 * 1000), true);
  assert.strictEqual(s.sesionValida(token, 'secreta', t0 + 31 * 24 * 3600 * 1000), false);
  assert.strictEqual(s.sesionValida(token, 'nueva', t0 + 1000), false);
});

test('una cookie manipulada o vacía no sirve', () => {
  const token = s.crearSesion('secreta');
  const [exp, firma] = token.split('.');
  assert.strictEqual(s.sesionValida(`${Number(exp) + 99999999}.${firma}`, 'secreta'), false);
  assert.strictEqual(s.sesionValida(`${exp}.`, 'secreta'), false);
  assert.strictEqual(s.sesionValida('', 'secreta'), false);
  assert.strictEqual(s.sesionValida(undefined, 'secreta'), false);
  assert.strictEqual(s.sesionValida('basura', 'secreta'), false);
});

test('lee la cookie entre otras y arma los encabezados', () => {
  assert.strictEqual(s.leerCookie('a=1; flujo_sesion=abc.def; b=2'), 'abc.def');
  assert.strictEqual(s.leerCookie('a=1'), '');
  assert.match(s.cookieSesion('t', true), /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  assert.doesNotMatch(s.cookieSesion('t', false), /Secure/);
  assert.match(s.cookieBorrada(false), /Max-Age=0/);
});
