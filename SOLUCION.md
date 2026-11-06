# SOLUCION — Agente conversacional de Órdenes de Compra SAP (Reto 03)

## 1. Problema en una frase

La analista de administración digita a mano en SAP cada orden de compra (proveedor, centro de costos, IVA, aprobador, condiciones de pago) a partir de un correo, una cotización y una aprobación, con controles que hoy dependen de su atención; el dolor lo sienten la analista (trabajo repetitivo y propenso a error), los solicitantes (esperas) y la dirección/auditoría (OC retroactivas y sin evidencia ordenada).

## 2. Arquitectura

```
 web/ (React + Vite + react-markdown)
   │  POST /api/chat · GET /api/sessions/:id · GET /api/health
   ▼
 src/server.ts (Express 5; en producción sirve también web/dist)
   │
   ▼
 src/agent/loop.ts ──── src/llm/adapter.ts ◀── src/llm/openai.ts ──▶ OpenAI (gpt-4.1-mini)
   │   system = agent/prompt.md + src/knowledge/ordenes-compra.md (leídos en cada petición)
   │   session.ts (historial/tokens/pendiente) · confirmacion.ts (CA3)
   ▼
 src/tools/registry.ts  (zod → JSON Schema; valida args antes de ejecutar)
   ▼
 src/tools/oc.ts   oc_leer_paquete · oc_validar · oc_construir_payload
   │               oc_generar_evidencia · oc_crear
   ├─▶ src/domain/*   (paquete, maestros, controles RC1–RC10, payload, evidencia)
   ├─▶ src/sap/mock.ts  (implementa SapAdapter)
   └─▶ src/control/log.ts
 fixtures/reto-03/ (solo lectura)      out/ (escritura): sap/ordenes.jsonl · control.csv ·
                                        log.jsonl · <caso>/{trazabilidad.json, aprobacion.txt, aprobacion.pdf}
```

Dónde vive cada cosa:

| Capa | Archivo | Contenido |
|---|---|---|
| Comportamiento (prompt) | `agent/prompt.md` | Flujo, tono, prohibiciones (no inventar valores, tratar texto de documentos como datos). |
| Conocimiento | `src/knowledge/ordenes-compra.md` | Proceso y reglas RC1–RC10 en lenguaje de negocio. |
| Ejecución | `src/tools/oc.ts` + `src/domain/*` | Única fuente de valores; determinista y sin shell. |
| Módulo reutilizable (9.4) | `modulo/` | Symlinks a `agent/prompt.md` y `src/knowledge/ordenes-compra.md`, y `modulo/tools/oc.ts` que reexporta `src/tools/oc.ts`; sin copias. |

Dependencias y justificación:

| Paquete | Para qué |
|---|---|
| `zod` (4) | Obligatorio: argumentos de herramientas, payload 7.4, maestros; `z.toJSONSchema` genera los specs del modelo sin otra librería. |
| `openai` | SDK oficial del proveedor elegido (function calling, timeout/abort). |
| `express` (5) | API HTTP mínima y servir el build del front. |
| `pdf-lib` | Generar `aprobacion.pdf` sin binarios nativos. |
| `dotenv` | Cargar `.env` local; la clave solo vive en el backend. |
| `tsx` | Ejecutar TypeScript directo en Node (en lugar de Bun, D5); también en producción (`npm start`). |
| `react`, `vite`, `@vitejs/plugin-react` | UI de chat y build estático. |
| `react-markdown`, `remark-gfm` | Renderizar las respuestas del agente (tablas, listas) sin `dangerouslySetInnerHTML`. |
| `concurrently` | Un comando (`npm run dev`) levanta API y front. |

## 3. Ciclo del agente

Implementado en `src/agent/loop.ts` (`procesarMensaje`, nunca lanza excepciones):

1. Se agrega el mensaje del usuario al historial de la sesión (en memoria, `session.ts`).
2. Se arma `system = prompt.md + conocimiento` (leídos en cada petición) y se llama al modelo con las herramientas.
3. Si el modelo pide herramientas, cada llamada se ejecuta por el registro (args validados con zod), se agrega al historial junto con su resultado, se muestra en el chat y se escribe en `out/log.jsonl` (CA4).
4. Se repite hasta que el modelo responde solo texto.

Topes y manejo de fallos:

