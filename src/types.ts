/**
 * Frozen shared contracts (Phase P0).
 *
 * Every module builds against these types, so parallel work never has to
 * negotiate shapes. Changing anything here is an architect decision.
 * Schemas follow PRD §7.1–7.4 and §6.2–6.4.
 */
import { z } from "zod"

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures & masters (PRD §7.1)
// ─────────────────────────────────────────────────────────────────────────────

/** Purchase request, as delivered in `solicitud.json` (normalized Excel). */
export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number().finite(),
  valor_unitario: z.number().finite(),
  valor_total: z.number().finite(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: z.string().min(1),
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const CorreoFixtureSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
})
export type CorreoFixture = z.infer<typeof CorreoFixtureSchema>

export const AprobacionFixtureSchema = z.object({
  de: z.string(),
  para: z.string(),
  cc: z.array(z.string()).optional(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
})
export type AprobacionFixture = z.infer<typeof AprobacionFixtureSchema>

export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export type Proveedor = z.infer<typeof ProveedorSchema>

export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
})
export type CentroCosto = z.infer<typeof CentroCostoSchema>

export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
export type IndicadorIva = z.infer<typeof IndicadorIvaSchema>

export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })
export type CondicionPago = z.infer<typeof CondicionPagoSchema>

export type Maestros = {
  proveedores: Proveedor[]
  centrosCosto: CentroCosto[]
  indicadoresIva: IndicadorIva[]
  condicionesPago: CondicionPago[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalized package (PRD §7.2). `faltantes` is additive: it names missing
// attachments so HU-1 can report them without throwing.
// ─────────────────────────────────────────────────────────────────────────────

export const PaqueteSchema = z.object({
  correo: z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() }),
  solicitud: SolicitudSchema,
  cotizacion: z
    .object({
      proveedor: z.string(),
      nit: z.string().nullable(),
      total: z.number(),
      moneda: z.string(),
      validez_hasta: z.string().nullable(),
      /** Referencia del documento, p. ej. "COT-TS-2026-0451". Additive. */
      referencia: z.string().nullable(),
      texto: z.string(),
    })
    .nullable(),
  aprobacion: z
    .object({
      de: z.string(),
      /** Additive: needed by the evidence file (headers de/para/fecha/asunto). */
      para: z.string(),
      asunto: z.string(),
      fecha: z.string(),
      aprobado: z.boolean(),
      texto: z.string(),
    })
    .nullable(),
  factura: z.object({ numero: z.string(), fecha: z.string(), total: z.number() }).nullable(),
  /** Names of attachments that were expected but not found, e.g. ["cotizacion.txt"]. */
  faltantes: z.array(z.string()),
})
export type Paquete = z.infer<typeof PaqueteSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Control results (PRD §7.3, HU-2)
// ─────────────────────────────────────────────────────────────────────────────

export const ReglaSchema = z.enum(["RC1", "RC2", "RC3", "RC4", "RC5", "RC6", "RC7", "RC8", "RC9", "RC10"])
export type Regla = z.infer<typeof ReglaSchema>

/** One finding of a control rule. `valores` carries both sides of a comparison (e.g. solicitud vs cotización). */
export const HallazgoSchema = z.object({
  regla: ReglaSchema,
  tipo: z.enum(["bloqueo", "confirmacion"]),
  codigo: z.string(), // stable machine code, e.g. "PROVEEDOR_INEXISTENTE"
  detalle: z.string(), // human sentence in Spanish
  accion_sugerida: z.string(),
  valores: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})
export type Hallazgo = z.infer<typeof HallazgoSchema>

/** A value the agent completed from masters (RC6/RC7) and must report. */
export const DerivadoSchema = z.object({
  valor: z.string(),
  fuente: z.string(), // e.g. "maestro.proveedores"
  regla: ReglaSchema,
  detalle: z.string(),
})
export type Derivado = z.infer<typeof DerivadoSchema>

