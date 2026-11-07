// Libro del negocio: lotes de USDT, envíos, gastos y tasas publicadas.
// Mismas fórmulas que las hojas Lotes_USDT y Registro de Modelo_Remesas_Flujo_Cuba_v2.xlsx:
//   costo del lote = BRL pagados / USDT comprados
//   USDT usados por envío = CUP entregados / (CUP por USDT del lote × (1 − comisión socio))
//   costo real = USDT usados × costo del lote / (1 − comisión PIX)
//   ganancia = monto cobrado − costo real
// Los envíos sin lote fijo se asignan solos al lote más antiguo con saldo (FIFO) y,
// si ese lote no alcanza, el resto se toma del siguiente.

const EPS = 1e-6;
const ESTADOS = ['Pendiente', 'Entregado', 'Cancelado'];
const TURNOS = ['Mañana', 'Tarde', 'Noche'];

// Campos de cada colección: tipo, si es obligatorio y valor por defecto.
const ESQUEMAS = {
  lotes: {
    fecha: { tipo: 'fecha', req: true },
    codigo: { tipo: 'texto', req: true, max: 20 },
    usdt: { tipo: 'num', req: true, positivo: true },
    brl: { tipo: 'num', req: true, positivo: true },
    cupPorUsdt: { tipo: 'num', req: true, positivo: true },
    usadosPrevios: { tipo: 'num', def: 0 },
    notas: { tipo: 'texto', max: 300 },
  },
  envios: {
    fecha: { tipo: 'fecha', req: true },
    cliente: { tipo: 'texto', req: true, max: 80 },
    montoBrl: { tipo: 'num', req: true, positivo: true },
    tasa: { tipo: 'num', req: true, positivo: true },
    cupEntregados: { tipo: 'num', positivo: true }, // vacío = monto × tasa
    lote: { tipo: 'texto', max: 20 }, // vacío = FIFO automático
    estado: { tipo: 'opcion', opciones: ESTADOS, def: 'Pendiente' },
    tarjeta: { tipo: 'texto', max: 40 },
    telefono: { tipo: 'texto', max: 30 },
    notas: { tipo: 'texto', max: 300 },
  },
  gastos: {
    fecha: { tipo: 'fecha', req: true },
    concepto: { tipo: 'texto', req: true, max: 120 },
    categoria: { tipo: 'texto', max: 40 },
    montoBrl: { tipo: 'num', req: true, positivo: true },
  },
  tasas: {
    fecha: { tipo: 'fecha', req: true },
    turno: { tipo: 'opcion', opciones: TURNOS, def: 'Mañana' },
    tasaCup: { tipo: 'num', req: true, positivo: true },
    tasaPequena: { tipo: 'num', positivo: true },
    usdBrl: { tipo: 'num', positivo: true },
    cupUsd: { tipo: 'num', positivo: true },
    notas: { tipo: 'texto', max: 300 },
  },
};

const NOMBRES = { lotes: 'lote', envios: 'envío', gastos: 'gasto', tasas: 'tasa' };

function vacio() {
  return { version: 1, lotes: [], envios: [], gastos: [], tasas: [] };
}