| Control | Implementación real |
|---|---|
| Iteraciones (CA1) | `MAX_ITERATIONS_PER_TURN` (25 por defecto). En la ronda 25 se hace una última llamada **sin herramientas** con la instrucción de resumir lo logrado y lo pendiente. |
| Tokens | `MAX_TOKENS_PER_SESSION` (200 000). Se suma `entrada + salida` de cada respuesta y se comprueba **antes** de cada llamada; la llamada que cruza el tope se completa (puede sobrepasarlo una vez). Al excederse: error `LIMITE_TOKENS` en lenguaje claro. Además, `MAX_TOKENS_GLOBAL_PER_DAY` limita el gasto diario sumando todas las sesiones (error `LIMITE_GLOBAL`) y `MAX_SESSIONS` acota las sesiones en memoria (LRU), porque el `sessionId` lo elige el cliente y el link es público (D17). |
| Timeout | `LLM_TIMEOUT_MS` (30 s) con `AbortSignal.timeout` en el adaptador; el SDK reintenta una vez (`maxRetries: 1`). Se traduce a un mensaje claro. |
| Errores (CA5) | Fallo de herramienta → `{ok:false,error}` que el modelo ve; fallo del LLM → mensaje en el chat; la sesión sigue viva. |
| CA2 | Prompt prohíbe afirmar valores no provenientes de herramientas; además `oc_crear` reconstruye el payload desde las fuentes, así que un valor inventado no llega a SAP. |

Confirmación humana (CA3, D2/D16), aplicada por el servidor:

- Cuando `oc_validar` resulta apta con confirmaciones, o `oc_crear` responde `CONFIRMACION_REQUERIDA`, el turno termina con `needsConfirmation=true` y la sesión guarda `pendiente {caso}`.
- En los mensajes siguientes, `clasificarRespuesta()` (determinista, en español) clasifica el texto del **usuario** como `confirma` (mensaje corto que empieza por un afirmativo: "confirmo", "sí", "adelante"…; "ok" solo no cuenta), `rechaza` (empieza por "no" o pide cancelar) u `otro`. El pendiente sobrevive a preguntas intermedias ("muéstrame la tabla otra vez") y solo se borra al confirmar, al rechazar o al pasar a otro caso (D19).
- `contextoParaLlamada` pone `ctx.confirmacionHumana = true` solo si el usuario confirmó **y** `args.caso` coincide con el caso pendiente.
- `oc_crear` solo crea con confirmaciones si `args.confirmado === true && ctx.confirmacionHumana === true`. El flag `confirmado` del modelo, solo, no basta.
- A SAP se envía siempre el payload reconstruido en el servidor, nunca la copia del modelo; una deriva cosmética (tildes, descripción) no es un fallo de control.
- `oc_crear` devuelve `ruta_evidencia` (txt y pdf) para cerrar el flujo del §11 con número de OC y evidencia.
- Orden de comprobaciones en `oc_crear` (D13): revalidar → bloqueos → comparación de la *proyección crítica* del payload (montos, cantidades, unidad, códigos, proveedor, aprobador, referencia; `PAYLOAD_ALTERADO` si difiere) → idempotencia → confirmación → crear.

## 4. Elección del modelo

**OpenAI `gpt-4.1-mini`**, vía Chat Completions con function calling, detrás de la interfaz `LlmAdapter` (`src/llm/adapter.ts`); cambiar de proveedor o modelo es un adaptador nuevo o la variable `OPENAI_MODEL`.

Por qué: el modelo no calcula ni decide valores (lo hacen las herramientas y el servidor), así que se necesita sobre todo llamado fiable a herramientas, obediencia a un prompt de flujo y buen español, al menor costo y latencia (D3).

Costo estimado por caso (supuestos, no medición):

- Llamadas al modelo por caso: ~5–7 (leer → validar → construir → evidencia → crear → respuesta, más turnos de confirmación).
- Entrada por llamada: ~4–8 k tokens (system prompt + conocimiento + historial + JSON de herramientas; el historial crece en cada ronda).
- Salida total: ~1–2 k tokens.
- Precios usados: 0,40 USD/M de entrada y 1,60 USD/M de salida. **Verificar contra la tabla vigente de OpenAI antes de citar cifras.**

