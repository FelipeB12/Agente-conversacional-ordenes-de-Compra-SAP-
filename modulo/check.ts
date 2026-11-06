/**
 * Verifies the module is the app's own pieces (no divergent copies) and that
 * its tools run without the server. Run: npm run check:modulo
 */
import { lstat, readFile, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let fallos = 0

async function check(nombre: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${nombre}`)
  } catch (e) {
    fallos++
    console.log(`FAIL ${nombre}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function afirmar(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const pares = [
  { enlace: "modulo/agent.md", fuente: "agent/prompt.md", claves: ["description", "mode", "permission"] },
  { enlace: "modulo/skill/ordenes-compra/SKILL.md", fuente: "src/knowledge/ordenes-compra.md", claves: ["name", "description"] },
]

for (const p of pares) {
  const enlace = path.join(raiz, p.enlace)
  const fuente = path.join(raiz, p.fuente)
  await check(`${p.enlace} es symlink a ${p.fuente} (idéntico)`, async () => {
    afirmar((await lstat(enlace)).isSymbolicLink(), "no es symlink")
    afirmar((await realpath(enlace)) === (await realpath(fuente)), "no resuelve al archivo de la app")
    afirmar((await readFile(enlace)).equals(await readFile(fuente)), "contenido distinto")
  })
  await check(`${p.enlace} frontmatter con ${p.claves.join(", ")}`, async () => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(await readFile(enlace, "utf8"))
    afirmar(m !== null, "sin frontmatter")
    const bloque = m?.[1] ?? ""
    for (const k of p.claves) afirmar(new RegExp(`^${k}:`, "m").test(bloque), `falta '${k}'`)
  })
}

const tools = await import("./tools/oc.js")

await check("modulo/tools/oc.ts exporta 5 herramientas completas", async () => {
  const lista = Object.entries(tools)
  afirmar(lista.length === 5, `se esperaban 5, hay ${lista.length}`)
  for (const [n, t] of lista) {
    afirmar(typeof t.description === "string" && t.description.length > 0, `${n}: sin description`)
    afirmar(typeof t.args === "object" && t.args !== null, `${n}: sin args`)
    afirmar(typeof t.execute === "function", `${n}: sin execute`)
  }
})

await check("leer_paquete + validar sobre sol-001", async () => {
  const ctx = { directory: raiz, sessionId: "modulo-check" }
  const leido = JSON.parse(await tools.leer_paquete.execute({ caso: "sol-001" }, ctx)) as { ok: boolean }
  afirmar(leido.ok === true, "leer_paquete devolvió ok=false")
  const val = JSON.parse(await tools.validar.execute({ caso: "sol-001" }, ctx)) as { ok: boolean }
  afirmar(val.ok === true, "validar devolvió ok=false")
})

await rm(path.join(raiz, "out"), { recursive: true, force: true })
process.exit(fallos > 0 ? 1 : 0)
