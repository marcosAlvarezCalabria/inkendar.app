# Sistema visual de la PWA Inkendar

_Estado: fundación visual (slice 1 de `docs/design/product-ui-spec.md`), pendiente de revisión_

_Última actualización: 2026-09-25_

La especificación de UX/UI es la fuente de verdad de pantallas, estados y criterios. Este documento solo fija las reglas visuales duraderas que la implementan. Los valores viven en `apps/inkendar/app/styles.css`.

## Mundo

Una orden de trabajo del estudio: hojas de papel frío sobre una mesa de tinta. Precisa, compacta y física; ni SaaS azul ni estética gótica.

- **Tinta** `#0B0B0F`: fondo de página. **Carbón** `#16161F`: rail, barra superior y menú.
- **Papel** `#F2F0EA`: hojas (`.shell-panel`, `.sheet`, `.auth-card`), formularios y registros. Una hoja lleva borde de 1 px, radio 14 px y sombra desplazada que simula la hoja de debajo; nunca glow ni cristal.
- **Ember** `#FF7000`: acción primaria, foco sobre oscuro e ítem activo. Sobre papel, el texto de acento usa `#A34400`.
- El único rótulo del sistema es el título de hoja: condensado, en mayúsculas y con una regla discontinua debajo, como una sección perforada de un parte. No se añaden eyebrows por sección.

## Tipografía

- Titulares y sellos: **Archivo** variable (OFL 1.1), autohospedada con `@fontsource-variable/archivo` y ejes de peso y anchura; condensada al 75–85 %. Resuelve provisionalmente la decisión abierta 2 de la spec.
- Cuerpo y controles: fuente de sistema, 16 px como mínimo y sin condensar.
- Escala fija en rem (0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25); números tabulares en horas y fechas.

## Estados

- `StatusBadge` es un sello: glifo + texto sobre un fondo claro con borde del mismo tono. Nunca actúa como botón.
- Tonos provisionales con contraste medido de ≥7:1 entre texto y fondo: success `#14532D/#D7F0DD`, warning `#6B3A00/#FFE6B3`, danger `#8A1C12/#FFD9D4`, pending `#2B2B6B/#E0E0F7`, info `#0B0B0F/#FFB27A` y neutral `#2A2A33/#E4E2DA`. Resuelven provisionalmente la decisión abierta 3 y deben validarse sobre pantallas reales.
- `Notice`: `role="alert"` solo para error; éxito, progreso y avisos usan `role="status"`.
- Empty: marco discontinuo sobre papel y acción únicamente si el rol puede realizarla. Loading: etiqueta con el nombre de la sección y un esqueleto estable. Pending: botón ocupado con intención textual y doble envío bloqueado.

## Interacción

- Foco: contorno de 3 px, ember sobre oscuro y tinta sobre papel.
- Botones primarios sobre papel: sombra de sello de 2 px que desaparece al pulsar.
- Objetivos de al menos 44 × 44 px. Deshabilitado: borde discontinuo además de la opacidad.
- Navegación OWNER: un taladro vacío por área y relleno de ember en la activa, además de borde, peso y `aria-current="page"`.
- Menú móvil: `<dialog>` modal abierto mediante Invoker Commands (`command="show-modal"`), con respaldo tras hidratar; el foco queda contenido, se cierra con Esc o tocando fuera y vuelve al disparador. El logout permanece disponible en la cabecera sin JavaScript. Desde 640 px se usa un rail persistente de 14 rem, que crece a 16 rem desde 1024 px.
- Movimiento: una sola transición del menú (200 ms, ease-out). `prefers-reduced-motion` elimina las traslaciones y los bucles.

## Prohibiciones propias de este mundo

- Tarjetas anidadas: dentro de una hoja, los registros se separan con reglas discontinuas.
- Bordes laterales de color en avisos o tarjetas.
- Color como único portador de estado.
