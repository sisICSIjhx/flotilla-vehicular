# Guía general: avisos de WhatsApp (Green API) con Supabase

Receta reutilizable para cualquier proyecto con Supabase (Postgres + Edge Functions). Permite que **cualquier evento de negocio** genere un mensaje de WhatsApp (y opcionalmente un correo) sin tocar la Edge Function cada vez que se agrega un evento nuevo.

---

## 1. Arquitectura

```
Evento de negocio (trigger, función/RPC o pg_cron)
        │  INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje)
        ▼
Trigger AFTER INSERT ──► enviar_notificacion_externa()
        │  net.http_post (pg_net, asíncrono) + header x-webhook-secret
        ▼
Edge Function "notificar"
        ├─► Green API  (WhatsApp)
        └─► Resend     (correo, opcional)
```

**Idea central:** todo evento se reduce a *insertar una fila en `notificaciones`*. Un único trigger la reenvía a la Edge Function. Agregar un evento nuevo = escribir un `INSERT`; nada más cambia.

Piezas:

| Pieza | Para qué |
|---|---|
| Tabla `notificaciones` | Cola/bitácora de avisos (también sirve para una campanita en la app) |
| Tabla `notificaciones_push_config` | Fila única: URL de la función, secreto compartido, interruptor on/off |
| Función + trigger `enviar_notificacion_externa` | Llama a la Edge Function al insertar una notificación |
| Edge Function | Da formato al texto y llama a Green API |
| Secrets de la función | Credenciales de Green API y destino |
| Emisores de eventos | Triggers / funciones / crons que insertan en `notificaciones` |

---

## 2. Paso 1 — Configurar Green API (fuera de Supabase)

1. Crear cuenta en <https://green-api.com> y crear una **instancia** (el plan gratuito "Developer" tiene límites; revisarlos).
2. **Autorizar la instancia:** en la consola escanear el QR con el WhatsApp del número emisor (*Dispositivos vinculados*). Recomendado usar un número dedicado.
3. Anotar los datos de la consola:
   - `idInstance`
   - `apiTokenInstance`
   - Host de la instancia (`apiUrl`), p. ej. `https://XXXX.api.greenapi.com`
4. Definir el **destino** (`chatId`):
   - Persona: `<código país><número>@c.us` (ej. `5215512345678@c.us`).
   - Grupo: termina en `@g.us`. Se obtiene con el método `getChats` de la API.
5. Probar el envío directo antes de tocar Supabase:

```bash
curl -X POST "https://XXXX.api.greenapi.com/waInstance<ID>/sendMessage/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"5215512345678@c.us","message":"prueba"}'
```

Si esto no llega, el problema es de Green API (instancia sin autorizar, chatId mal formado), no de Supabase.

---

## 3. Paso 2 — Tabla de notificaciones

Adaptar las columnas opcionales (`referencia_id`, `referencia_codigo`) a lo que tu proyecto necesite enlazar (pedido, ticket, cliente, etc.).

```sql
CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo VARCHAR(40) NOT NULL,                       -- identifica el evento: 'nuevo_pedido', 'stock_bajo', ...
  destinatario VARCHAR(20) NOT NULL DEFAULT 'admin',
  titulo VARCHAR(120) NOT NULL,
  mensaje TEXT,                                    -- campos separados por ' | '
  referencia_id UUID,                              -- opcional: id del registro que originó el aviso
  referencia_codigo VARCHAR(40),                   -- opcional: código legible
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_notificacion_destinatario
    CHECK (destinatario IN ('admin', 'operador'))  -- ajustar a tus roles
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_no_leidas
  ON notificaciones(destinatario, leida, created_at DESC);
```

Convenciones:

- **`destinatario`** decide si sale por WhatsApp. En esta receta solo `'admin'` se reenvía; los demás quedan solo en la app.
- **`mensaje`** lleva los datos separados por `" | "`. La Edge Function convierte cada segmento en un renglón (WhatsApp) o `<li>` (correo). Así los emisores no se preocupan del formato.
- **`tipo`** puede usarse en la función para variar el enlace o el formato (por prefijo, p. ej. `tipo.startsWith('stock')`).

---

## 4. Paso 3 — Configuración del webhook y trigger

Ejecutar en el SQL Editor de Supabase (idempotente).

