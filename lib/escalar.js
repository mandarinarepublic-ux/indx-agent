// lib/escalar.js — INDx: handoff INVISIBLE a un asesor humano de soporte.
// Marca el contacto en el inbox de IND:
//   estado = SOPORTE  → aparece priorizado en el inbox
//   modoIA = HUMANO   → el webhook deja de auto-responder (el gate ya lo respeta)
// El cliente NO percibe el cambio: mismo número, misma identidad. Un asesor
// continúa el MISMO chat desde el inbox. indx-agent no tiene credenciales de
// Google/Supabase, así que delega la escritura al endpoint del inbox.
const INBOX_BASE = process.env.INBOX_BASE || 'https://ind-inbox-v2.vercel.app';

export async function escalarASoporte(phone) {
  if (!phone) return { ok: false };
  try {
    const patch = (campo, valor) =>
      fetch(`${INBOX_BASE}/api/contactos/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: phone, campo, valor }),
        signal: AbortSignal.timeout(8000),
      });

    const [r1, r2] = await Promise.all([
      patch('estado', 'SOPORTE'),
      patch('modoIA', 'HUMANO'),
    ]);
    const ok = r1.ok && r2.ok;
    console.log(`INDx escalar: ${phone} → SOPORTE/HUMANO via inbox ok=${ok}`);
    return { ok };
  } catch (err) {
    console.error('INDx escalar via inbox falló:', err.message);
    return { ok: false };
  }
}
