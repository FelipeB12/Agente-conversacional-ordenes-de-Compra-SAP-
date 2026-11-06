# Agente conversacional de Órdenes de Compra SAP

Agente de chat que lee una solicitud de compra con su cotización y aprobación, valida las reglas de control (RC1–RC10), prepara la orden de compra y la crea en un SAP simulado tras la confirmación humana.

## Link de prueba

**PENDIENTE**

El link es público; no requiere clave de acceso.

## Requisitos

- Node.js 20 o superior.
- Una clave de API de OpenAI (solo para el chat; `npm run demo` no la necesita).

## Arranque local

```bash
cp .env.example .env        # y completar OPENAI_API_KEY
npm install && npm run dev
```

- UI: http://localhost:5173
- API: http://localhost:3000

Modo producción (un solo proceso, UI servida por el backend):

```bash
npm run build && npm start   # http://localhost:3000
```

## Variables de entorno

| Variable | Obligatoria | Valor por defecto | Descripción |
|---|---|---|---|
| `OPENAI_API_KEY` | Sí, para el chat | — | Clave de OpenAI. Solo en el backend; nunca se expone al front ni en respuestas. |
| `OPENAI_MODEL` | No | `gpt-4.1-mini` | Modelo usado por el agente. |
| `LLM_TIMEOUT_MS` | No | `30000` | Tiempo máximo de espera por respuesta del modelo (ms). |
| `MAX_ITERATIONS_PER_TURN` | No | `25` | Tope de llamadas al modelo por turno. |
| `MAX_TOKENS_PER_SESSION` | No | `200000` | Tope de tokens por sesión. |
| `PORT` | No | `3000` | Puerto del servidor. Render lo asigna solo. |

## Demo sin modelo

```bash
npm install && npm run demo
```

Ejecuta las herramientas directamente sobre los 6 casos de `fixtures/reto-03/solicitudes/`, sin clave de ningún proveedor. Limpia `out/` al inicio. Muestra por caso si la solicitud es apta, los bloqueos y confirmaciones, si es retroactiva y el número de OC o el motivo. Ejecuta `sol-001` dos veces para mostrar la idempotencia.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | Cuerpo: `{ "sessionId": string, "message": string }`. Respuesta: `{ reply, toolCalls[], needsConfirmation, error? }`. |
| `GET` | `/api/sessions/:id` | Respuesta: `{ sessionId, mensajes[], tokensUsados, pendiente }`. Historial completo de la sesión. |
| `GET` | `/api/health` | Respuesta: `{ ok: true, provider, model }`. No expone claves. |

Los tipos están en `src/types.ts` (`ChatRequest`, `ChatResponse`, `SessionView`, `HealthResponse`).

## Prompt de la demo

Chat nuevo, en la UI:

```
Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué
validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.
```

Esperado: payload resumido en tabla, confirmaciones con los dos valores (solicitud vs cotización), llamadas a herramientas visibles y una pregunta al cierre del turno. Tras confirmar, número de OC y ruta de la evidencia.

## Estructura del repositorio

| Ruta | Qué contiene |
|---|---|
| `agent/prompt.md` | Comportamiento del agente (system prompt). |
| `src/knowledge/` | Conocimiento del proceso: reglas RC1–RC10 en lenguaje de negocio. |
| `src/tools/oc.ts` | Ejecución: herramientas tipadas con zod (`oc_<nombre>`). Son la única fuente de valores. |
| `src/sap/` | Adaptador SAP (`adapter.ts`) y simulación con archivos (`mock.ts`). |
| `src/llm/` | Adaptador del proveedor LLM (OpenAI). |
| `src/agent/` | Ciclo del agente, sesiones y confirmación humana. |
| `web/` | Interfaz de chat (React + Vite). |
| `fixtures/` | Datos de entrada entregados. Solo lectura. |
| `out/` | Salidas generadas: `sap/ordenes.jsonl` (OC creadas), `control.csv` (bitácora de control), `log.jsonl` (llamadas a herramientas), `<caso>/` (trazabilidad, evidencia `aprobacion.txt` y `aprobacion.pdf`). |

La solución completa, con decisiones y supuestos, está en [SOLUCION.md](SOLUCION.md).

## Despliegue en Render

Pasos para el propietario del repositorio:

1. Subir el proyecto a un repositorio **público** de GitHub.
2. En el dashboard de Render: **New → Blueprint**.
3. Seleccionar el repositorio. Render leerá `render.yaml`.
4. Cuando lo pida, ingresar `OPENAI_API_KEY`.
5. **Apply** y esperar el primer despliegue.
6. Copiar la URL del servicio y reemplazar **PENDIENTE** en la sección "Link de prueba".

Nota: el plan gratuito de Render duerme el servicio tras un tiempo sin uso. Abrir el link un minuto antes de la defensa para que despierte.
