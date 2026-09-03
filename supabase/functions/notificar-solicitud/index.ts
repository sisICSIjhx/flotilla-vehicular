// =========================================================
// Edge Function: notificar-solicitud
// Recibe el webhook del trigger enviar_notificacion_externa()
// (tabla notificaciones, destinatario=admin) y avisa a la
// persona administradora por correo (Resend) y/o WhatsApp
// (Green API). Cada canal se omite si no está configurado.
//
// Secrets requeridos (supabase secrets set / dashboard):
//   WEBHOOK_SECRET      — debe coincidir con notificaciones_push_config.webhook_secret
//   APP_URL             — ej. https://control-recorridos.vercel.app (para el enlace a /solicitudes)
//
// Canal correo (opcional):
//   RESEND_API_KEY      — API key de https://resend.com
//   NOTIF_EMAIL_TO      — correo de la administradora
//   NOTIF_EMAIL_FROM    — remitente verificado en Resend (default: onboarding@resend.dev)
//
// Canal WhatsApp (opcional, vía Green API — https://green-api.com):
//   GREENAPI_API_URL             — host de la instancia, ej. https://7105.api.greenapi.com
//   GREENAPI_ID_INSTANCE         — idInstance de la consola de Green API
//   GREENAPI_API_TOKEN_INSTANCE  — apiTokenInstance de la consola de Green API
//   GREENAPI_CHAT_ID             — destino: teléfono con código de país (+5215512345678)
//                                   o chatId de grupo (termina en @g.us, se usa tal cual).
//                                   El id de un grupo se obtiene con el método getChats.
//
// Deploy: supabase functions deploy notificar-solicitud --no-verify-jwt
// (la autenticación la hace el header x-webhook-secret)
// =========================================================

interface NotificacionPayload {
  id: string
  tipo: string
  titulo: string
  mensaje: string | null
  solicitud_id: string | null
  vehiculo_codigo: string | null
  created_at: string
}

// Las notificaciones de mantenimiento llevan al panel de mantenimientos;
// el resto (solicitudes de combustible) a la pantalla de autorización.
function destinoDe(notif: NotificacionPayload, appUrl: string | null): { url: string | null; label: string } {
  if (!appUrl) return { url: null, label: '' }
  const base = appUrl.replace(/\/$/, '')
  if (notif.tipo.startsWith('mantenimiento')) {
    return { url: `${base}/admin/mantenimientos`, label: 'Ver mantenimientos' }
  }
  return { url: `${base}/solicitudes`, label: 'Autorizar/Rechazar' }
}

async function enviarCorreo(notif: NotificacionPayload, destino: { url: string | null; label: string }) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const to = Deno.env.get('NOTIF_EMAIL_TO')
  if (!apiKey || !to) return { canal: 'email', enviado: false, razon: 'sin configurar' }

  const from = Deno.env.get('NOTIF_EMAIL_FROM') ?? 'onboarding@resend.dev'
  const detalle = (notif.mensaje ?? '').split(' | ').map((l) => `<li>${l}</li>`).join('')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Control de Recorridos <${from}>`,
      to: [to],
      subject: notif.titulo,
      html: `
        <h2>${notif.titulo}</h2>
        <ul>${detalle}</ul>
        ${destino.url ? `<p><a href="${destino.url}">${destino.label}</a></p>` : ''}
      `,
    }),
  })

  if (!res.ok) {
    return { canal: 'email', enviado: false, razon: `Resend ${res.status}: ${await res.text()}` }
  }
  return { canal: 'email', enviado: true }
}

// Acepta un teléfono (se limpia y se arma como chat individual) o ya un
// chatId de Green API (grupo @g.us o individual @c.us), tal cual.
function toChatId(valor: string): string {
  return valor.includes('@') ? valor : `${valor.replace(/\D/g, '')}@c.us`
}

async function enviarWhatsApp(notif: NotificacionPayload, destino: { url: string | null; label: string }) {
  const apiUrl = Deno.env.get('GREENAPI_API_URL')
  const idInstance = Deno.env.get('GREENAPI_ID_INSTANCE')
  const apiTokenInstance = Deno.env.get('GREENAPI_API_TOKEN_INSTANCE')
  const destinoChat = Deno.env.get('GREENAPI_CHAT_ID')
  if (!apiUrl || !idInstance || !apiTokenInstance || !destinoChat) {
    return { canal: 'whatsapp', enviado: false, razon: 'sin configurar' }
  }

  const texto = [
    `*${notif.titulo}*`,
    (notif.mensaje ?? '').split(' | ').join('\n'),
    destino.url ? `${destino.label}: ${destino.url}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const chatId = toChatId(destinoChat)
  const url = `${apiUrl.replace(/\/$/, '')}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message: texto }),
  })

  if (!res.ok) {
    return { canal: 'whatsapp', enviado: false, razon: `GreenAPI ${res.status}: ${await res.text()}` }
  }
  return { canal: 'whatsapp', enviado: true }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const secret = Deno.env.get('WEBHOOK_SECRET')
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  let notif: NotificacionPayload
  try {
    notif = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const appUrl = Deno.env.get('APP_URL')
  const destino = destinoDe(notif, appUrl ?? null)

  const resultados = await Promise.allSettled([
    enviarCorreo(notif, destino),
    enviarWhatsApp(notif, destino),
  ])

  const detalle = resultados.map((r) =>
    r.status === 'fulfilled' ? r.value : { enviado: false, razon: String(r.reason) }
  )
  console.log('notificar-solicitud', notif.id, JSON.stringify(detalle))

  return new Response(JSON.stringify({ ok: true, detalle }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