export const DerivadosSchema = z.object({
  indicador_iva: DerivadoSchema.optional(),
  condiciones_pago: DerivadoSchema.optional(),
})
export type Derivados = z.infer<typeof DerivadosSchema>

export const ResultadoValidacionSchema = z.object({
  apta: z.boolean(), // true iff bloqueos is empty
  bloqueos: z.array(HallazgoSchema),
  confirmaciones: z.array(HallazgoSchema),
  derivados: DerivadosSchema,
  retroactiva: z.boolean(),
})
export type ResultadoValidacion = z.infer<typeof ResultadoValidacionSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Purchase order payload (PRD §7.4)
// ─────────────────────────────────────────────────────────────────────────────

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string() }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive(),
        descripcion: z.string().max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

/** Where each payload value came from (HU-3). Key = JSON path, e.g. "posiciones[0].precio_unitario". */
export const FuenteSchema = z.enum([
  "solicitud",
  "cotizacion",
  "aprobacion",
  "correo",
  "maestro.proveedores",
  "maestro.centros-costo",
  "maestro.indicadores-iva",
  "maestro.condiciones-pago",
  "derivado",
  "constante",
  "evidencia",
])
export type Fuente = z.infer<typeof FuenteSchema>
export const TrazabilidadSchema = z.record(z.string(), FuenteSchema)
export type Trazabilidad = z.infer<typeof TrazabilidadSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Tool contract (PRD §6.2)
// ─────────────────────────────────────────────────────────────────────────────

export const ErrorCodigoSchema = z.enum([
  "CASO_NO_ENCONTRADO",
  "PAQUETE_INCOMPLETO",
  "JSON_INVALIDO",
  "MONTO_INVALIDO",
  "ARGS_INVALIDOS",
  "BLOQUEADO",
  "CONFIRMACION_REQUERIDA",
  "PAYLOAD_ALTERADO",
  "SAP_ERROR",
  "INTERNO",
])
export type ErrorCodigo = z.infer<typeof ErrorCodigoSchema>

export type ToolError = {
  codigo: ErrorCodigo
  mensaje: string // plain Spanish, safe to show to the user
  sugerencia?: string // what to ask the requester / do next (HU-6)
  detalle?: unknown
}

/** What every `execute` serializes. Tools never throw (PRD §6.2). */
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolError }

/**
 * Execution context passed by the server or demo.ts.
 * `confirmacionHumana` is additive (decision D2): only the server/demo sets it,
 * after the human explicitly confirmed; the model cannot.
 */
export type ToolContext = {
  directory: string // project root; resolve all paths from here
  sessionId: string
  confirmacionHumana?: boolean
}

/** Shape of each tool export in src/tools/oc.ts. Model-visible name = `oc_<export>`. */
export type ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  description: string
  args: Shape
  execute(args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext): Promise<string>
}

const casoArg = z
  .string()
  .regex(/^[a-z0-9-]+$/, "solo minúsculas, dígitos y guiones")
  .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. 'sol-001'")

/**
 * Arg shapes per tool. Objects passed back by the model (paquete, derivados,
 * payload) are accepted loosely: tools re-read the source of truth and treat
 * them as untrusted (decision D2), so a cosmetic difference never breaks the loop.
 */
export const ToolArgs = {
  leer_paquete: { caso: casoArg },
  validar: {
    caso: casoArg,
    paquete: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Paquete devuelto por oc_leer_paquete; la herramienta lo vuelve a leer de la fuente"),
  },
  construir_payload: {
    caso: casoArg,
    paquete: z.record(z.string(), z.unknown()).optional().describe("Paquete devuelto por oc_leer_paquete"),
    derivados: z.record(z.string(), z.unknown()).optional().describe("Derivados devueltos por oc_validar"),
  },
  generar_evidencia: { caso: casoArg },
  crear: {
    caso: casoArg,
    payload: z
      .record(z.string(), z.unknown())
      .describe("El objeto 'payload' devuelto por oc_construir_payload, sin modificar"),
    confirmado: z
      .boolean()
      .optional()
      .describe("true solo si el usuario confirmó explícitamente en su último mensaje"),
  },
} as const satisfies Record<string, z.ZodRawShape>