```sql
-- 4.1 Extensión para HTTP asíncrono desde la BD
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 4.2 Configuración (fila única)
CREATE TABLE IF NOT EXISTS notificaciones_push_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- fuerza una sola fila
  habilitado BOOLEAN NOT NULL DEFAULT TRUE,        -- interruptor general
  edge_function_url TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS activado SIN policies => invisible para anon/authenticated
ALTER TABLE notificaciones_push_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON notificaciones_push_config TO service_role;

INSERT INTO notificaciones_push_config (id, habilitado, edge_function_url, webhook_secret)
VALUES (
  TRUE, TRUE,
  'https://<PROJECT_REF>.supabase.co/functions/v1/notificar',
  '<SECRETO_LARGO_ALEATORIO>'
)
ON CONFLICT (id) DO NOTHING;

-- 4.3 Función del trigger
CREATE OR REPLACE FUNCTION enviar_notificacion_externa()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg notificaciones_push_config%ROWTYPE;
BEGIN
  IF NEW.destinatario <> 'admin' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_cfg FROM notificaciones_push_config WHERE habilitado LIMIT 1;
  IF v_cfg.id IS NULL THEN
    RETURN NEW;  -- deshabilitado o sin configurar
  END IF;

  PERFORM net.http_post(
    url := v_cfg.edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_cfg.webhook_secret
    ),
    body := jsonb_build_object(
      'id', NEW.id,
      'tipo', NEW.tipo,
      'titulo', NEW.titulo,
      'mensaje', NEW.mensaje,
      'referencia_id', NEW.referencia_id,
      'referencia_codigo', NEW.referencia_codigo,
      'created_at', NEW.created_at
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- un fallo del webhook NUNCA debe romper la operación original
END;
$$ LANGUAGE plpgsql;

-- 4.4 Trigger
DROP TRIGGER IF EXISTS trg_enviar_notificacion_externa ON notificaciones;
CREATE TRIGGER trg_enviar_notificacion_externa
AFTER INSERT ON notificaciones
FOR EACH ROW
EXECUTE FUNCTION enviar_notificacion_externa();
```

Puntos clave:

- `pg_net` es **asíncrono**: no retrasa el INSERT original.
- El `EXCEPTION WHEN OTHERS` garantiza que si el webhook falla, la operación de negocio sigue.
- **Secreto:** generarlo aleatorio (`openssl rand -hex 24`) y **no subirlo a git**. Escribirlo directamente en el SQL Editor al ejecutar, no en un archivo versionado.
- Si cambias los campos del `body`, ajusta la interfaz `NotificacionPayload` de la Edge Function.

---

## 5. Paso 4 — Edge Function

Crear con `supabase functions new notificar` y poner en `supabase/functions/notificar/index.ts`:

```ts
interface NotificacionPayload {
  id: string
  tipo: string
  titulo: string
  mensaje: string | null
  referencia_id: string | null
  referencia_codigo: string | null
  created_at: string
}

// Enlace opcional al final del mensaje. Adaptar a las rutas de tu app.
function enlaceDe(n: NotificacionPayload, appUrl: string | null) {
  if (!appUrl) return { url: null, label: '' }
  const base = appUrl.replace(/\/$/, '')
  // Ejemplo: if (n.tipo.startsWith('stock')) return { url: `${base}/inventario`, label: 'Ver inventario' }
  return { url: `${base}/`, label: 'Abrir app' }
}

// Acepta teléfono (se limpia) o un chatId ya armado (@c.us / @g.us)
function toChatId(valor: string): string {
  return valor.includes('@') ? valor : `${valor.replace(/\D/g, '')}@c.us`
}

async function enviarWhatsApp(n: NotificacionPayload, enlace: { url: string | null; label: string }) {
  const apiUrl = Deno.env.get('GREENAPI_API_URL')
  const idInstance = Deno.env.get('GREENAPI_ID_INSTANCE')
  const token = Deno.env.get('GREENAPI_API_TOKEN_INSTANCE')
  const destino = Deno.env.get('GREENAPI_CHAT_ID')
  if (!apiUrl || !idInstance || !token || !destino) {
    return { canal: 'whatsapp', enviado: false, razon: 'sin configurar' }
  }

  const texto = [
    `*${n.titulo}*`,
    (n.mensaje ?? '').split(' | ').join('\n'),
    enlace.url ? `${enlace.label}: ${enlace.url}` : '',
  ].filter(Boolean).join('\n\n')

  const res = await fetch(
    `${apiUrl.replace(/\/$/, '')}/waInstance${idInstance}/sendMessage/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: toChatId(destino), message: texto }),
    },
  )
  if (!res.ok) {
    return { canal: 'whatsapp', enviado: false, razon: `GreenAPI ${res.status}: ${await res.text()}` }
  }
  return { canal: 'whatsapp', enviado: true }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = Deno.env.get('WEBHOOK_SECRET')
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  let n: NotificacionPayload
  try { n = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const enlace = enlaceDe(n, Deno.env.get('APP_URL') ?? null)
  const resultados = await Promise.allSettled([enviarWhatsApp(n, enlace)])
  const detalle = resultados.map((r) =>
    r.status === 'fulfilled' ? r.value : { enviado: false, razon: String(r.reason) })

  console.log('notificar', n.id, JSON.stringify(detalle))
  return new Response(JSON.stringify({ ok: true, detalle }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

**Canal de correo (opcional):** agregar una función `enviarCorreo` que haga `POST https://api.resend.com/emails` con `Authorization: Bearer <RESEND_API_KEY>` y añadirla al `Promise.allSettled`. Cada canal se omite solo si faltan sus secrets.

### Secrets

```bash
supabase secrets set \
  WEBHOOK_SECRET=<el mismo valor de notificaciones_push_config.webhook_secret> \
  APP_URL=https://tu-app.vercel.app \
  GREENAPI_API_URL=https://XXXX.api.greenapi.com \
  GREENAPI_ID_INSTANCE=<idInstance> \
  GREENAPI_API_TOKEN_INSTANCE=<apiTokenInstance> \
  GREENAPI_CHAT_ID=5215512345678
```

(También se pueden cargar en Dashboard → Edge Functions → Secrets.)

### Deploy

```bash
supabase functions deploy notificar --no-verify-jwt
```

`--no-verify-jwt` es **obligatorio**: `pg_net` no envía JWT; la autenticación la hace el header `x-webhook-secret`.

---

## 6. Paso 5 — Conectar eventos (el corazón de la receta)

Todo evento = un `INSERT INTO notificaciones` con `destinatario = 'admin'`. Solo cambia *dónde* se dispara.

Plantilla base:

```sql
INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje, referencia_id, referencia_codigo)
VALUES (
  'nombre_del_evento',
  'admin',
  '🔔 Título corto y claro',
  'Campo 1: valor | Campo 2: valor | Campo 3: valor',
  NEW.id,
  NEW.codigo
);
```

### 6.1 Evento al insertar/actualizar un registro (trigger)

```sql
CREATE OR REPLACE FUNCTION notificar_nuevo_X()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje, referencia_id)
  VALUES ('nuevo_x', 'admin', 'Nuevo X creado',
          'Folio: ' || NEW.folio || ' | Cliente: ' || COALESCE(NEW.cliente, 'N/A'),
          NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- el aviso nunca debe bloquear la operación
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notificar_nuevo_x
AFTER INSERT ON mi_tabla
FOR EACH ROW EXECUTE FUNCTION notificar_nuevo_X();
```

Para reaccionar a un **cambio de estado**, usar `AFTER UPDATE` y comparar: `IF OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'aprobado' THEN ...`.

### 6.2 Evento dentro de una función/RPC existente

Añadir el `INSERT INTO notificaciones ...` justo después de la operación principal, dentro de la misma función.

### 6.3 Evento periódico o por condición (pg_cron)

Para avisos tipo "stock bajo", "vencimientos", "recordatorios":

```sql
CREATE OR REPLACE FUNCTION evaluar_alertas_X()
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM mi_tabla WHERE condicion_de_alerta LOOP
    -- anti-spam: no repetir si ya se avisó (ver 6.4)
    CONTINUE WHEN EXISTS (SELECT 1 FROM alertas_enviadas WHERE clave = r.id::text);

    INSERT INTO alertas_enviadas (clave) VALUES (r.id::text);
    INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje)
    VALUES ('alerta_x', 'admin', '🟡 Alerta X', 'Elemento: ' || r.nombre);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- pg_cron corre en UTC. Convertir tu horario local a UTC.
-- Ej.: 08:00 en GMT-6 = 14:00 UTC
SELECT cron.schedule('alertas-x-manana', '0 14 * * *', $$SELECT evaluar_alertas_X()$$);
SELECT cron.schedule('alertas-x-tarde',  '0 20 * * *', $$SELECT evaluar_alertas_X()$$);
```

- Volver a llamar `cron.schedule` con el **mismo nombre** reemplaza el job.
- Programar los crons **dentro del horario en que quieres que lleguen mensajes**.

### 6.4 Anti-spam (evitar avisos repetidos)

Decide por evento si el aviso debe salir **una vez** o **repetirse** hasta que se atienda:

- **Una sola vez:** tabla bitácora con índice único parcial.

  ```sql
  CREATE TABLE alertas_enviadas (
    id SERIAL PRIMARY KEY,
    clave TEXT NOT NULL,          -- p. ej. id del registro + umbral
    etapa VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX ux_alerta_unica ON alertas_enviadas(clave) WHERE etapa = 'previo';
  ```

- **Repetir hasta atender:** no registrar en bitácora y dejar que cada corrida del cron vuelva a avisar, con una condición de corte clara (p. ej. "ya está atendido", "ya está en proceso"). Incluir en el mensaje cómo detener el aviso.

---

## 7. Paso 6 — Verificación

```sql
-- Prueba end-to-end: debe llegar un WhatsApp
INSERT INTO notificaciones (tipo, destinatario, titulo, mensaje)
VALUES ('prueba', 'admin', 'Prueba', 'Campo A: 1 | Campo B: 2');

-- Respuestas HTTP de pg_net (¿401? ¿500? ¿timeout?)
SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;

-- Cron
SELECT * FROM cron.job;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- Ejecutar manualmente una función de alertas
SELECT * FROM evaluar_alertas_X();
```

Logs de la Edge Function: Dashboard → Edge Functions → Logs (ahí queda el `console.log` con el resultado de cada canal).

**Diagnóstico rápido si no llega el mensaje:**

| Síntoma | Causa probable |
|---|---|
| `net._http_response` sin filas | Trigger no creado, `habilitado = false`, o `destinatario <> 'admin'` |
| Respuesta 401 | `WEBHOOK_SECRET` distinto al de `notificaciones_push_config` |
| Respuesta 404 | URL de la función mal escrita o función no desplegada |
| `sin configurar` en logs | Falta algún secret `GREENAPI_*` |
| `GreenAPI 4xx` en logs | Token/instancia incorrectos, chatId mal formado |
| Todo OK pero no llega | Instancia de Green API desautorizada (revisar consola y re-escanear QR) |

---

## 8. Trampas y buenas prácticas

1. **RLS sin policies bloquea todo** a `anon`/`authenticated`. Es lo deseado en `notificaciones_push_config`, pero si una tabla la lee tu app (p. ej. `notificaciones` para una campanita) necesita policy o RLS desactivado. Revisar cada tabla nueva.
2. **Secretos fuera de git.** Ni el `webhook_secret` ni los tokens de Green API deben quedar en archivos versionados.
3. **Caracteres especiales en el mensaje.** Algunos proveedores de WhatsApp interpretan secuencias como `$1` de forma especial (pasó con CallMeBot: `$1000` llegaba como `000`; se resolvió escribiendo `$ 1000`). No verificado con Green API: probar una vez si tus mensajes llevan montos.
4. **Una sola fuente de verdad para la lógica.** Si un umbral o cálculo existe en el frontend **y** en SQL, pueden divergir y generar avisos falsos. Mantener la regla en un solo lugar (idealmente la función SQL) o alinear ambas.
5. **Los avisos nunca bloquean la operación.** Mantener `EXCEPTION WHEN OTHERS THEN RETURN NEW` en triggers emisores y en `enviar_notificacion_externa`.
6. **Zona horaria.** pg_cron usa UTC. Convertir el horario de atención y documentarlo. Formatear fechas en el mensaje con `AT TIME ZONE 'America/Mexico_City'` (o la zona que corresponda).
7. **Mensajes cortos y accionables.** Título claro con emoji, 3–7 campos, y un enlace a la pantalla donde se atiende.
8. **Instancia de Green API.** Si el teléfono emisor cierra la sesión de WhatsApp, deja de enviar. Vigilar el estado en la consola.
9. **Interruptor de emergencia.** `UPDATE notificaciones_push_config SET habilitado = false;` apaga todos los avisos sin tocar triggers ni crons.
10. **Límites del plan de Green API.** Revisar cuota de mensajes y restricciones del plan gratuito antes de programar crons frecuentes.

---

## 9. Checklist de implementación

- [ ] Instancia de Green API creada y autorizada (QR escaneado)
- [ ] Prueba con `curl` exitosa
- [ ] Tabla `notificaciones` creada (adaptada al proyecto)
- [ ] `pg_net` habilitado, `notificaciones_push_config` con URL y secreto propio
- [ ] Función y trigger `enviar_notificacion_externa` creados
- [ ] Edge Function escrita y desplegada con `--no-verify-jwt`
- [ ] Secrets cargados (`WEBHOOK_SECRET`, `APP_URL`, `GREENAPI_*`)
- [ ] `INSERT` manual de prueba → llega WhatsApp
- [ ] Lista de eventos del proyecto definida (evento, `tipo`, origen, ¿una vez o repetido?)
- [ ] Cada evento conectado (trigger / RPC / cron) y probado
- [ ] Crons con horario UTC correcto y dentro del horario de atención
- [ ] Ningún secreto en git

### Plantilla para documentar los eventos de un proyecto

| Evento | `tipo` | Origen (trigger / RPC / cron) | Frecuencia | Campos del mensaje | Enlace |
|---|---|---|---|---|---|
| _ej. Pedido nuevo_ | `nuevo_pedido` | trigger AFTER INSERT en `pedidos` | inmediato, una vez | folio, cliente, total | `/pedidos` |
| _ej. Stock bajo_ | `stock_bajo` | cron 2×/día | repite hasta reponer | producto, existencia, mínimo | `/inventario` |
