// Guarda el libro del ERP en erp.json (en FLUJOBOT_DATA o junto a server.js), o en Supabase si está conectado.
// Escritura atómica (archivo temporal + rename) y una copia diaria en erp-respaldos/ (se guardan 30 días).

const fs = require('fs');
const path = require('path');
const { vacio, guardarItem, borrarItem } = require('./erp');
const supabase = require('./supabase');

const DIAS_RESPALDO = 30;

function crearLibro(dir) {
  const archivo = path.join(dir, 'erp.json');
  const carpetaRespaldos = path.join(dir, 'erp-respaldos');

  function leer() {
    try {
      const d = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      return { ...vacio(), ...d };
    } catch (e) {
      if (e.code === 'ENOENT') return vacio();
      // Nunca se sobrescribe un archivo que no se pudo leer: se avisa para no perder datos.
      throw new Error(`No se pudo leer erp.json (${e.message}). Revisa el archivo o restaura un respaldo de erp-respaldos/.`);
    }
  }

  function respaldar() {
    if (!fs.existsSync(archivo)) return;
    fs.mkdirSync(carpetaRespaldos, { recursive: true });
    const hoy = new Date().toISOString().slice(0, 10);
    const destino = path.join(carpetaRespaldos, `erp-${hoy}.json`);
    if (!fs.existsSync(destino)) fs.copyFileSync(archivo, destino);
    limpiarViejos('erp');
  }

  function limpiarViejos(prefijo) {
    const patron = new RegExp(`^${prefijo}-\\d{4}-\\d{2}-\\d{2}\\.json$`);
    const viejos = fs.readdirSync(carpetaRespaldos).filter((f) => patron.test(f)).sort();
    for (const f of viejos.slice(0, Math.max(0, viejos.length - DIAS_RESPALDO))) fs.unlinkSync(path.join(carpetaRespaldos, f));
  }

  // Copia diaria de lo que hay en Supabase (el plan gratuito no tiene respaldos automáticos).
  function instantanea(datos) {
    fs.mkdirSync(carpetaRespaldos, { recursive: true });
    const destino = path.join(carpetaRespaldos, `supabase-${new Date().toISOString().slice(0, 10)}.json`);
    if (fs.existsSync(destino)) return;
    fs.writeFileSync(destino, JSON.stringify(datos, null, 1));
    limpiarViejos('supabase');
  }

  function escribir(datos) {
    fs.mkdirSync(dir, { recursive: true });
    respaldar();
    const tmp = archivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(datos, null, 1));
    fs.renameSync(tmp, archivo);
  }

  // Lee, aplica el cambio y guarda en un solo paso (el servidor atiende una petición a la vez por evento).
  function modificar(fn) {
    const datos = leer();
    const r = fn(datos);
    escribir(datos);
    return r;
  }

  return { leer, escribir, modificar, instantanea, archivo };
}

// Misma interfaz para los dos destinos. Se decide en cada llamada: al conectar Supabase desde el panel,
// el cambio es inmediato. Las validaciones (lote repetido, lote con envíos…) son las mismas en ambos.
function crearAlmacen(dir) {
  const local = crearLibro(dir);
  const enSupabase = () => supabase.configurado();

  return {
    local,
    modo: () => (enSupabase() ? 'supabase' : 'local'),

    async leer() {
      return enSupabase() ? supabase.leerTodo() : local.leer();
    },

    async guardar(coleccion, item) {
      if (!enSupabase()) return local.modificar((d) => guardarItem(d, coleccion, item));
      const d = await supabase.leerTodo();
      local.instantanea(d);
      const limpio = guardarItem(d, coleccion, item); // al renombrar un lote, Supabase arrastra los envíos (on update cascade)
      await supabase.guardarFilas(coleccion, [limpio]);
      return limpio;
    },

    async borrar(coleccion, id) {
      if (!enSupabase()) return local.modificar((d) => borrarItem(d, coleccion, id));
      const d = await supabase.leerTodo();
      local.instantanea(d);
      borrarItem(d, coleccion, id);
      await supabase.borrarFila(coleccion, id);
    },

    // Sube todo lo del archivo local a Supabase (no borra nada; si un id ya existe, lo actualiza).
    async subirLocal() {
      if (!enSupabase()) throw new Error('Primero conecta Supabase');
      const d = local.leer();
      for (const t of supabase.TABLAS) await supabase.guardarFilas(t, d[t]); // lotes primero: los envíos los referencian
      return Object.fromEntries(supabase.TABLAS.map((t) => [t, d[t].length]));
    },
  };
}

module.exports = { crearLibro, crearAlmacen };
