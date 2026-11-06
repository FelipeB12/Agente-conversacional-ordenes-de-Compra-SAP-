/**
 * Composes the system message from Markdown files on every request, so
 * business/prompt edits take effect without touching or restarting the server.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { PROJECT_ROOT } from "../config.js"

/**
 * Drops a leading `---\n…\n---\n` frontmatter block. WHY: the same two files
 * also serve the reusable module (modulo/, via symlinks) and there they need
 * frontmatter, but the model must never see it in the system message.
 */
export function quitarFrontmatter(texto: string): string {
  return texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
}

/** Reads agent/prompt.md and the process knowledge fresh each call. */
export async function cargarSystemPrompt(root: string = PROJECT_ROOT): Promise<string> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(path.join(root, "agent", "prompt.md"), "utf8"),
    readFile(path.join(root, "src", "knowledge", "ordenes-compra.md"), "utf8"),
  ])
  return `${quitarFrontmatter(prompt).trim()}\n\n# Conocimiento del proceso\n\n${quitarFrontmatter(conocimiento).trim()}\n`
}
