// lib/conversacion.js — INDx lee el hilo del cliente DIRECTO de Supabase.
// Fuente única de verdad: la tabla `inbox.mensajes` (cuenta=IND), la misma que ve
// el inbox de IND. Reemplaza el viejo salto HTTP a ind-inbox-v2/api/conversacion
// (una dependencia extra que devolvía [] si el inbox estaba lento o caído).
//
// Mapeo: direccion ENTRANTE = cliente (role 'user'); SALIENTE = Indi o el vendedor
// humano (ambos son la voz de la tienda → role 'assistant').
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim()
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
const CUENTA = 'IND'

// Contenido legible para mensajes sin texto (imagen/audio/etc), para no mandar
// contenido vacío a la API de Claude (que lo rechaza).
function contenidoDe(row) {
  const t = (row.texto || '').trim()
  if (t) return t
  const b = (row.botones || '').trim()
  if (b) return b
  const tipo = (row.tipo || '').toLowerCase()
  if (row.media_url || /imagen|image|foto|sticker/.test(tipo)) return '[imagen]'
  if (/audio/.test(tipo)) return '[audio]'
  if (/video/.test(tipo)) return '[video]'
  if (/location/.test(tipo)) return '[ubicación]'
  if (/order/.test(tipo)) return '[pedido]'
  if (/document/.test(tipo)) return '[documento]'
  return '[mensaje]'
}

export async function getConversacion(phone, limite = 20) {
  if (!phone || !SUPABASE_URL || !SUPABASE_KEY) return []
  const last9 = String(phone).replace(/\D/g, '').slice(-9)
  if (!last9) return []

  try {
    // Traemos de más (limite*3) porque luego fusionamos mensajes consecutivos del
    // mismo lado en un solo turno.
    const url = `${SUPABASE_URL}/rest/v1/mensajes`
      + `?select=direccion,tipo,texto,botones,media_url,fecha`
      + `&cuenta=eq.${CUENTA}`
      + `&telefono=like.*${last9}`
      + `&order=fecha.desc`
      + `&limit=${Math.max(6, limite * 3)}`

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Accept-Profile': 'inbox',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error('INDx getConversacion supabase', res.status, await res.text().catch(() => ''))
      return []
    }
    const rows = await res.json()
    if (!Array.isArray(rows) || !rows.length) return []

    rows.reverse() // venía DESC (nuevo→viejo) → a cronológico (viejo→nuevo)

    // Mapear a {role, content} FUSIONANDO consecutivos del mismo rol → alternancia
    // limpia (user/assistant/…), que es lo que espera la API de Claude.
    const merged = []
    for (const row of rows) {
      const role = row.direccion === 'ENTRANTE' ? 'user' : 'assistant'
      const content = contenidoDe(row)
      const last = merged[merged.length - 1]
      if (last && last.role === role) last.content += `\n${content}`
      else merged.push({ role, content })
    }

    // Recortar a ~`limite` turnos y garantizar que arranque en 'user'.
    let out = merged
    const maxMsgs = limite * 2
    if (out.length > maxMsgs) out = out.slice(-maxMsgs)
    while (out.length && out[0].role === 'assistant') out.shift()
    return out
  } catch (err) {
    console.error('INDx getConversacion (supabase) falló:', err.message)
    return []
  }
}
