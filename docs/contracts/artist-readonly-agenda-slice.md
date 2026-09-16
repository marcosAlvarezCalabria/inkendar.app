# Contrato técnico: agenda privada de solo lectura para ARTIST

_Estado técnico: `IN_PROGRESS`. Implementación y evidencia local completas; revisión independiente, PR y CI pendientes._

## Necesidad y alcance

Como artista autenticado quiero consultar mis próximas citas confirmadas y el contexto mínimo del tatuaje para prepararme sin acceder a datos operativos o privados ajenos.

El slice sustituye el shell de `/app/artist` por una vista SSR privada de solo lectura. Une en Supabase la cita confirmada con su `booking_option`, `tattoo_case` y `customer`; no consulta Google, no duplica eventos y no añade formularios, acciones, conversaciones, archivos, referencias, galería, respuestas, cancelación ni elección libre.

## Contrato de aplicación y UI

`ArtistAgendaRepositoryPort.listUpcoming({ nowUtc, limit })` devuelve como máximo 50 elementos ordenados por inicio ascendente. `createArtistAgendaService` obtiene `nowUtc` de un reloj inyectable y usa el límite fijo `50`.

Cada elemento contiene exclusivamente:

- `startUtc` y `endUtc` de la `booking_option` confirmada;
- `customerDisplayName`;
- `caseSummary`;
- `bodyArea` y `size`, ambos opcionales;
- `timeZone` de la regla de disponibilidad del artista o `UTC` si todavía no existe esa configuración.

No contiene IDs internos, email, teléfono, conversación o mensajes, correlación o IDs de Google, tokens, notas ni referencias. El loader conserva el guard `ARTIST`, cookies rotadas y `Cache-Control: private, no-store`; un error devuelve únicamente «No se pudo cargar la agenda». La página usa lista, títulos, `dl` y elementos `time` con `dateTime` UTC; el texto visible incluye la zona IANA explícita y no depende del color. El estado vacío también es privado y no ofrece mutaciones.

## Persistencia y autorización

`get_artist_agenda(p_now, p_limit)` es una RPC `SECURITY DEFINER` con `search_path = ''`. Solo `authenticated` recibe `EXECUTE`; `public`, `anon` y `service_role` quedan revocados. La RPC resuelve `auth.uid()` y exige exactamente una membership total y exactamente una relación coherente `membership ARTIST → user_profile → artist_profile`, todas para la misma identidad y tenant. OWNER, anónimo, identidad sin perfil coherente o límite fuera de `1..50` fallan con un error genérico `42501`.

La consulta conserva las relaciones compuestas entre `appointment`, la opción/oferta, el caso y el customer; exige estados `CONFIRMED` en cita y opción, filtra por el `artist_profile` resuelto y ordena por inicio. La frontera temporal es inclusiva: `end_at >= greatest(p_now, now())`. Así el reloj de aplicación es determinista en tests, pero un cliente autenticado no puede retroceder `p_now` para recuperar citas finalizadas. El slice no concede acceso general ni escritura a `appointment`, `booking_option`, `tattoo_case` o `customer`.

## Criterios de aceptación

```gherkin
Given un ARTIST autenticado con membership y artist_profile coherentes
And tiene citas CONFIRMED propias y ajenas en uno o varios estudios
When abre /app/artist
Then ve solo sus citas cuyo end_at es igual o posterior al instante actual
And aparecen por start_at ascendente con un máximo de 50
```

```gherkin
Given una cita confirmada asignada al ARTIST
When la agenda representa su fila
Then muestra intervalo, zona horaria, nombre visible del customer, resumen, zona corporal y tamaño si existen
And no serializa PII de contacto, conversaciones, Google, tokens, IDs internos, notas ni referencias
```

```gherkin
Given un OWNER, un usuario anónimo o una identidad sin perfil ARTIST coherente
When intenta abrir la ruta o ejecutar la RPC
Then falla cerrado sin obtener datos de agenda
```

```gherkin
Given una cita cuyo end_at coincide exactamente con el reloj
And otra cita ya finalizada
When se consulta la agenda
Then incluye la primera y excluye la segunda
And retroceder p_now no permite recuperar la cita finalizada
```

```gherkin
Given un ARTIST sin próximas citas confirmadas
When abre /app/artist
Then ve un estado vacío privado y comprensible
And no existe formulario, acción ni capacidad de escritura
```

## Plan y evidencia TDD

1. RED de aplicación, adaptador, handler y vista por módulos/comportamiento ausentes.
2. RED pgTAP contra la base anterior porque la RPC no existía.
3. GREEN mínimo por capas y migración, seguido de refactor y validación acumulada.

El RED Vitest falló en los cuatro límites previstos. El RED pgTAP abortó al no existir `get_artist_agenda`. Tras GREEN pasan 9 pruebas enfocadas y 27 aserciones pgTAP del slice después de `db:reset`. La suite acumulada pasa 522 aserciones pgTAP; `pnpm run check` pasa lint, tipos, 375 pruebas Vitest —más una omitida— y build cliente/SSR. `supabase db lint --local --level warning` no encuentra errores y `supabase db diff --local` no encuentra drift. El entorno local usa Node 25.2.0 y emite el warning de engine; revisión, CI con Node 24 y cualquier prueba live siguen pendientes.

## Fuera de alcance

Edición o cancelación de citas, respuesta a clientes, conversaciones, Google directo, referencias/archivos, galería, notas, búsqueda, paginación pública, histórico y zona horaria nueva por estudio o artista. La zona de disponibilidad existente es autoritativa; `UTC` es el fallback explícito mientras falte esa configuración.
