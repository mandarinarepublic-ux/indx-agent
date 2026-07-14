// test-indi.js — chat interactivo con Indi (indx-agent) para vetting pre-producción.
//
// Uso:   node test-indi.js
// Env:   MANDI_KEY   (obligatorio) = la MANDI_API_KEY del bot
//        AGENT_URL   (opcional)    = endpoint /api/agent (default: vercel dev local)
//        TEST_PHONE  (opcional)    = número de prueba
//
// PowerShell:  $env:MANDI_KEY="..."; $env:AGENT_URL="https://<preview>.vercel.app/api/agent"; node test-indi.js
//
// ⚠️ Llama /api/agent DIRECTO. Con el diseño nuevo la memoria vive en el inbox, así que
// estas llamadas son de UN turno (no encadenan contexto entre sí — por eso mandamos
// reset_session:true). Ideal para vetear CALIDAD de respuestas. La memoria multi-turno
// se prueba con el loop completo (webhook → agent → /api/saliente).

import readline from 'node:readline';

const AGENT_URL  = process.env.AGENT_URL  || 'http://localhost:3000/api/agent';
const MANDI_KEY  = process.env.MANDI_KEY  || '';
const TEST_PHONE = process.env.TEST_PHONE || '593999000111';

if (!MANDI_KEY) {
  console.error('Falta MANDI_KEY (la MANDI_API_KEY del bot). Ej (PowerShell):');
  console.error('  $env:MANDI_KEY="..."; node test-indi.js');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

console.log(`\n🧡 Chateando con Indi vía ${AGENT_URL}`);
console.log(`   phone de prueba: ${TEST_PHONE}  ·  escribe "salir" para terminar\n`);

while (true) {
  const message = await ask('Tú:  ');
  const txt = message.trim();
  if (!txt || /^(salir|exit|quit)$/i.test(txt)) break;

  const t0 = Date.now();
  try {
    const res = await fetch(AGENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mandi-key': MANDI_KEY },
      body: JSON.stringify({ phone: TEST_PHONE, message, source: 'test-cli', reset_session: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`⚠️  ${res.status}: ${data?.error || ''} ${data?.detail || ''}\n`);
      continue;
    }
    console.log(`Indi: ${data.reply_clean || data.reply || '(sin texto)'}`);
    const meta = [];
    if (data.tool_used)             meta.push(`tool=${data.tool_used}`);
    if (data.keyword)               meta.push(`kw="${data.keyword}"`);
    if (data.productos_encontrados) meta.push(`prods=${data.productos_encontrados}`);
    if (data.fuente_productos)      meta.push(`fuente=${data.fuente_productos}`);
    meta.push(`${Date.now() - t0}ms`);
    console.log(`      [${meta.join('  ·  ')}]\n`);
  } catch (err) {
    console.log(`⚠️  fallo de red: ${err.message}\n`);
  }
}

rl.close();
console.log('\nListo. 🧡');