function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Valida y normaliza un registro. Lanza Error con un mensaje para el panel si algo está mal.
function validar(coleccion, item, datos) {
  const esquema = ESQUEMAS[coleccion];
  if (!esquema) throw new Error('Colección desconocida');
  const out = {};
  for (const [campo, e] of Object.entries(esquema)) {
    let v = item?.[campo];
    if (typeof v === 'string') v = v.trim();
    if (v === undefined || v === null || v === '') {
      if (e.req) throw new Error(`Falta «${campo}» en el ${NOMBRES[coleccion]}`);
      if (e.def !== undefined) out[campo] = e.def;
      else if (e.tipo === 'texto') out[campo] = '';
      continue;
    }
    if (e.tipo === 'num') {
      v = Number(typeof v === 'string' ? v.replace(',', '.') : v);
      if (!Number.isFinite(v) || v < 0 || v > 1e12) throw new Error(`«${campo}» debe ser un número válido`);
      if (e.positivo && v <= 0) throw new Error(`«${campo}» debe ser mayor que 0`);
    } else if (e.tipo === 'fecha') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new Error(`«${campo}» debe ser una fecha (AAAA-MM-DD)`);
    } else if (e.tipo === 'opcion') {
      if (!e.opciones.includes(v)) throw new Error(`«${campo}» debe ser: ${e.opciones.join(', ')}`);
    } else {
      v = String(v).slice(0, e.max || 200);
    }
    out[campo] = v;
  }
  out.id = typeof item.id === 'string' && item.id ? item.id : nuevoId();
  const previo = datos?.[coleccion]?.find((x) => x.id === out.id);
  out.creado = previo?.creado || Date.now();

  if (coleccion === 'lotes') {
    out.codigo = out.codigo.toUpperCase();
    if (datos?.lotes.some((l) => l.codigo === out.codigo && l.id !== out.id)) throw new Error(`Ya existe el lote ${out.codigo}`);
    if (out.usadosPrevios > out.usdt) throw new Error('Los USDT usados no pueden ser más que los comprados');
  }
  if (coleccion === 'envios' && !/\p{L}/u.test(out.cliente)) {
    throw new Error('Escribe el nombre del cliente (no solo un número)');
  }
  if (coleccion === 'envios' && out.lote) {
    out.lote = out.lote.toUpperCase();
    if (datos && !datos.lotes.some((l) => l.codigo === out.lote)) throw new Error(`No existe el lote ${out.lote}`);
  }
  return out;
}

function guardarItem(datos, coleccion, item) {
  const limpio = validar(coleccion, item, datos);
  const lista = datos[coleccion];
  const i = lista.findIndex((x) => x.id === limpio.id);
  if (coleccion === 'lotes' && i >= 0 && lista[i].codigo !== limpio.codigo) {
    // Renombrar un lote: los envíos fijados a él lo siguen.
    for (const e of datos.envios) if (e.lote === lista[i].codigo) e.lote = limpio.codigo;
  }
  if (i >= 0) lista[i] = limpio; else lista.push(limpio);
  return limpio;
}

function borrarItem(datos, coleccion, id) {
  if (!ESQUEMAS[coleccion]) throw new Error('Colección desconocida');
  const lista = datos[coleccion];
  const i = lista.findIndex((x) => x.id === id);
  if (i < 0) throw new Error('No encontrado');
  if (coleccion === 'lotes' && datos.envios.some((e) => e.lote === lista[i].codigo)) {
    throw new Error(`Hay envíos fijados al lote ${lista[i].codigo}: cámbialos antes de borrarlo`);
  }
  lista.splice(i, 1);
}

const cronologico = (a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.creado - b.creado);
const redondea = (n, d = 4) => (n === null || n === undefined ? n : Math.round(n * 10 ** d) / 10 ** d);
const tasaSugerida = (eq, s) => Math.floor(eq * (1 - s.margin - s.cushion) * 2) / 2;

