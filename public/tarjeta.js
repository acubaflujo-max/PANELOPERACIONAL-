// Tarjeta de la tasa del día. La usan el navegador (vista previa y «Publicar como imagen») y el servidor
// (envío automático), con el mismo dibujo. Recibe un contexto 2D de canvas y los datos ya calculados.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Tarjeta = fabrica();
})(typeof self !== 'undefined' ? self : this, () => {
  const W = 1080, H = 1080;
  const FUENTE = '"Segoe UI", "DejaVu Sans", Arial, Helvetica, sans-serif';
  const fmt1 = (n) => Number(n).toFixed(1).replace('.', ',');

  // datos: { tasaCup, tasaPequena, turno, umbralBrl, montoMinimoBrl, fecha? (Date) }
  function dibujar(g, datos) {
    const umbral = datos.umbralBrl ?? 100, minimo = datos.montoMinimoBrl ?? 20;
    // El texto se achica si no cabe (otras fuentes miden distinto).
    const centro = (txt, y, px, color, peso = 'bold', ancho = W - 160) => {
      g.font = `${peso} ${px}px ${FUENTE}`;
      const w = g.measureText(txt).width;
      if (w > ancho) g.font = `${peso} ${Math.floor(px * ancho / w)}px ${FUENTE}`;
      g.fillStyle = color; g.textAlign = 'center'; g.fillText(txt, W / 2, y);
    };
    const fondo = g.createLinearGradient(0, 0, W, H);
    fondo.addColorStop(0, '#0E3A8C'); fondo.addColorStop(1, '#061B4A');
    g.fillStyle = fondo; g.fillRect(0, 0, W, H);
    // Franjas diagonales sutiles (guiño a la bandera) y círculo de luz
    g.save(); g.globalAlpha = 0.07; g.fillStyle = '#fff';
    for (let i = 0; i < 5; i++) { g.save(); g.rotate(-Math.PI / 9); g.fillRect(-200, 520 + i * 90, W + 400, 34); g.restore(); }
    g.restore();
    g.save(); g.globalAlpha = 0.10; g.fillStyle = '#4C8DFF';
    g.beginPath(); g.arc(W - 90, 130, 260, 0, Math.PI * 2); g.fill(); g.restore();
    // Triángulo rojo con estrella (arriba a la izquierda)
    g.fillStyle = '#E8283A';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(330, 0); g.lineTo(0, 330); g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 52 * 0.4 : 52, a = -Math.PI / 2 + i * Math.PI / 5;
      g[i ? 'lineTo' : 'moveTo'](85 + r * Math.cos(a), 95 + r * Math.sin(a));
    }
    g.closePath(); g.fill();
    // Marca
    centro('FLUJO CUBA REMESAS', 190, 52, '#fff');
    centro('Brasil  →  Cuba', 245, 34, '#9FC2FF', 'normal');
    // Etiqueta con fecha y turno
    const fecha = (datos.fecha || new Date()).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: datos.zona });
    const etiqueta = `TASA DEL DÍA · ${fecha.toUpperCase()} · ${String(datos.turno || '').toUpperCase()}`;
    g.font = `bold 28px ${FUENTE}`;
    const ancho = Math.min(g.measureText(etiqueta).width + 60, W - 80);
    g.fillStyle = '#E8283A';
    g.beginPath(); g.roundRect((W - ancho) / 2, 300, ancho, 60, 30); g.fill();
    centro(etiqueta, 340, 28, '#fff', 'bold', W - 140);
    // Tasa principal en una tarjeta blanca
    g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
    g.fillStyle = '#fff'; g.beginPath(); g.roundRect(90, 400, W - 180, 300, 36); g.fill(); g.restore();
    g.fillStyle = '#E8283A'; g.beginPath(); g.roundRect(90, 400, 18, 300, [36, 0, 0, 36]); g.fill();
    centro(`Desde ${umbral} BRL`, 465, 34, '#4A5B7D', 'normal');
    centro(`1 BRL = ${fmt1(datos.tasaCup)} CUP`, 580, 92, '#0E3A8C', 'bold', W - 260);
    g.fillStyle = '#E8283A'; g.fillRect(W / 2 - 60, 620, 120, 8);
    centro('pesos cubanos por cada real', 676, 30, '#4A5B7D', 'normal');
    // Tasa de envíos pequeños
    g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.roundRect(90, 735, W - 180, 140, 28); g.fill();
    centro(`Menos de ${umbral} BRL`, 782, 30, '#9FC2FF', 'normal');
    centro(`1 BRL = ${fmt1(datos.tasaPequena)} CUP`, 850, 60, '#fff', 'bold', W - 260);
    // Pie
    centro(`Envío mínimo: ${minimo} BRL`, 935, 34, '#fff', 'normal');
    g.fillStyle = '#E8283A'; g.fillRect(0, H - 90, W, 90);
    centro('Escríbenos por WhatsApp para enviar', H - 36, 36, '#fff');
  }

  return { W, H, dibujar };
});