| Escenario | Entrada | Salida | Cálculo | Costo |
|---|---|---|---|---|
| Bajo | 5 × 4 k = 20 k | 1 k | 0,020 × 0,40 + 0,001 × 1,60 = 0,0080 + 0,0016 | ≈ 0,010 USD |
| Medio | 6 × 6 k = 36 k | 1,5 k | 0,036 × 0,40 + 0,0015 × 1,60 = 0,0144 + 0,0024 | ≈ 0,017 USD |
| Alto | 7 × 8 k = 56 k | 2 k | 0,056 × 0,40 + 0,002 × 1,60 = 0,0224 + 0,0032 | ≈ 0,026 USD |

Es decir, del orden de 1–3 centavos de dólar por caso. Con el tope de 200 k tokens por sesión, el peor caso por sesión queda acotado en ~0,08 USD de entrada más salida.

## 5. Matriz de controles

Todas viven en `validarPaquete` (`src/domain/controles.ts`), función pura; los códigos son estables y los usa el prompt.

| Regla | Tipo | Código(s) | Cómo se implementa |
|---|---|---|---|
| RC1 | Bloqueo | `PROVEEDOR_INEXISTENTE`, `PROVEEDOR_INACTIVO` | `buscarProveedor`: por NIT normalizado (`normalizarNit` quita puntos y el dígito de verificación tras el último `-`); sin NIT, por nombre normalizado (`normalizarNombre`: sin tildes, minúsculas, sin sufijos S.A.S./Ltda./S.A.). Luego exige `activo`. |
| RC2 | Bloqueo | `APROBACION_AUSENTE`, `APROBACION_SIN_APROBADO`, `APROBADOR_NO_AUTORIZADO` | `esAprobado` (en `paquete.ts`) busca la palabra "aprobado/a" y descarta "no/sin (está) aprobado"; el remitente se compara (minúsculas) con los aprobadores del centro de costo. |
| RC3 | Bloqueo | `MONTO_EXCEDE_TOPE` | `valor_total` vs `tope` del aprobador identificado en RC2. |
| RC4 | Bloqueo | `CENTRO_COSTO_INEXISTENTE`, `SUBAREA_INVALIDA` | Pertenencia al maestro de centros de costo. |
| RC5 | Confirmación | `COTIZACION_DIFIERE`, `COTIZACION_AUSENTE` | `abs(total_cot − total_sol)/total_sol > 2 %`; el detalle muestra ambos valores y aclara que el payload usa el de la solicitud (D11). Total leído del texto con `parsearCotizacion`/`parsearMonto`. |
| RC6 | Confirmación + derivado | `IVA_DERIVADO` | Sin `indicador_iva` → el del proveedor; queda en `derivados` y en trazabilidad. |
| RC7 | Derivado | (en `derivados.condiciones_pago`) | Sin condiciones de pago → las del proveedor; solo se informa. |
| RC8 | Confirmación | `OC_RETROACTIVA` | Si hay factura con `fecha` < `fecha_solicitud`, `retroactiva = true`; el flag llega a `control.csv`. Fechas ISO comparadas como texto. |
| RC9 | Confirmación | `APROBACION_ANTERIOR` | Fecha de aprobación (10 primeros caracteres) < `fecha_solicitud`. |
| RC10 | Bloqueo | `MONTO_INCONSISTENTE` | `abs(cantidad × valor_unitario − valor_total) > 1`. |

**La más difícil: RC5/RC8, es decir, extraer montos y fechas de texto libre** (cotización y factura son `.txt`). Hay que convertir `COP 11.400.000` (separador de miles con punto) a número sin confundirlo con decimales, localizar la línea `TOTAL` correcta (no la de base ni la de IVA) y la `Fecha de emisión`, y tratar el fallo como error tipado (`MONTO_INVALIDO`) en vez de adivinar. La alternativa de dejar que el modelo lea el texto se descartó porque un monto mal leído sería invisible. RC1 es la segunda: normalizar NIT y nombres sin falsos positivos.

Limitaciones honestas: el dígito de verificación del NIT se descarta, no se calcula; y el NIT de la cotización se extrae pero no se compara con el de la solicitud (no es una regla RC del PRD).