function calcularLibro(datos, s, opciones = {}) {
  const alertaUsdt = opciones.alertaUsdt ?? 50;
  const feeCup = 1 - s.partnerFeeCup;
  const lotes = [...datos.lotes].sort(cronologico).map((l) => {
    const costo = l.brl / l.usdt;
    const equilibrio = (l.cupPorUsdt * (1 - s.pixFee) * feeCup) / costo;
    return {
      ...l, costo, equilibrio, sugerida: tasaSugerida(equilibrio, s),
      cupSocio: l.usdt * l.cupPorUsdt * feeCup,
      disponibles: l.usdt - (l.usadosPrevios || 0), usadosEnvios: 0, ganancia: 0, envios: 0,
    };
  });
  const porCodigo = Object.fromEntries(lotes.map((l) => [l.codigo, l]));

  const envios = [...datos.envios].sort(cronologico).map((e) => {
    const cup = e.cupEntregados || e.montoBrl * e.tasa;
    const r = { ...e, cup, partes: [], usdt: null, costo: null, ganancia: null, margen: null, avisos: [] };
    if (e.estado === 'Cancelado') return r;

    const tomar = (lote, cupParte) => {
      const usdt = cupParte / (lote.cupPorUsdt * feeCup);
      lote.disponibles -= usdt;
      lote.usadosEnvios += usdt;
      r.partes.push({ lote: lote.codigo, usdt, cup: cupParte, costo: usdt * lote.costo });
    };
    if (e.lote) {
      const lote = porCodigo[e.lote];
      if (!lote) r.avisos.push(`El lote ${e.lote} no existe`);
      else {
        tomar(lote, cup);
        if (lote.disponibles < -EPS) r.avisos.push(`El lote ${lote.codigo} quedó en negativo`);
      }
    } else {
      let resta = cup;
      for (const lote of lotes) {
        if (resta <= EPS) break;
        if (lote.disponibles <= EPS) continue;
        const parte = Math.min(resta, lote.disponibles * lote.cupPorUsdt * feeCup);
        tomar(lote, parte);
        resta -= parte;
      }
      if (resta > EPS) {
        // Sin fondo suficiente: el resto se estima con el último lote y se avisa.
        const ultimo = lotes.at(-1);
        if (ultimo) {
          tomar(ultimo, resta);
          r.avisos.push('Sin fondo USDT suficiente: costo estimado con el último lote');
        } else {
          r.avisos.push('No hay lotes de USDT registrados: no se puede calcular el costo');
        }
      }
    }
    if (r.partes.length) {
      r.usdt = r.partes.reduce((a, p) => a + p.usdt, 0);
      r.costo = r.partes.reduce((a, p) => a + p.costo, 0) / (1 - s.pixFee);
      r.ganancia = e.montoBrl - r.costo;
      r.margen = r.ganancia / e.montoBrl;
      // La ganancia se reparte entre los lotes en proporción a su costo.
      const costoBruto = r.partes.reduce((a, p) => a + p.costo, 0);
      for (const p of r.partes) {
        const lote = porCodigo[p.lote];
        lote.ganancia += r.ganancia * (costoBruto ? p.costo / costoBruto : 1 / r.partes.length);
        lote.envios += 1;
      }
    }
    return r;
  });

  let activo = null;
  for (const l of lotes) {
    if (l.disponibles <= EPS) l.estado = 'Agotado';
    else if (!activo) { l.estado = 'ACTIVO'; activo = l; } else l.estado = 'En espera';
    l.valorSaldo = Math.max(l.disponibles, 0) * l.costo;
  }

  // Clientes: se agrupan por nombre (sin distinguir mayúsculas) a partir de los envíos.
  const mapaClientes = new Map();
  for (const e of envios) {
    if (e.estado === 'Cancelado') continue;
    const k = e.cliente.toLowerCase();
    const c = mapaClientes.get(k) || { nombre: e.cliente, envios: 0, brl: 0, cup: 0, ganancia: 0, primera: e.fecha, ultima: e.fecha, tarjeta: '', telefono: '' };
    c.envios += 1; c.brl += e.montoBrl; c.cup += e.cup; c.ganancia += e.ganancia || 0;
    c.ultima = e.fecha; c.nombre = e.cliente;
    if (e.tarjeta) c.tarjeta = e.tarjeta;
    if (e.telefono) c.telefono = e.telefono;
    mapaClientes.set(k, c);
  }
  const clientes = [...mapaClientes.values()].sort((a, b) => b.brl - a.brl);

  // Resultados por mes y por día.
  const acumular = (mapa, clave) => {
    if (!mapa.has(clave)) mapa.set(clave, { periodo: clave, envios: 0, brl: 0, cup: 0, costo: 0, ganancia: 0, perdidas: 0, gastos: 0 });
    return mapa.get(clave);
  };
  const meses = new Map(), dias = new Map();
  for (const e of envios) {
    if (e.estado === 'Cancelado' || e.ganancia === null) continue;
    for (const m of [acumular(meses, e.fecha.slice(0, 7)), acumular(dias, e.fecha)]) {
      m.envios += 1; m.brl += e.montoBrl; m.cup += e.cup; m.costo += e.costo; m.ganancia += e.ganancia;
      if (e.ganancia < 0) m.perdidas += 1;
    }
  }
  for (const g of datos.gastos) {
    acumular(meses, g.fecha.slice(0, 7)).gastos += g.montoBrl;
    acumular(dias, g.fecha).gastos += g.montoBrl;
  }
  const cerrar = (m) => ({ ...m, neto: m.ganancia - m.gastos, margen: m.brl ? m.ganancia / m.brl : null });
  const porMes = [...meses.values()].map(cerrar).sort((a, b) => a.periodo.localeCompare(b.periodo));
  const porDia = [...dias.values()].map(cerrar).sort((a, b) => a.periodo.localeCompare(b.periodo));

  const validos = envios.filter((e) => e.estado !== 'Cancelado');
  const conCosto = validos.filter((e) => e.ganancia !== null);
  const suma = (lista, f) => lista.reduce((a, x) => a + (f(x) || 0), 0);
  const tasas = [...datos.tasas].sort((a, b) =>
    a.fecha.localeCompare(b.fecha) || TURNOS.indexOf(a.turno) - TURNOS.indexOf(b.turno) || a.creado - b.creado);
  const ultimaTasa = tasas.at(-1) || null;
  const margenTasa = ultimaTasa && activo ? 1 - ultimaTasa.tasaCup / activo.equilibrio : null;
  const usdtDisponibles = suma(lotes, (l) => Math.max(l.disponibles, 0));

  const alertas = [];
  if (!lotes.length) alertas.push({ nivel: 'error', texto: 'Registra tu primer lote de USDT para calcular costos reales' });
  else if (!activo) alertas.push({ nivel: 'error', texto: 'Sin fondo: todos los lotes están agotados. Compra USDT.' });
  else if (usdtDisponibles < alertaUsdt) alertas.push({ nivel: 'aviso', texto: `Quedan ${usdtDisponibles.toFixed(2)} USDT: repón el fondo pronto` });
  if (margenTasa !== null && margenTasa < 0) alertas.push({ nivel: 'error', texto: `La última tasa (${ultimaTasa.tasaCup}) supera el equilibrio del lote ${activo.codigo} (${activo.equilibrio.toFixed(2)}): cada envío pierde dinero` });
  else if (margenTasa !== null && margenTasa < s.margin) alertas.push({ nivel: 'aviso', texto: `Margen bajo con la última tasa: ${(margenTasa * 100).toFixed(1)} %` });
  const conPerdida = conCosto.filter((e) => e.ganancia < 0);
  if (conPerdida.length) alertas.push({ nivel: 'error', texto: `${conPerdida.length} envío(s) con pérdida: R$ ${suma(conPerdida, (e) => e.ganancia).toFixed(2)}` });
  const pendientes = validos.filter((e) => e.estado === 'Pendiente');
  if (pendientes.length) alertas.push({ nivel: 'aviso', texto: `${pendientes.length} envío(s) pendientes de entregar en Cuba` });
  for (const e of envios) for (const a of e.avisos) alertas.push({ nivel: 'aviso', texto: `${e.fecha} · ${e.cliente}: ${a}` });

  const cupSocio = suma(lotes, (l) => l.cupSocio);
  const cupEntregado = suma(validos.filter((e) => e.estado === 'Entregado'), (e) => e.cup);
  const cupPendiente = suma(pendientes, (e) => e.cup);

  return {
    resumen: {
      envios: conCosto.length,
      brl: suma(conCosto, (e) => e.montoBrl),
      cup: suma(conCosto, (e) => e.cup),
      costo: suma(conCosto, (e) => e.costo),
      ganancia: suma(conCosto, (e) => e.ganancia),
      margen: suma(conCosto, (e) => e.montoBrl) ? suma(conCosto, (e) => e.ganancia) / suma(conCosto, (e) => e.montoBrl) : null,
      perdidas: conPerdida.length,
      gastos: suma(datos.gastos, (g) => g.montoBrl),
      usdtComprados: suma(lotes, (l) => l.usdt),
      brlInvertidos: suma(lotes, (l) => l.brl),
      usdtDisponibles,
      valorSaldo: suma(lotes, (l) => l.valorSaldo),
      loteActivo: activo && { codigo: activo.codigo, costo: activo.costo, equilibrio: activo.equilibrio, sugerida: activo.sugerida, disponibles: activo.disponibles },
      ultimaTasa,
      margenTasa,
      socio: { recibido: cupSocio, entregado: cupEntregado, pendiente: cupPendiente, saldo: cupSocio - cupEntregado - cupPendiente },
      alertaUsdt,
    },
    alertas,
    lotes,
    envios: envios.reverse(),
    clientes,
    porMes,
    porDia,
    tasas: tasas.reverse(),
    gastos: [...datos.gastos].sort(cronologico).reverse(),
  };
}

