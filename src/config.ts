/**
 * Runtime configuration from environment variables, validated once at startup.
 * Centralized so the API key is read in exactly one place and never re-exported raw to clients.
 */
import "dotenv/config"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  MAX_ITERATIONS_PER_TURN: z.coerce.number().int().positive().default(25),
  MAX_TOKENS_PER_SESSION: z.coerce.number().int().positive().default(200000),
  PORT: z.coerce.number().int().positive().default(3000),
})

export type Config = z.infer<typeof EnvSchema>

/** Parsed env. An empty OPENAI_API_KEY is normalized to undefined so "no key" has one representation. */
export const config: Config = (() => {
  const parsed = EnvSchema.parse(process.env)
  return { ...parsed, OPENAI_API_KEY: parsed.OPENAI_API_KEY?.trim() || undefined }
})()

/** Project root (one level above src/). Tools receive it as ctx.directory. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Paths relative to a project root. Fixtures are read-only; everything written goes under out/. */
export function rutas(directory: string) {
  const fixtures = path.join(directory, "fixtures", "reto-03")
  const out = path.join(directory, "out")
  return {
    fixtures,
    solicitudes: path.join(fixtures, "solicitudes"),
    maestros: path.join(fixtures, "maestros"),
    out,
    sap: path.join(out, "sap"),
    caso: (caso: string) => path.join(out, caso),
    logJsonl: path.join(out, "log.jsonl"),
    controlCsv: path.join(out, "control.csv"),
  }
}
