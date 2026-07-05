// api/agent.js — INDx Agent v1.0
// Indi — agente de ventas exclusivo de IND Store
// Fork de mandi-agent adaptado 100% para IND Store

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '../lib/systemPrompt.js';
import { getSession, saveSession } from '../lib/sessions.js';
import { logDecision, initSheet } from '../lib/logger.js';
import { isConfigured, buscarProductosDirecto } from '../lib/shopifyClient.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Inicializar headers de la hoja al arrancar
initSheet().catch(() => {});

// ── GUÍAS DE TALLAS IND ───────────────────────────────────────────
const GUIAS_TALLAS = {
  hoodie:   'https://indlovers.com/pages/guia-tallas',
  chaqueta: 'https://indlovers.com/pages/guia-tallas',
  camiseta: 'https://indlovers.com/pages/guia-tallas',
  general:  'https://indlovers.com/pages/guia-tallas',
};

// ── TOOLS DE INDI ─────────────────────────────────────────────────
const INDI_TOOLS = [
  {
    name: 'buscar_productos',
    description: `Busca productos en el catálogo de IND Store en tiempo real.
Úsala cuando el cliente mencione una colección, personaje, tipo de prenda o quiera ver opciones.
Devuelve hasta 5 productos con nombre, precio, tallas disponibles, imagen y URL.
CUÁNDO USAR: "tienen de spider-man?", "qué hoodies tienen?", "busco algo de ecuador edition", "quiero una chaqueta"
CUÁNDO NO USAR: saludos, preguntas sobre envíos/pagos, cuando ya tienes el producto en contexto`,
    input_schema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'Término de búsqueda: nombre de colección, personaje o tipo de prenda. Ejemplos: "spider-verse", "ecuador edition", "hoodie", "conjunto jogger"'
        }
      },
      required: ['keyword']
    }
  },
  {
    name: 'obtener_guia_tallas',
    description: `Devuelve el link de la guía de tallas de IND Store.
Usar cuando el cliente pregunta por medidas, tallas o cómo saber su talla.`,
    input_schema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['hoodie', 'chaqueta', 'camiseta', 'general'],
          description: 'Tipo de prenda'
        }
      },
      required: ['tipo']
    }
  }
];

// ── EJECUTAR TOOL ─────────────────────────────────────────────────
async function executeTool(toolName, toolInput) {
  if (toolName === 'buscar_productos') {
    const { keyword } = toolInput;

    if (isConfigured()) {
      try {
        const { productos, count } = await buscarProductosDirecto(keyword);
        if (productos) {
          console.log(`INDx Shopify directo OK — ${count} productos para "${keyword}"`);
          return { productos, keyword, fuente: 'shopify_directo' };
        }
        return { error: 'Sin productos para: ' + keyword, fuente: 'shopify_directo' };
      } catch (err) {
        console.error('INDx Shopify directo falló:', err.message);
        return { error: 'Error consultando catálogo IND: ' + err.message };
      }
    }

    return { error: 'Shopify IND no configurado — contactar soporte' };
  }

  if (toolName === 'obtener_guia_tallas') {
    const { tipo } = toolInput;
    const url = GUIAS_TALLAS[tipo] || GUIAS_TALLAS.general;
    return { guia_tallas: url, tipo };
  }

  return { error: 'Tool desconocida: ' + toolName };
}

