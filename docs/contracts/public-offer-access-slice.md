# Contrato técnico: acceso público de solo lectura a ofertas

_Estado técnico: `DONE`. El PR #16 y el CI posterior al merge verificaron código, build, migraciones limpias, pgTAP y Auth/RLS con datos sintéticos; este slice no acredita selección ni pruebas live._

## Alcance

Como OWNER autenticado quiero emitir o rotar un enlace temporal para una oferta preaprobada `OPEN` de mi estudio, para que el cliente consulte de forma segura sus opciones reservadas provisionalmente sin acceder a una cuenta.

La credencial es un token opaco canónico base64url sin padding de exactamente 32 bytes aleatorios (43 caracteres, al menos 256 bits de entropía). La aplicación recibe reloj, aleatoriedad y hash mediante dependencias inyectables. El token en claro y su URL aparecen únicamente en la respuesta de emisión o rotación; Supabase recibe y persiste solo su SHA-256 hexadecimal canónico. Cada oferta tiene como máximo una credencial activa y una rotación reemplaza el hash atómicamente, invalidando de inmediato el enlace anterior.

La emisión usa `POST` same-origin desde la UI SSR existente y compone `service_role` solo después de autorizar un OWNER. La operación comprueba en base de datos que owner, estudio y oferta pertenecen al mismo tenant y que la oferta continúa `OPEN` con `expires_at > now`.

La ruta pública `GET /offers/:token` no redirige y acepta únicamente el token canónico. Resuelve mediante backend/RPC el hash del token y devuelve solo una oferta `OPEN`, vigente y con entre una y tres opciones `HELD`. La vista contiene exclusivamente `expiresAt`, `artistDisplayName`, `timeZone` cuando el artista tiene una regla configurada, y cada intervalo `{ startUtc, endUtc }`. Si no hay zona configurada, representa los intervalos explícitamente en UTC. No expone el nombre del estudio, customer, tattoo_case, identificadores internos o de proveedor, conversación, contacto, títulos o datos de eventos, token ni hash.

Token inválido, mal formado, rotado, desconocido, oferta caducada o liberada producen la misma respuesta genérica `404`, sin indicar si la oferta existe. Todas las respuestas de la ruta —éxito y fallo— llevan `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow` y una CSP restrictiva. La aplicación no registra el token, no lo incluye en errores ni lo transporta mediante query, fragment o redirect.

## Contrato técnico

- `BookingOfferRepositoryPort` añade una operación OWNER para rotar el hash de acceso y un puerto público separado de solo lectura para resolver el hash sin aceptar un tenant aportado por el cliente.
- El caso de uso OWNER devuelve `{ token, expiresAt }`; el adaptador SSR construye `{ accessUrl, expiresAt }` para esa única respuesta. Ni listados posteriores ni la gestión SSR recuperan la credencial.
- El caso de uso público devuelve `{ expiresAt, artistDisplayName, timeZone, options }` o un único error `PublicBookingOfferUnavailableError`.
- La migración aditiva crea una única fila de acceso por oferta y dos RPC `SECURITY DEFINER` con `search_path = ''`: rotación tenant-safe para OWNER y lectura mínima por hash para `service_role`. Ninguna tabla o función queda accesible directamente desde browser, `anon` o `authenticated`.
- El hash de entrada a Postgres es exactamente 64 caracteres hexadecimales minúsculos; el token en claro nunca cruza la frontera de persistencia.
- La caducidad y los holds existentes conservan su semántica: este slice no materializa estados nuevos ni extiende la vigencia.

## Criterios de aceptación

```gherkin
Given un OWNER autenticado y una oferta OPEN vigente de su estudio
When emite el acceso público desde la gestión existente
Then Inkendar genera 32 bytes criptográficamente aleatorios y devuelve el enlace solo en esa respuesta
And Supabase persiste únicamente SHA-256 del token
And los listados posteriores no permiten recuperar el token ni el hash
```

```gherkin
Given una oferta vigente con un enlace público activo
When el OWNER rota el acceso
Then una única credencial activa queda asociada a la oferta
And el enlace anterior deja de resolver inmediatamente
And el enlace nuevo muestra las mismas opciones reservadas provisionalmente
```

```gherkin
Given un token canónico de una oferta OPEN con expires_at mayor que el reloj de servidor
When un visitante abre /offers/:token
Then ve entre una y tres opciones HELD y la caducidad
And ve solo el nombre del artista y la zona necesaria para interpretar los intervalos
And la página dice que son opciones reservadas provisionalmente, no una cita confirmada
And no recibe datos del cliente, caso, conversación, contacto, proveedor, eventos ni identificadores internos
```

```gherkin
Given un token incorrecto, mal formado, rotado o asociado a una oferta vencida o liberada
When un visitante abre la ruta pública
Then recibe la misma respuesta genérica sin revelar si la oferta existe
And no se produce ningún redirect ni se registra o refleja el token
And la respuesta impide caché, referrer, indexación y framing
```

```gherkin
Given un anónimo, un ARTIST o un OWNER de otro estudio
When intenta emitir o rotar acceso para una oferta
Then Inkendar falla cerrado antes de exponer datos o componer secretos para anónimo o ARTIST
And la autorización transaccional de Postgres rechaza el tenant ajeno
```

## Fuera de alcance

Este slice original no incluye selección o escritura pública. El corte posterior [selección pública](public-offer-selection-slice.md) añade una única elección preaprobada pendiente de confirmación; elección libre, aprobación owner, revalidación Google, creación o borrado de eventos, confirmación de cita, notificaciones, scheduler y pruebas live permanecen fuera. Ningún corte afirma todavía una cita confirmada.