## 6. Diseño del adaptador SAP real

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV` expuesta a través de SAP BTP / Integration Suite** (SAP S/4HANA, cloud o on-premise con Cloud Connector). Razones, dada una viabilidad no confirmada:

- Es la API publicada y soportada para crear OC, con contrato versionado, validaciones de SAP incluidas y sin tocar el núcleo.
- Integration Suite/API Management aporta autenticación, cuotas, trazas y reintentos fuera del agente, lo que mantiene la credencial lejos del prompt.
- Si el cliente está en **ECC on-premise** sin OData disponible, la alternativa es **`BAPI_PO_CREATE1` por RFC** (conector tipo node-rfc o iFlow de Integration Suite). Misma interfaz `SapAdapter`; cambia solo el mapeo.
- Si ninguna conexión es viable a corto plazo: Plan B (más abajo).

### Mapeo del payload 7.4

| Payload 7.4 | A_PurchaseOrder / A_PurchaseOrderItem |
|---|---|
| `sociedad` | `CompanyCode` |
| `organizacion_compras` | `PurchasingOrganization` (y `PurchasingGroup` desde configuración) |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda` | `DocumentCurrency` |
| `condiciones_pago` | `PaymentTerms` |
| `referencia.solicitud_id` | `YY1_SolicitudID` / `SupplierQuotationExternalID` / texto de cabecera (campo de referencia para idempotencia) |
| `referencia.cotizacion_ref` | `SupplierQuotation` o texto de cabecera |
| `posiciones[].numero` | `PurchaseOrderItem` (10, 20, …) |
| `posiciones[].descripcion` (≤ 40) | `PurchaseOrderItemText` |
| `posiciones[].cantidad` | `OrderQuantity` |
| `posiciones[].unidad` (`UN`/`H`/`MES`) | `PurchaseOrderQuantityUnit` (códigos ISO/SAP de la instalación, p. ej. `PC`/`HUR`/`MON`: tabla de conversión configurable) |
| `posiciones[].precio_unitario` | `NetPriceAmount` (con `DocumentCurrency`; ojo con decimales de la moneda) |
| `posiciones[].indicador_iva` | `TaxCode` |
| `posiciones[].centro_costo` | Imputación `AccountAssignmentCategory = "K"` + entidad `A_PurOrdAccountAssignment` con `CostCenter` |
| `posiciones[].subarea` | Campo de imputación/orden interna o campo personalizado según el modelo de la empresa (por confirmar) |
| `aprobador`, `evidencia_sha256`, `aprobacion.pdf` | Adjunto vía Attachment API (`API_CV_ATTACHMENT_SRV`) sobre la OC creada; email, fecha y hash también en el texto de cabecera |
| `excepciones[]` | Texto de cabecera/nota de la OC y registro del control |

Los campos marcados como personalizados (referencia de la solicitud, subárea) dependen de la configuración de cada cliente y se confirman en el descubrimiento técnico.

### Autenticación y credenciales

- OAuth 2.0 *client credentials* contra el servicio XSUAA de BTP, o un **usuario técnico** (comunicación) dedicado a este agente con rol mínimo de crear OC y adjuntar documentos.
- Las credenciales viven en un gestor de secretos (BTP Credential Store, Vault, o variables del orquestador), las lee **solo** el código del adaptador y nunca el agente, el prompt, el front ni los logs. Rotación periódica y token en caché de corta vida.

### Idempotencia y errores parciales

- Antes de crear: `buscarOrdenPorReferencia(solicitud_id)` consulta `A_PurchaseOrder` filtrando por el campo de referencia donde guardamos nuestro `solicitud_id`. Si existe, se devuelve ese número (el mock ya se comporta así y `oc_crear` ya lo prueba).
- Para reintentos de red: clave de reintento (`Idempotency-Key` en la capa de Integration Suite, derivada de `solicitud_id` + hash del payload) y tratamiento de timeout como "estado desconocido": se vuelve a consultar por referencia antes de reintentar.
- Concurrencia: bloqueo por `solicitud_id` (bloqueo de base de datos o cola por clave) para que dos instancias no pasen la consulta a la vez.
- Error parcial (cabecera creada, ítem o adjunto fallido): crear la OC en estado borrador/bloqueada (`hold`) y liberarla solo cuando ítems e imputación estén completos; ante fallo, **compensar** (eliminar o anular el borrador) o reanudar usando la referencia. Las operaciones pendientes van a un *outbox* persistente con reintentos con espera exponencial y, agotados, a una cola de revisión humana. El agente informa el estado real, nunca "creada" sin número confirmado.

### Plan B (sin conexión viable)

