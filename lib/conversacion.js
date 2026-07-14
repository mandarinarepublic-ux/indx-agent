// lib/conversacion.js — INDx lee la conversación (memoria del hilo) DESDE EL INBOX de IND.
//
// El inbox (ind-inbox-v2) persiste TODOS los mensajes de WhatsApp en Supabase
// (inbox.mensajes, cuenta=IND) — incluye lo que respondió un vendedor humano en modo
// HUMANO. El endpoint /api/conversacion está hecho justo para esto: devuelve el hilo
// como [{ role:'user'|'assistant', content }], ya SIN el último mensaje del cliente
// (el que se está por responder — el bot lo agrega por su cuenta).
//
// Reemplaza al viejo Map en memoria (no fiable en Vercel serverless). Fuente única de
// verdad = el inbox; el bot no persiste nada. Si el inbox falla → [], e Indi responde
// igual (sin memoria ese turno), nunca se cae.
const INBOX_BASE = process.env.INBOX_BASE || 'https://ind-inbox-v2.vercel.app';

export async function getConversacion(phone, limite = 20) {
  if (!phone) return [];
  try {
    const res = await fetch(
      `${INBOX_BASE}/api/conversacion?phone=${encodeURIComponent(phone)}&limite=${limite}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('INDx getConversacion (via inbox) falló:', err.message);
    return [];
  }
}