// ── AUTH ──────────────────────────────────────────────────────────
function isAuthorized(req) {
  const key = req.headers['x-mandi-key'] || req.headers['authorization']?.replace('Bearer ', '');
  return key === process.env.MANDI_API_KEY;
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-mandi-key, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorized(req))      return res.status(401).json({ error: 'Unauthorized' });

  const { phone, message, name, image_url, media_url, source, reset_session, shopify_context } = req.body || {};

  if (!phone || (!message && !image_url && !media_url)) {
    return res.status(400).json({ error: 'Faltan campos: phone y message (o image_url)' });
  }

  const startTime = Date.now();
  let toolUsada = '', keywordShopify = '', productosEncontrados = 0, clasificacion = '', fuenteProductos = '';

  try {
    const session = reset_session ? { messages: [], meta: {} } : getSession(phone);
    const history = session.messages;

    // Contenido del usuario
    const imageUrl = image_url || media_url;
    let userContent;
    if (imageUrl) {
      userContent = [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        { type: 'text', text: message || 'El cliente envió esta imagen' }
      ];
    } else {
      userContent = message;
    }

    // System prompt — siempre IND Store
    let systemPrompt = buildSystemPrompt();
    if (name) systemPrompt += `\n\nNombre del cliente: ${name}`;
    if (shopify_context?.trim()) {
      systemPrompt += `\n\n## 🛒 PRODUCTOS DISPONIBLES EN IND STORE (datos reales de Shopify):\n${shopify_context}\n\n⚠️ IMPORTANTE: Estos productos YA FUERON encontrados en Shopify. ÚSALOS DIRECTAMENTE sin llamar la tool buscar_productos. Si el cliente pregunta por uno de estos, confirma precio, tallas y cierra la venta YA.`;
    }

    const apiMessages = [...history, { role: 'user', content: userContent }];

    // ── PRIMERA LLAMADA A CLAUDE ──────────────────────────────────
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
      tools: INDI_TOOLS,
      messages: apiMessages
    });

    let totalInputTokens  = response.usage?.input_tokens  || 0;
    let totalOutputTokens = response.usage?.output_tokens || 0;

    const intermediateMessages = [];

    // ── AGENTIC LOOP ──────────────────────────────────────────────
    while (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(b => b.type === 'tool_use');
      if (!toolUseBlock) break;

      toolUsada      = toolUseBlock.name;
      keywordShopify = toolUseBlock.input?.keyword || '';
      clasificacion  = 'PRODUCTO';

      console.log(`INDx tool: ${toolUsada} → "${keywordShopify}"`);

      const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);
      if (toolResult.productos) {
        productosEncontrados = toolResult.productos.split(' ||| ').length;
      }
      if (toolResult.fuente) fuenteProductos = toolResult.fuente;

      const assistantToolMsg  = { role: 'assistant', content: response.content };
      const toolResultMessage = {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(toolResult) }]
      };

      intermediateMessages.push(assistantToolMsg, toolResultMessage);

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: systemPrompt,
        tools: INDI_TOOLS,
        messages: [...apiMessages, ...intermediateMessages]
      });

      totalInputTokens  += response.usage?.input_tokens  || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;
    }

    // ── RESPUESTA FINAL ───────────────────────────────────────────
    const replyBlock = response.content.find(b => b.type === 'text');
    const reply      = replyBlock?.text || '';

    if (!toolUsada) clasificacion = 'OTRO';

    // Guardar historial limpio
    const userMsg          = { role: 'user', content: typeof userContent === 'string' ? userContent : (message || '[imagen]') };
    const assistantFinalMsg= { role: 'assistant', content: reply };
    const newHistory       = [...history, userMsg];

    if (intermediateMessages.length > 0) {
      const toolResultMsg = intermediateMessages.find(m =>
        m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
      );
      if (toolResultMsg) {
        const toolContent = toolResultMsg.content[0]?.content || '';
        newHistory.push(
          { role: 'assistant', content: `[CATÁLOGO IND CONSULTADO: ${toolContent}]` },
          { role: 'user',      content: 'ok, basándote en ese catálogo responde mi pregunta anterior' }
        );
      }
    }

    newHistory.push(assistantFinalMsg);
    saveSession(phone, newHistory, { name, source, lastReply: reply.slice(0, 100) });

    const elapsed = Date.now() - startTime;

    // Log fire and forget
    logDecision({
      phone, mensaje: message || '[imagen]', clasificacion,
      tool_usada: toolUsada, keyword_shopify: keywordShopify,
      productos_encontrados: productosEncontrados, fuente_productos: fuenteProductos,
      respuesta: reply, tokens_in: totalInputTokens, tokens_out: totalOutputTokens, elapsed_ms: elapsed
    });

    return res.status(200).json({
      reply, reply_clean: reply,
      content: [{ type: 'text', text: reply }],
      phone, tienda: 'INDSTORE', source: source || 'unknown',
      tool_used: toolUsada, keyword: keywordShopify,
      productos_encontrados: productosEncontrados, fuente_productos: fuenteProductos,
      context_turns: Math.floor(newHistory.length / 2),
      tokens: { input: totalInputTokens, output: totalOutputTokens },
      elapsed_ms: elapsed
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('INDx error:', error);
    logDecision({ phone, mensaje: message || '', clasificacion: 'ERROR', error: error.message, elapsed_ms: elapsed });
    return res.status(500).json({ error: 'Error interno del agente', detail: error.message });
  }
}