// Tool outputs (`data`)
export type LeerPaqueteData = Paquete
export type ValidarData = ResultadoValidacion
export type ConstruirPayloadData = {
  payload: OrdenCompra
  payload_sha256: string // sha256 of the canonical JSON of `payload`
  ruta_trazabilidad: string // relative to project root, e.g. "out/sol-001/trazabilidad.json"
}
export type GenerarEvidenciaData = {
  ruta: string // out/<caso>/aprobacion.txt
  ruta_pdf: string | null // out/<caso>/aprobacion.pdf (P1)
  sha256: string // sha256 of the approval content
}
export type CrearData = { numero_oc: string; fecha: string; idempotente: boolean; retroactiva: boolean }

// ─────────────────────────────────────────────────────────────────────────────
// Control log (HU-5) — out/control.csv
// ─────────────────────────────────────────────────────────────────────────────

export type ControlRow = {
  solicitud_id: string
  resultado: "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion" | "rechazada"
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[] // hallazgo codes
  confirmaciones: string[] // hallazgo codes
  ts: string // ISO-8601
}

// ─────────────────────────────────────────────────────────────────────────────
// SAP adapter (PRD §7.4 — exact interface)
// ─────────────────────────────────────────────────────────────────────────────

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}

/** Factory signature implemented by src/sap/mock.ts. */
export type CreateMockSap = (opts: { outDir: string; maestrosDir: string }) => SapAdapter

/** Signature implemented by src/control/log.ts. */
export type AppendControl = (outDir: string, row: ControlRow) => Promise<void>

// ─────────────────────────────────────────────────────────────────────────────
// LLM adapter (PRD §6.1: enviar(mensajes, herramientas) → respuesta)
// ─────────────────────────────────────────────────────────────────────────────

export type LlmToolCall = { id: string; name: string; argumentos: string /* raw JSON from the model */ }

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string }

export type LlmToolSpec = { name: string; description: string; parameters: Record<string, unknown> /* JSON Schema */ }

export type LlmResponse = {
  texto: string | null
  toolCalls: LlmToolCall[]
  uso: { entrada: number; salida: number }
}

export interface LlmAdapter {
  readonly provider: string
  readonly model: string
  enviar(mensajes: LlmMessage[], herramientas: LlmToolSpec[], opciones?: { signal?: AbortSignal }): Promise<LlmResponse>
}

export type LlmErrorCodigo = "SIN_CLAVE" | "TIMEOUT" | "AUTH" | "RATE_LIMIT" | "PROVEEDOR"

// ─────────────────────────────────────────────────────────────────────────────
// HTTP API DTOs (PRD §6.4) — shared by src/server.ts and web/
// ─────────────────────────────────────────────────────────────────────────────

export const ChatRequestSchema = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.string().min(1).max(4000),
})
export type ChatRequest = z.infer<typeof ChatRequestSchema>

export type ToolCallView = {
  id: string
  nombre: string // e.g. "oc_validar"
  argumentos: unknown
  ok: boolean
  resumen: string // one-line human summary of the result
  resultado: unknown // parsed tool JSON (data or error)
  duracion_ms: number
}

export type ApiError = { codigo: LlmErrorCodigo | "LIMITE_ITERACIONES" | "LIMITE_TOKENS" | "SOLICITUD_INVALIDA" | "INTERNO"; mensaje: string }

export type ChatResponse = {
  reply: string
  toolCalls: ToolCallView[]
  needsConfirmation: boolean
  error?: ApiError
}

export type MensajeView = {
  rol: "user" | "assistant"
  texto: string
  toolCalls?: ToolCallView[]
  needsConfirmation?: boolean
  error?: ApiError
  ts: string
}

export type SessionView = {
  sessionId: string
  mensajes: MensajeView[]
  tokensUsados: number
  pendiente: { caso: string } | null
}

export type HealthResponse = { ok: true; provider: string; model: string }