El agente igual ahorra el trabajo de lectura, validación y preparación: genera la OC **lista para pegar** en ME21N (campos en el orden de la pantalla), el `aprobacion.pdf` ya listo para adjuntar y un **archivo de carga masiva** (CSV para carga por LSMW/BDC o plantilla de carga de la empresa) con las líneas de los casos aptos. La analista revisa y carga; los controles y el `control.csv` se mantienen.

### Cambio mock → real

Toda la lógica de negocio usa solo la interfaz `SapAdapter` (`consultarProveedor`, `crearOrden`, `buscarOrdenPorReferencia`). Pasar del mock al real es **un archivo nuevo** (`src/sap/odata.ts`) que la implemente, y cambiar la fábrica que hoy llama `createMockSap`. Herramientas, loop, prompt y UI no cambian. (Hoy `oc.ts` invoca `createMockSap` directamente; elegir la fábrica por variable de entorno es un ajuste menor pendiente.)

## 7. Lectura del proceso

**Mensaje para la dirección.** El caso `sol-005` es una compra de papelería por 3,2 M COP cuya factura FC-88231 (2026-08-10) es anterior a la solicitud (2026-08-27): se compró y se facturó antes de pedir la OC. La cotización incluso es de 2026-08-05. La OC se crea después del hecho, de modo que no cumple su función de control: la aprobación y el presupuesto no se verificaron antes del compromiso. Un caso aislado y pequeño es manejable; lo importante es medir cuántos hay y de qué valor.

**Cómo se mide.** Cada intento queda en `out/control.csv` (`solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts`). La regla RC8 marca `retroactiva=true` y exige confirmación explícita del analista; la fila queda registrada también si el caso se bloquea o la creación se rechaza (D12). Así se puede calcular el porcentaje de OC retroactivas, su valor acumulado, por centro de costo, solicitante y proveedor. En esta muestra de 6 casos, 1 es retroactiva (la lectura es ilustrativa, no estadística).

**Cambio de proceso propuesto.**

1. **OC antes del bien o de la factura**: ningún pedido al proveedor sin número de OC; el solicitante lo cita al comprar.
2. **"Sin OC, no se paga"**: la factura sin OC válida se devuelve al proveedor; las excepciones requieren aprobación expresa de un nivel superior y motivo registrado.
3. **KPI mensual**: % de OC retroactivas (meta: < 2 %) y valor retroactivo, por centro de costo, reportado a dirección; los reincidentes pasan a revisión.
4. **Canal rápido** para compras urgentes (OC exprés con aprobación móvil) para quitar la excusa de la demora, ahora que el agente reduce el tiempo de preparación.

## 8. Decisiones y trade-offs

Detalle completo en `DECISIONS.md` (D1–D16). Principales:

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Barandillas en el servidor: `oc_crear` reconstruye el payload, compara los campos críticos con el del modelo y envía siempre el reconstruido (D18); `confirmado` solo vale con `ctx.confirmacionHumana` puesto por el servidor (D2) | Confiar en el argumento `confirmado` y en el payload que devuelve el modelo | El riesgo del PRD es que el modelo "arregle" un monto; el prompt lo prohíbe, el diseño lo hace imposible. Costo: el modelo no puede editar el payload, aunque quisiera. |
| Detección de la confirmación con un matcher determinista de español sobre el siguiente mensaje (D16) | Dejar que el modelo decida si el usuario confirmó | CA3 exige que la decisión no se delegue al modelo. Costo: frases ambiguas se tratan como no confirmación (falla seguro); los botones de la UI envían "Confirmo"/"No, cancela". |
| Tools ignoran `paquete`/`derivados`/`payload` del modelo como fuente de verdad y releen fixtures (D7) | Argumento estricto con el `Paquete` completo | Que el modelo reserialice un objeto grande no debe romper el bucle ni ser la fuente de verdad. |
| El precio y el total del payload salen de la solicitud, no de la cotización (D11) | Usar el precio cotizado | La aprobación cubre el monto de la solicitud; RC5 expone la diferencia como confirmación en vez de cambiarla en silencio. |
| `oc_validar` también escribe en el control cuando no es apta (D12) | Registrar solo en `oc_crear` | HU-5: todo intento se registra; un caso bloqueado puede no llegar nunca a `oc_crear`. |
| Orden en `oc_crear`: idempotencia antes de confirmación (D13) | Confirmación primero | Reejecutar un caso ya creado debe devolver el número existente sin volver a preguntar. |
| Render como servicio único (API + `web/dist`) (D1) y Node + `tsx` (D5) | Vercel/serverless; Bun | Ver §11. Sesiones en memoria requieren un proceso persistente; la herramienta de runtime fue una decisión fija del proyecto. |
| Texto de fixtures al modelo como dato, sin filtrarlo (D14) | Limpiar o envolver el texto | La analista necesita ver el contenido; las garantías duras están en las herramientas, no en filtrar texto. |

