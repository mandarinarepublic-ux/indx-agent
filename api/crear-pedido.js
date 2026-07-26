// api/crear-pedido.js — Botón "CREAR PEDIDO" del IND-Inbox.
// Fork de mandi-agent/api/crear-pedido.js adaptado 100% para IND Store.
// Lee TODA la conversación (transcript), extrae los datos del pedido con Claude,
// valida que estén completos y, si lo están, crea el pedido en el CRM de IND
// devolviendo el número de pedido + la URL para verlo.
// Si faltan datos, devuelve qué falta + un texto sugerido para pedírselo al cliente.
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── CRM (COMPARTIDO con Mandarina, mismo endpoint de producción) ──────────────
// El CRM es multi-tienda: la separación es 100% por `tiendaId`. Con tiendaId 'IND'
// el CRM genera IDs IND-* , dispara el CAPI a INDSTORE y NO mezcla NADA con
// Mandarina. ⚠️ NUNCA uses tiendaId 'MANDARINA' aquí. No hay que modificar el CRM.
// Todo es override por env por si algún día IND tiene su propio CRM.
const CRM_URL   = process.env.IND_CRM_URL  || 'https://mandarina-pro-sales.vercel.app/api/pedidos';
const CRM_BASE  = process.env.IND_CRM_BASE || CRM_URL.replace(/\/api\/pedidos\/?$/, '');
const TIENDA_ID = process.env.IND_TIENDA_ID || 'IND';

