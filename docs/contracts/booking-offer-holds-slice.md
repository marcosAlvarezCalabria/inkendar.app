# Contrato técnico: ofertas preaprobadas y bloqueos provisionales

_Estado técnico: `DONE`. El PR #14 y el CI posterior al merge verificaron código, build, migraciones limpias, pgTAP y Auth/RLS con datos sintéticos; este slice no acredita pruebas live._

## Alcance

Como OWNER autenticado quiero crear para un caso de tatuaje y un artista de mi estudio una oferta de una a tres opciones ya preaprobadas, para reservar esos intervalos provisionalmente mientras el cliente decide.

El estudio configura un plazo entero positivo en horas, con 24 horas por defecto. Crear una oferta calcula una caducidad visible desde el reloj de servidor. Cada opción usa un intervalo UTC semiabierto `[start,end)`, futuro, de 15 a 480 minutos. Las opciones de una misma oferta no se solapan. La creación es transaccional y serializada por estudio/artista: falla si el caso o el artista no pertenecen al tenant, si el caso no está `OPEN` o si una opción colisiona con otro hold activo.

Una oferta abierta mantiene todas sus opciones como holds mientras `expiresAt > now`. La previsualización de disponibilidad suma esos holds a los intervalos ocupados de Google antes de generar candidatos. Al caducar, una oferta todavía provisional pasa a `EXPIRED` y sus opciones se liberan en la misma transacción. El slice posterior de confirmación conserva en cambio la única opción `SELECTED` cuando su operación ya está `INSERTING`, incluso después de `expiresAt`, hasta reconciliar y finalizar. Crear una oferta materializa primero las expiraciones vencidas del mismo artista con el mismo orden de locks que la expiración explícita; repetirla no modifica filas ya caducadas y evita tratar como libre una transición concurrente a `INSERTING`.

Solo OWNER compone el cliente `service_role` después del guard y usa RPCs ligadas a `studioId` y `ownerUserId`; tablas, funciones y relaciones fallan cerrado para anónimo, ARTIST y tenants ajenos. Las mutaciones SSR son `POST` same-origin y todas las respuestas privadas usan `Cache-Control: private, no-store`.

## Contrato del slice

- UI SSR privada `GET/POST /app/owner/offers` para listar contexto, configurar el plazo, crear ofertas y materializar caducidades vencidas.
- `BookingOfferRepositoryPort` conserva configuración, ofertas y opciones detrás de Supabase; el reloj entra por puerto de aplicación.
- Los RPCs `get_booking_offer_management`, `save_booking_offer_expiry_hours`, `create_booking_offer`, `expire_booking_offers` y `list_active_booking_holds` exigen owner, usuario y estudio coherentes.
- Estados mínimos: oferta `OPEN | EXPIRED`; opción `HELD | RELEASED`. La selección y confirmación futuras ampliarán el workflow sin alterar la semántica de los holds activos.
- Este slice original no persiste tokens públicos, mensajes, datos de Google ni detalles de eventos; el acceso hash-only se define por separado en [acceso público de solo lectura](public-offer-access-slice.md).

## Criterios de aceptación

```gherkin
Given un OWNER autenticado, un caso OPEN y un artista del mismo estudio
When crea una oferta con entre una y tres opciones futuras válidas
Then Inkendar guarda la oferta y todas las opciones atómicamente
And usa el plazo configurado del estudio o 24 horas por defecto
And las opciones quedan como holds hasta la caducidad visible
```

```gherkin
Given un intervalo cubierto por una opción HELD de una oferta OPEN no vencida
When el OWNER previsualiza disponibilidad para ese artista
Then Inkendar no devuelve candidatos que se solapen con el hold
And sigue sin exponer títulos ni descripciones de Google Calendar
```

```gherkin
Given una oferta abierta que alcanzó su vencimiento
When se ejecuta la expiración una o varias veces
Then la oferta queda EXPIRED y todas sus opciones RELEASED en una transacción
And ejecuciones posteriores no vuelven a cambiarla
And la disponibilidad puede ofrecer de nuevo esos intervalos
```

```gherkin
Given un anónimo, un ARTIST o un OWNER de otro estudio
When intenta leer o mutar ofertas, configuración o holds
Then Inkendar falla cerrado antes de exponer datos o componer secretos
And las claves foráneas y los RPCs impiden relaciones entre tenants
```

## Fuera de alcance

Este slice original no incluye enlace público ni selección del cliente. El corte posterior [acceso público de solo lectura](public-offer-access-slice.md) añade emisión/rotación y consulta; [selección pública](public-offer-selection-slice.md) amplía estados para conservar una única opción elegida como hold pendiente. Elección libre, aprobación, revalidación final contra Google, creación o borrado de eventos, confirmación de cita, notificaciones y scheduler continúan fuera. Tampoco declara ejecutada ninguna prueba live.