## 9. Supuestos

- **D7/D8**: los argumentos grandes del modelo no son confiables; `Paquete` agrega campos aditivos (`faltantes[]`, `cotizacion.referencia`, `aprobacion.para/asunto`) que HU-1, `cotizacion_ref` y la evidencia necesitan.
- **D10**: la unidad de la posición se deriva del texto del ítem de la cotización (o la descripción): "hora" → `H`, palabra completa "mes"/"mensual" → `MES`, si no `UN`; queda en trazabilidad como `derivado`. El PRD pide unidad pero las fixtures no la traen.
- **D11**: precio unitario y totales siempre de la solicitud.
- **D12/D13**: filas de control y orden de comprobaciones descritos arriba.
- **D14**: el texto de documentos se entrega al modelo como dato.
- **D15**: se permiten como `Fuente` adicional en trazabilidad `aprobacion`, `correo`, constantes y evidencia, porque ahí nacen realmente esos valores.
- **Node 20+ con `tsx` en lugar de Bun**: `npm run demo` equivale a `bun run demo.ts` del PRD.
- **"Aprobado"**: se detecta la palabra completa "aprobado/a" en el cuerpo, salvo negada ("no/sin aprobado"). No se interpreta lenguaje natural más allá de eso.
- **NIT**: se compara sin puntos y sin dígito de verificación; el dígito no se valida matemáticamente. El NIT de la cotización no se cruza con el de la solicitud.
- **Moneda**: se asume la moneda de la solicitud; la de la cotización se lee pero no genera regla.
- **Fechas**: ISO `AAAA-MM-DD` comparadas como texto; sin zonas horarias.
- **Confirmación**: una respuesta afirmativa sin negaciones, enviada tras una pregunta pendiente, confirma **todas** las confirmaciones presentadas del caso pendiente (no una por una).
- **Aprobador "confirmado_por"**: se sella como `analista (sesión <id>)` porque no hay autenticación de usuarios en este alcance.
- **Módulo (9.4)**: fuera de nuestro servidor, el `oc_crear` del módulo se apoya en el aviso de permiso del host (`ask`) como compuerta humana; los controles de monto no cambian.
- **Sesiones** en memoria, un solo proceso; sin persistencia entre reinicios.

## 10. Cobertura

| Ítem | Estado | Nota |
|---|---|---|
| HU-1 Leer el paquete | hecho | `oc_leer_paquete`; adjuntos faltantes como `faltantes[]`. |
| HU-2 Validar controles | hecho | RC1–RC10, bloqueos vs confirmaciones, derivados. |
| HU-3 Construir el payload | hecho | Validado con zod, `payload_sha256`, trazabilidad por campo. |
| HU-4 Evidencia de aprobación | hecho | `aprobacion.txt` y `aprobacion.pdf` (pdf-lib) con sha256. Es evidencia del correo, no una firma digital. |
| HU-5 Crear OC en SAP simulado | hecho | Mock sobre `out/sap/`, idempotencia, `control.csv`. |
| HU-6 Manejo de errores | hecho | Errores tipados `{ok:false,error}` para paquete incompleto, JSON inválido, montos no numéricos; el caso malo no frena el siguiente. |
| Contrato de herramientas | parcial | Cinco de las herramientas del PRD hechas. **`oc_leer_excel` (P1 opcional): no hecho**; las solicitudes entran como `solicitud.json`. |
| Chat (front, CA1–CA5) | hecho | UI con tarjetas de herramientas y banner de confirmación. |
| `demo.ts` | hecho | Corre los 6 casos sin modelo (`npm run demo`) y repite `sol-001` para mostrar idempotencia. |
| Despliegue (Render) | parcial | `render.yaml` y README listos; el link público está **PENDIENTE** hasta que el propietario cree el servicio. |
| Bonus 9.4 | hecho | `modulo/`: `agent.md` y `skill/.../SKILL.md` son symlinks relativos a los archivos de la app; `tools/oc.ts` reexporta `src/tools/oc.ts`. `npm run check:modulo`. |

