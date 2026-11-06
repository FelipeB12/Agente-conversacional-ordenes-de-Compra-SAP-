# Módulo reutilizable del agente de órdenes de compra

Empaqueta el agente para otras plataformas de agentes. No hay copias: cada pieza apunta al archivo que usa la app.

| Pieza | Qué es | Archivo de la app (fuente única) |
|---|---|---|
| `agent.md` | Agente (system prompt, `mode: primary`, sin `edit` ni `bash`) | `agent/prompt.md` (symlink) |
| `skill/ordenes-compra/SKILL.md` | Conocimiento del proceso y reglas RC1-RC10 | `src/knowledge/ordenes-compra.md` (symlink) |
| `tools/oc.ts` | Herramientas `leer_paquete`, `validar`, `construir_payload`, `generar_evidencia`, `crear` | `src/tools/oc.ts` (reexportadas) |

## Instalación en un host estilo OpenCode

1. Agente: copia o enlaza `modulo/agent.md` en el directorio de agentes del host.
2. Herramientas: copia o enlaza `modulo/tools/oc.ts` en el directorio de herramientas; los nombres pasan a ser `oc_<export>` (`oc_leer_paquete`, `oc_validar`, `oc_construir_payload`, `oc_generar_evidencia`, `oc_crear`). Importa `../../src/...`, así que debe seguir dentro de este repositorio (enlázalo, no lo copies solo).
3. Skill: copia o enlaza `modulo/skill/ordenes-compra/` en el directorio de skills.
4. Permisos: configura `oc_crear` con permiso `ask`. Fuera de nuestro servidor, el aviso de permiso del host es la compuerta humana; al aprobarse, la llamada con `confirmado: true` se trata como confirmación humana. La protección de montos (verificación de campos críticos, payload reconstruido en servidor) no cambia.
5. `ctx.directory` debe ser la raíz de este repositorio (de ahí se leen `fixtures/` y se escribe `out/`).

## Requisitos

Node 22 y `npm install` (zod, pdf-lib).

## Verificación

`npm run check:modulo` comprueba symlinks, frontmatter, las 5 herramientas y una corrida de `leer_paquete` + `validar` sobre `sol-001`.
