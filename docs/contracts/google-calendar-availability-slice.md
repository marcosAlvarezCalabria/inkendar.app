# Contrato técnico: disponibilidad Google Calendar por artista

_Estado técnico: `IN_PROGRESS` hasta validación completa/CI. La prueba live de FreeBusy permanece `IN_PROGRESS`._

## Alcance

Como OWNER autenticado quiero configurar ventanas semanales por artista y previsualizar huecos candidatos frente a la ocupación de su calendario Google asignado. Este slice no crea ni modifica eventos, ofertas, holds, citas, enlaces públicos, notificaciones ni una vista ARTIST.

Las reglas son tenant-safe por artista: zona IANA, hasta 28 ventanas semanales no solapadas (varias por día; ausencia significa cerrado), incremento 5–240 minutos y buffers anterior/posterior 0–240 minutos. La consulta exige duración entera de 15–480 minutos, rango RFC3339 UTC positivo de hasta 31 días y devuelve como máximo 500 slots. Excepciones por fecha, festivos y vacaciones se posponen hasta demostrar su necesidad.

## Semántica y seguridad

Los intervalos son semiabiertos `[start,end)`. Busy solapados o adyacentes se fusionan después de aplicar buffers. Se enumeran todos los días civiles locales que intersectan el rango UTC, incluidos offsets extremos como `Pacific/Kiritimati`. En un cambio DST ambiguo, el inicio usa el primer instante válido y el final el último, de modo que las dos ocurrencias puedan producir candidatos; un límite inexistente de primavera avanza hasta el primer minuto civil válido y una ventana totalmente inexistente produce cero slots sin abortar el rango. Cada slot devuelve UTC más representación local sin offset. Fechas UTC y `datetime-local` exigen round-trip exacto y no normalizan días imposibles.

La consulta a Google hace un único `POST /calendar/v3/freeBusy` con `{timeMin,timeMax,timeZone:"UTC",items:[{id}]}` y solo consume `busy.start/end`; nunca eventos, títulos ni descripciones. Antes del refresh valida calendario, RFC3339 UTC, orden y rango máximo. Exige exactamente el calendario solicitado, rechaza errores por calendario, JSON o intervalos malformados, respuestas de más de 10.000 busy y `Content-Length` superior a 1 MB; usa timeout de ocho segundos.

Solo OWNER compone secretos, service role y adaptadores. Artista ajeno, ARTIST y anónimo fallan cerrado. Sin calendario, sin reglas o sin scope devuelve estado explícito. `invalid_grant` marca `REAUTH_REQUIRED` conservando asignación y reglas; 429, 5xx, red, timeout o payload inválido devuelven 503 sin mutación.

## OAuth incremental

El scope mínimo oficial elegido es `https://www.googleapis.com/auth/calendar.events.freebusy`, descrito por Google como acceso a la disponibilidad en calendarios a los que la cuenta tiene acceso. Se solicita junto a `calendar.calendarlist.readonly`, con `include_granted_scopes=true`; no se solicita `calendar.events`. Una conexión antigua sin el scope sigue sirviendo para listado/asignación, pero la previsualización exige reconectar y conserva configuración.

Fuentes oficiales: [Freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [scopes de Calendar](https://developers.google.com/workspace/calendar/api/auth) y [OAuth incremental web server](https://developers.google.com/identity/protocols/oauth2/web-server).

## Evidencia

El 2026-09-15 el usuario verificó localmente con owner sintético: callback `result=connected`, listado live de calendarios y asignación de un calendario dedicado a `Local Artist` con `result=assignment-saved`. Esto acredita OAuth/listado/asignación live. FreeBusy, eventos y booking continúan `IN_PROGRESS` hasta una prueba live posterior; las pruebas de implementación usan solo datos sintéticos.