Qué falta para producción: adaptador SAP real (§6) con pruebas contra un sandbox; autenticación de usuarios y autorización por rol (hoy cualquiera con el link usa el agente y su clave del modelo); persistencia de sesiones, `out/` y bitácora en base de datos o almacenamiento duradero; control de concurrencia multi-instancia; lectura de Excel y adjuntos reales; monitoreo, alertas y presupuesto de costo por usuario; pruebas automatizadas de las reglas y evaluaciones del modelo; revisión de seguridad y de protección de datos.

## 11. Uso de IA

Se construyó con **Claude Code**, repartiendo el trabajo por perfil:

| Asistente | Tareas |
|---|---|
| Claude Opus 5.5 (arquitecto) | Plan por fases, contratos congelados (`src/types.ts`), integración, revisión y decisiones. |
| Claude Sonnet 5.5 (sub-agentes) | Herramientas y dominio (RC1–RC10), bucle del agente y servidor, prompt y conocimiento, y este documento. |
| Claude Haiku 5.5 (sub-agentes) | SAP simulado y bitácora, UI web, README y configuración de despliegue, `demo.ts`. |

Qué se descartó de lo propuesto, y por qué:

- **Vercel / serverless**: las sesiones viven en memoria del proceso y el estado de confirmación pendiente se perdería entre invocaciones; se eligió un servicio persistente en Render.
- **Confiar en el flag `confirmado` del modelo** (y en su copia del payload): contradice CA3 y el riesgo de §10 del PRD; se movió la garantía al servidor (D2/D16).
- **Regex `/mes/` para detectar la unidad mensual**: etiquetaría "licencia antivirus 12 meses" (sol-001) como `MES`; se corrigió a límite de palabra `\bmes\b|mensual`, que sigue dando `UN`.
- **Bun**: se usó Node 20 + `tsx` (D5).
- **Otras (ver `DECISIONS.md`)**: obligar a todas las fuentes a las cuatro del PRD (D15), usar el precio de la cotización (D11), dejar que el modelo decidiera la confirmación (D16), registrar solo en `oc_crear` (D12).

El autor revisó el código generado y puede explicar cada línea.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Inyección de instrucciones en documentos (correo, cotización, factura con texto malicioso) | Hoy: el prompt trata el texto como dato y las garantías duras están en el servidor (payload recalculado, confirmación del usuario). Producción: filtrar adjuntos, limitar a herramientas de solo lectura al leer, pruebas adversariales. |
| Abuso de costo del LLM por link público | Tope de iteraciones y de tokens por sesión ya implementados. Falta: autenticación, límite de peticiones por IP/usuario, presupuesto diario en el proveedor. |
| Disponibilidad de SAP | Outbox con reintentos, estados explícitos (pendiente/creada), degradación al Plan B (OC lista para pegar). |
| Maestros desactualizados (proveedores, centros de costo, aprobadores, topes) | Consultar el maestro en SAP en tiempo real en lugar de archivos; sincronización y fecha de corte visible en la respuesta. |
| Datos personales (correos, nombres, NIT) enviados a un tercero y guardados en `out/` | Minimizar lo que se envía al modelo, contrato de tratamiento de datos con el proveedor, enmascarado en logs, retención y acceso por rol. |
| Idempotencia con concurrencia o varias instancias | El `buscarOrdenPorReferencia` + escritura no es atómico en el mock de archivos; en producción, bloqueo por `solicitud_id` y restricción de unicidad en el sistema de referencia. |
| Disco efímero en Render (se pierde `out/`, sesiones y bitácora al reiniciar o dormir) | Persistir en base de datos/almacenamiento externo; mientras tanto, tratar el despliegue como demostración. |
| El PDF de evidencia no es una firma digital | Es un hash y copia del correo, útil para trazabilidad pero sin valor de no repudio. Producción: conservar el correo original (.eml) y firmarlo/sellarlo con un servicio de sello de tiempo o repositorio documental. |
| Calidad del modelo (llamadas erróneas o texto confuso) | Las herramientas validan con zod y no aceptan valores del modelo; conjunto de evaluación con los 6 casos y regresiones de prompt. |