// El inbox manda la conversación ya armada (activeConv.msgs) como texto o array.
function normalizarTranscript(input) {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input)) {
    return input
      .map(m => {
        const txt = String(m.content || m.mensaje || '').trim();
        if (!txt) return '';
        const dir = String(m.role || m.direccion || '').toUpperCase();
        const quien = (dir === 'ASSISTANT' || dir === 'SALIENTE') ? 'VENDEDOR' : 'CLIENTE';
        return `${quien}: ${txt}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

const TOOL = {
  name: 'registrar_pedido',
  description: 'Extrae los datos del pedido de la conversación de WhatsApp para registrarlo.',
  input_schema: {
    type: 'object',
    properties: {
      nombre:           { type: 'string', description: 'Nombre completo del cliente. "" si no aparece.' },
      cedula:           { type: 'string', description: 'Cédula/DNI (10 dígitos). "" si no aparece. NO inventar.' },
      telefono:         { type: 'string', description: 'Celular del cliente. "" si no aparece.' },
      correo:           { type: 'string', description: 'Email. "" si no aparece.' },
      ciudad:           { type: 'string', description: 'Ciudad de entrega. "" si no aparece.' },
      calle_principal:  { type: 'string', description: 'Calle principal de la dirección. "" si no aparece.' },
      calle_secundaria: { type: 'string', description: 'Calle secundaria. "" si no aparece.' },
      referencia:       { type: 'string', description: 'Referencia de ubicación. "" si no aparece.' },
      producto:         { type: 'string', description: 'Nombre del producto pedido (ej: Hoodie Premium). "" si no aparece.' },
      tipo_producto:    { type: 'string', description: 'Tipo/detalle del producto (oversize, crewneck, jogger…). "" si no aparece.' },
      color:            { type: 'string', description: 'Color. "" si no aparece.' },
      talla:            { type: 'string', description: 'Talla (S, M, L, XL…). "" si no aparece.' },
      cantidad:         { type: 'string', description: 'Cantidad (solo número). "" si no aparece.' },
      precio:           { type: 'string', description: 'Precio UNITARIO por prenda en USD (solo número, ej "50.00"). "" si no aparece. NO inventar.' },
      mensaje_solicitar_datos: { type: 'string', description: 'Si faltan datos obligatorios, un mensaje corto, natural y premium (tono IND Store, cercano y claro, sin exceso de emojis) para pedirle al cliente SOLO lo que falta. "" si no falta nada.' },
    },
    required: ['nombre','cedula','telefono','ciudad','calle_principal','producto','cantidad','precio','mensaje_solicitar_datos'],
  },
};

// Campos obligatorios para poder crear el pedido → [clave, etiqueta amigable]
const OBLIGATORIOS = [
  ['nombre','nombre del cliente'],
  ['cedula','cédula'],
  ['telefono','celular'],
  ['ciudad','ciudad'],
  ['calle_principal','dirección'],
  ['producto','producto'],
  ['cantidad','cantidad'],
  ['precio','precio'],
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { transcript, conversation } = req.body || {};
    const texto = normalizarTranscript(transcript || conversation);
    if (!texto) return res.status(200).json({ ok: false, error: 'Sin conversación para analizar' });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'registrar_pedido' },
      messages: [{
        role: 'user',
        content: `Extrae los datos del pedido de esta conversación de WhatsApp de IND Store (venta de ropa streetwear premium — hoodies, crewnecks, camisetas oversize, joggers, chaquetas — con envío en Ecuador). Usa "" en los campos que NO puedas determinar con certeza — NUNCA inventes cédula, dirección ni precio. El precio es UNITARIO por prenda.\n\n=== CONVERSACIÓN ===\n${texto}`,
      }],
    });

    const toolUse = response.content.find(c => c.type === 'tool_use');
    const d = toolUse?.input || {};

    const faltan = OBLIGATORIOS.filter(([k]) => !String(d[k] || '').trim()).map(([, label]) => label);

    if (faltan.length) {
      return res.status(200).json({
        ok: false,
        faltan,
        sugerencia: String(d.mensaje_solicitar_datos || '').trim()
          || `¡Hola! Para dejar listo tu pedido me faltaría confirmar: ${faltan.join(', ')}. ¿Me los pasas?`,
        datos: d,
      });
    }

    if (!CRM_URL) {
      return res.status(200).json({ ok: false, error: 'CRM de IND no configurado (define IND_CRM_URL)', datos: d });
    }

    // Payload de VENTA CERRADA para el CRM de IND.
    const direccion = `Calle principal: ${d.calle_principal} Calle secundaria: ${d.calle_secundaria || ''} Referencia: ${d.referencia || ''}`.trim();
    const payload = {
      tiendaId: TIENDA_ID,
      vendedorId: 'IND-WA',
      vendedorNombre: 'Indi WhatsApp',
      vendedorCodigo: 'IWA',
      cliente: {
        nombre: d.nombre, cedula: d.cedula, celular: d.telefono,
        email: d.correo || '', ciudad: d.ciudad, direccion,
      },
      items: [{
        productoNombre: d.producto, detalle: d.tipo_producto || '',
        esPersonalizado: false, color: d.color || '', talla: d.talla || '',
        cantidad: d.cantidad, precioUnit: d.precio, area: '', fotoPecho: '',
      }],
      pagos: [],
      emitirFactura: false,
      notasVendedor: 'Pedido creado desde IND-Inbox (botón CREAR PEDIDO)',
      direccionTexto: direccion,
    };

    // La API del CRM dejó de estar abierta: ahora exige sesión de persona o
    // token de máquina. Este es el token de máquina (mismo valor que CRM_API_TOKEN
    // en el proyecto del CRM). Sin él, el CRM responde 401 y no se crea el pedido.
    const crmRes = await fetch(CRM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CRM_API_TOKEN || ''}`,
      },
      body: JSON.stringify(payload),
    });
    const crm = await crmRes.json().catch(() => ({}));
    if (!crmRes.ok || !crm.pedidoId) {
      return res.status(200).json({ ok: false, error: 'El CRM no pudo crear el pedido: ' + (crm.error || crmRes.status), datos: d });
    }

    return res.status(200).json({
      ok: true,
      pedidoId: crm.pedidoId,
      montoTotal: crm.montoTotal,
      diasCalculado: crm.diasCalculado,
      url: CRM_BASE ? `${CRM_BASE}/dashboard/pedido/${crm.pedidoId}` : '',
      datos: d,
    });
  } catch (err) {
    console.error('crear-pedido error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