// Lote activo en el momento de calcular una tasa (para avisar si se publica por encima del equilibrio).
function loteActivo(datos, s) {
  return calcularLibro(datos, s).resumen.loteActivo;
}

// CSV con «;» y BOM para que Excel en español/portugués lo abra en columnas.
function aCsv(filas, columnas) {
  const celda = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(redondea(v)).replace('.', ',');
    const t = String(v);
    return /[;"\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : t;
  };
  const lineas = [columnas.map(([, titulo]) => titulo).join(';')];
  for (const f of filas) lineas.push(columnas.map(([k]) => celda(typeof k === 'function' ? k(f) : f[k])).join(';'));
  return '﻿' + lineas.join('\r\n');
}

const EXPORTES = {
  envios: [['fecha', 'Fecha'], ['cliente', 'Cliente'], ['montoBrl', 'Monto BRL'], ['tasa', 'Tasa CUP/BRL'], ['cup', 'CUP entregados'],
    [(e) => e.partes.map((p) => p.lote).join('+'), 'Lote(s)'], ['usdt', 'USDT usados'], ['costo', 'Costo real BRL'], ['ganancia', 'Ganancia BRL'],
    ['margen', 'Margen'], ['estado', 'Estado'], ['tarjeta', 'Tarjeta'], ['telefono', 'Teléfono'], ['notas', 'Notas']],
  lotes: [['fecha', 'Fecha'], ['codigo', 'Lote'], ['usdt', 'USDT comprados'], ['brl', 'BRL pagados'], ['costo', 'Costo BRL/USDT'],
    ['cupPorUsdt', 'CUP por USDT'], ['equilibrio', 'Tasa equilibrio'], ['sugerida', 'Tasa sugerida'], ['usadosPrevios', 'USDT usados antes'],
    ['usadosEnvios', 'USDT usados en envíos'], ['disponibles', 'USDT disponibles'], ['valorSaldo', 'Valor saldo BRL'], ['estado', 'Estado'],
    ['ganancia', 'Ganancia BRL'], ['notas', 'Notas']],
  clientes: [['nombre', 'Cliente'], ['envios', 'Envíos'], ['brl', 'BRL enviados'], ['cup', 'CUP entregados'], ['ganancia', 'Ganancia BRL'],
    ['primera', 'Primer envío'], ['ultima', 'Último envío'], ['tarjeta', 'Tarjeta'], ['telefono', 'Teléfono']],
  gastos: [['fecha', 'Fecha'], ['concepto', 'Concepto'], ['categoria', 'Categoría'], ['montoBrl', 'Monto BRL']],
  tasas: [['fecha', 'Fecha'], ['turno', 'Turno'], ['tasaCup', 'Tasa CUP/BRL'], ['tasaPequena', 'Tasa pequeña'], ['usdBrl', 'USD/BRL'],
    ['cupUsd', 'CUP/USD'], ['notas', 'Notas']],
  meses: [['periodo', 'Mes'], ['envios', 'Envíos'], ['brl', 'BRL cobrados'], ['cup', 'CUP entregados'], ['costo', 'Costo real BRL'],
    ['ganancia', 'Ganancia bruta BRL'], ['gastos', 'Gastos BRL'], ['neto', 'Utilidad neta BRL'], ['margen', 'Margen'], ['perdidas', 'Envíos con pérdida']],
};

function exportar(calculo, que) {
  const columnas = EXPORTES[que];
  if (!columnas) throw new Error('Exportación desconocida');
  const filas = que === 'meses' ? calculo.porMes : calculo[que];
  return aCsv(filas, columnas);
}

module.exports = { ESQUEMAS, ESTADOS, TURNOS, vacio, validar, guardarItem, borrarItem, calcularLibro, loteActivo, tasaSugerida, exportar, aCsv };
