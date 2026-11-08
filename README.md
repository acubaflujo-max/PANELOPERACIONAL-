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

## ERP (pestañas Inicio, Envíos, Lotes USDT, Clientes, Gastos, Reportes)
- **Lotes USDT**: cada compra en Binance (USDT, BRL pagados, CUP por USDT del socio). Calcula costo, tasa de equilibrio y saldo.
- **Envíos**: cada remesa. Si no eliges lote, se asigna sola al lote más antiguo con saldo (FIFO) y, si no alcanza, sigue con el siguiente.
  Muestra costo real, ganancia y margen antes de guardar. 📋 copia los datos de entrega para el socio.
- **Tasas**: además del mercado, compara la tasa con el costo real del lote activo y avisa si pierdes. Al enviar por WhatsApp la tasa queda registrada.
- **Reportes**: ganancia bruta, gastos y utilidad neta por mes y por día; saldo de CUP con el socio.
- Los datos se guardan en `erp.json` (en `FLUJOBOT_DATA` en el servidor) con una copia diaria en `erp-respaldos/` (30 días).
  Cada pestaña exporta CSV para Excel. Fórmulas iguales a `Modelo_Remesas_Flujo_Cuba_v2.xlsx` (ver `npm test`).

## Base de datos en Supabase (opcional)
- Proyecto: `acubaflujo` (https://kbvwjwcaxehrupwvvzjo.supabase.co). Tablas `lotes`, `envios`, `gastos`, `tasas` con RLS
  activado y sin políticas: las claves públicas no ven nada; solo el servidor del panel entra con la **clave secreta**.
- En el panel: Inicio → «Base de datos» → URL del proyecto + clave secreta (Project Settings → API Keys → Secret keys) →
  «Probar y conectar». Se guarda en `%LOCALAPPDATA%\FlujoBot\supabase.json` (fuera de Drive). «Desconectar» vuelve a `erp.json`.
- En el VPS/Docker: variables de entorno `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (el panel no las puede cambiar).
- Con Supabase conectado, el panel guarda una copia diaria en `erp-respaldos/supabase-AAAA-MM-DD.json` (el plan gratuito no tiene respaldos).
- **Ajustes en Supabase**: con la base conectada, los ajustes (supuestos, tramos, enlace, PIX, grupos) se guardan en la tabla
  `ajustes` y sobreviven a los despliegues. Créala una vez en Supabase → SQL Editor; si no existe, el panel usa `config.json` y lo avisa en Ajustes:
  ```sql
  create table if not exists public.ajustes (
    clave text primary key,
    valor jsonb not null,
    actualizado timestamptz not null default now()
  );
  alter table public.ajustes enable row level security;
  revoke all on public.ajustes from anon, authenticated;
  ```
  La primera vez que se conecta, sube los ajustes que ya había en el archivo.
- «Subir datos del archivo local» copia `erp.json` a Supabase (actualiza por id, no borra nada).

## Envío automático de la tasa (n8n)
- Al guardar una tasa en «Tasas publicadas» (la más reciente del libro), el panel se la manda al flujo de n8n
  «Flujo Cuba · Tasa del día automática», que la publica en el grupo a las 7:00, 13:00 y 19:00 (hora de Brasil).
  Si el dólar se mueve más de 3 % respecto al USD/BRL guardado con la tasa, el flujo se pausa y avisa por WhatsApp.
- En el VPS/Docker: variables de entorno `N8N_TASA_URL` (`https://TU-N8N/webhook/flujo-tasa`) y `N8N_TASA_TOKEN`
  (el mismo valor que `TOKEN` en el nodo «Guardar tasa vigente» de n8n). En local se guardan en `%LOCALAPPDATA%\FlujoBot\n8n.json`.
- Si n8n no responde, el panel sigue funcionando y lo deja en el log del servidor.

## Notas
- Solo se envía al pulsar «Enviar» y confirmar. Nada es automático.
- USD/BRL de referencia: AwesomeAPI (dólar comercial), con Binance USDT/BRL público como respaldo. Ajústalo a tu cotización real.
- Evolution con Baileys (WhatsApp Web no oficial): WhatsApp puede restringir números que automatizan; usa uno que puedas perder.
- El envío prueba `{number, text}` y, si el servidor responde 400, la forma antigua `{number, textMessage:{text}}`.
- Pruebas: `npm test` (el cálculo coincide con el Excel).
