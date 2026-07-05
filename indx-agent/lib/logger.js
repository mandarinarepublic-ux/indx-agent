// lib/logger.js — INDx Agent
// Logs de decisiones de Indi a Google Sheets (hoja separada de Mandarina)
// Crea una hoja nueva: INDX_LOGS en el mismo spreadsheet o uno nuevo

const SHEET_ID   = process.env.INDX_LOGS_SHEET_ID || '1CliAfiPTkPhSDvM70PUdHAs9y4JnggYwo6rUOQv9fiI';
const SHEET_NAME = 'INDX_LOGS';

export async function logDecision({
  phone = '',
  mensaje = '',
  clasificacion = '',
  tool_usada = '',
  keyword_shopify = '',
  productos_encontrados = 0,
  respuesta = '',
  tokens_in = 0,
  tokens_out = 0,
  elapsed_ms = 0,
  error = ''
}) {
  try {
    const token = await getGoogleToken();
    if (!token) return;

    const fecha = new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' });
    const row   = [
      fecha, phone, mensaje.slice(0, 200), clasificacion,
      tool_usada, keyword_shopify, productos_encontrados,
      respuesta.slice(0, 500), tokens_in, tokens_out, elapsed_ms,
      error.slice(0, 200)
    ];

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] })
      }
    );
  } catch (err) {
    console.error('INDx Logger error (no bloqueante):', err.message);
  }
}

export async function initSheet() {
  try {
    const token = await getGoogleToken();
    if (!token) return;

    const headers = [
      'FECHA', 'PHONE', 'MENSAJE', 'CLASIFICACION',
      'TOOL_USADA', 'KEYWORD_SHOPIFY', 'PRODUCTOS_ENCONTRADOS',
      'RESPUESTA', 'TOKENS_IN', 'TOKENS_OUT', 'MS', 'ERROR'
    ];

    const checkRes  = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const checkData = await checkRes.json();

    if (!checkData.values?.length) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A1:L1?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [headers] })
        }
      );
    }
  } catch (err) {
    console.error('INDx initSheet error:', err.message);
  }
}

async function getGoogleToken() {
  const creds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!creds) { console.error('INDx Logger: GOOGLE_SERVICE_ACCOUNT_JSON no configurado'); return null; }

  try {
    const sa  = JSON.parse(creds);
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now, exp: now + 3600
    };

    const header   = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body     = b64url(JSON.stringify(payload));
    const unsigned = `${header}.${body}`;
    const signature= await signRS256(unsigned, sa.private_key);
    const jwt      = `${unsigned}.${signature}`;

    const res  = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const data = await res.json();
    return data.access_token || null;
  } catch (err) {
    console.error('INDx getGoogleToken error:', err.message);
    return null;
  }
}

function b64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function signRS256(data, pemKey) {
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  return b64url(sign.sign(pemKey));
}
