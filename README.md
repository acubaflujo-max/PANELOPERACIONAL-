# Bot de tasas del día — Flujo Cuba Remesas

Panel local que publica las tasas del día en WhatsApp a través de **Evolution API**.
Escribes **CUP por USD** (lo que te da tu socio), el panel trae el **USD/BRL**, calcula con la misma fórmula del Excel
(hojas Calculadora y Tasas_Diarias) y envía el mensaje a un grupo. No tiene dependencias: solo Node 20+.

## Uso
1. Doble clic en `iniciar.bat` (abre http://localhost:3030).
2. Primera vez: en «Conexión con Evolution API» pon la URL de tu servidor, la apikey y un nombre de instancia.
   Si la instancia no existe se crea y aparece el QR: escanéalo en WhatsApp → Dispositivos vinculados.
3. Cada turno: «Traer USD/BRL de referencia» (o escríbelo), escribe el CUP/USD, revisa el mensaje, elige el grupo y «Enviar».

Los supuestos (spread, comisiones, margen, colchón) se editan en el panel y se guardan en `config.json`.
La URL y la apikey se guardan en `%LOCALAPPDATA%\FlujoBot\evolution.json` (fuera de Drive).

## Notas
- Solo se envía al pulsar «Enviar» y confirmar. Nada es automático.
- USD/BRL de referencia: AwesomeAPI (dólar comercial), con Binance USDT/BRL público como respaldo. Ajústalo a tu cotización real.
- Evolution con Baileys (WhatsApp Web no oficial): WhatsApp puede restringir números que automatizan; usa uno que puedas perder.
- El envío prueba `{number, text}` y, si el servidor responde 400, la forma antigua `{number, textMessage:{text}}`.
- Pruebas: `npm test` (el cálculo coincide con el Excel).
