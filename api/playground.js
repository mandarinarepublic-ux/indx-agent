// api/playground.js — Chat de pruebas para Indi (indx-agent): página + proxy.
//
//   GET  /api/playground  → sirve la UI de chat (HTML self-contained).
//   POST /api/playground  → { password, phone, message, history } → valida la clave
//     contra PLAYGROUND_PASSWORD y reenvía a /api/agent con la MANDI_API_KEY del
//     SERVIDOR. La key nunca llega al navegador.
//
// Seguridad: si PLAYGROUND_PASSWORD no está seteada, el playground está DESACTIVADO
// (fail-closed). Así el repo público no expone nada por defecto.

const PASSWORD  = process.env.PLAYGROUND_PASSWORD || '';
const AGENT_KEY = process.env.MANDI_API_KEY || '';

const RE_IMG = /https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/gi;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(PAGE);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!PASSWORD)  return res.status(403).json({ error: 'Playground desactivado: define PLAYGROUND_PASSWORD en Vercel.' });
  if (!AGENT_KEY) return res.status(500).json({ error: 'Falta MANDI_API_KEY en el servidor.' });

  const { password, phone, message, history, validate } = req.body || {};
  if (password !== PASSWORD) return res.status(401).json({ error: 'Clave incorrecta' });
  if (validate)             return res.status(200).json({ ok: true });
  if (!message || !message.trim()) return res.status(400).json({ error: 'Escribe un mensaje' });

  try {
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
    const agentUrl = `${proto}://${host}/api/agent`;

    const r = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mandi-key': AGENT_KEY },
      body: JSON.stringify({
        phone: (phone && phone.trim()) || '593999000111',
        message,
        history: Array.isArray(history) ? history : [],
        source: 'playground',
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data?.error || `HTTP ${r.status}`, detail: data?.detail || '' });

    // Separamos las URLs de imagen del texto (como hace el inbox al enviar).
    const raw = data.reply_clean || data.reply || '';
    const imagenes = [...new Set(raw.match(RE_IMG) || [])];
    let texto = raw;
    for (const u of imagenes) texto = texto.split(u).join('');
    texto = texto.replace(/\n{3,}/g, '\n\n').trim();

    return res.status(200).json({
      reply: texto,
      imagenes,
      tool_used: data.tool_used || '',
      keyword: data.keyword || '',
      productos_encontrados: data.productos_encontrados || 0,
      fuente_productos: data.fuente_productos || '',
      elapsed_ms: data.elapsed_ms || 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── UI (self-contained; sin dependencias, sin llamadas externas) ──────────────
const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Indi · Playground IND</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:#0d0d0f; color:#f2f2f2; display:flex; flex-direction:column; height:100dvh; }
  header { padding:13px 16px; border-bottom:1px solid #1f1f24; display:flex; align-items:center; gap:10px; }
  header b { font-size:16px; } header small { font-size:12px; color:#8a8a94; }
  #gate { margin:auto; padding:24px; max-width:340px; width:100%; display:flex; flex-direction:column; gap:11px; }
  #gate h1 { font-size:19px; margin:0; } #gate p { color:#8a8a94; font-size:13px; margin:0 0 6px; }
  input { width:100%; padding:11px 12px; border-radius:10px; border:1px solid #2a2a31;
          background:#151519; color:#f2f2f2; font-size:15px; }
  input:focus { outline:none; border-color:#e0602a; }
  button { background:#e0602a; color:#fff; border:0; border-radius:10px; padding:11px 16px;
           font-size:15px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  #log { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:9px; }
  .msg { max-width:82%; padding:10px 13px; border-radius:15px; font-size:15px; line-height:1.4;
         white-space:pre-wrap; word-break:break-word; }
  .me  { align-self:flex-end; background:#e0602a; color:#fff; border-bottom-right-radius:4px; }
  .bot { align-self:flex-start; background:#1a1a20; border-bottom-left-radius:4px; }
  .bot img { max-width:100%; border-radius:10px; margin-top:6px; display:block; }
  .meta { align-self:flex-start; font-size:11px; color:#6a6a74; }
  footer { padding:10px 12px; border-top:1px solid #1f1f24; display:flex; gap:8px; }
  footer input { flex:1; }
  .hidden { display:none !important; }
  #err { color:#e0602a; font-size:13px; min-height:16px; }
</style>
</head>
<body>
  <div id="gate">
    <h1>🧡 Indi · Playground</h1>
    <p>Chat de pruebas del agente IND. Ingresa la clave para empezar.</p>
    <input id="pass" type="password" placeholder="Clave del playground" autocomplete="off">
    <input id="phone" type="text" placeholder="Teléfono de prueba (opcional)" value="593999000111" autocomplete="off">
    <button id="enter">Entrar</button>
    <div id="err"></div>
  </div>

  <header class="hidden" id="hdr">
    <b>🧡 Indi</b><small>IND Store · playground</small>
    <button id="reset" style="margin-left:auto; background:#1a1a20; padding:7px 12px; font-size:13px;">Reiniciar</button>
  </header>
  <div id="log" class="hidden"></div>
  <footer class="hidden" id="foot">
    <input id="box" type="text" placeholder="Escribe como cliente..." autocomplete="off">
    <button id="send">Enviar</button>
  </footer>

<script>
  var pass='', phone='', history=[], sending=false;
  function $(id){ return document.getElementById(id); }

  function add(cls, text){
    var d=document.createElement('div'); d.className='msg '+cls; d.textContent=text;
    $('log').appendChild(d); $('log').scrollTop=$('log').scrollHeight; return d;
  }
  function meta(text){
    var d=document.createElement('div'); d.className='meta'; d.textContent=text;
    $('log').appendChild(d); $('log').scrollTop=$('log').scrollHeight; return d;
  }

  function show(){
    $('gate').classList.add('hidden');
    ['hdr','log','foot'].forEach(function(i){ $(i).classList.remove('hidden'); });
    $('box').focus();
  }

  async function send(){
    var box=$('box'); var msg=box.value.trim(); if(!msg||sending) return;
    box.value=''; add('me', msg);
    var prev=history.slice();
    history.push({role:'user', content:msg});
    sending=true; $('send').disabled=true;
    var waiting=meta('Indi está escribiendo…');
    try{
      var r=await fetch('/api/playground',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ password:pass, phone:phone, message:msg, history:prev }) });
      var data=await r.json(); waiting.remove();
      if(!r.ok){ meta('⚠️ '+(data.error||r.status)); history.pop(); }
      else{
        var d=add('bot', data.reply||'(imagen)');
        (data.imagenes||[]).forEach(function(u){ var im=document.createElement('img'); im.src=u; d.appendChild(im); });
        history.push({role:'assistant', content:data.reply||''});
        var parts=[];
        if(data.tool_used) parts.push('tool='+data.tool_used);
        if(data.keyword) parts.push('kw="'+data.keyword+'"');
        if(data.productos_encontrados) parts.push('prods='+data.productos_encontrados);
        if(data.fuente_productos) parts.push(data.fuente_productos);
        if(data.elapsed_ms) parts.push(data.elapsed_ms+'ms');
        if(parts.length) meta(parts.join('  ·  '));
      }
    }catch(e){ waiting.remove(); meta('⚠️ '+e.message); history.pop(); }
    sending=false; $('send').disabled=false; box.focus();
  }

  $('enter').onclick=async function(){
    pass=$('pass').value.trim(); phone=$('phone').value.trim();
    if(!pass){ $('err').textContent='Ingresa la clave'; return; }
    $('enter').disabled=true; $('err').textContent='Validando…';
    try{
      var r=await fetch('/api/playground',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ password:pass, validate:true }) });
      var data=await r.json();
      if(r.ok){ show(); }
      else{ $('err').textContent=data.error||('Error '+r.status); $('enter').disabled=false; }
    }catch(e){ $('err').textContent=e.message; $('enter').disabled=false; }
  };

  $('send').onclick=send;
  $('box').onkeydown=function(e){ if(e.key==='Enter'){ e.preventDefault(); send(); } };
  $('pass').onkeydown=function(e){ if(e.key==='Enter'){ $('enter').click(); } };
  $('reset').onclick=function(){ history=[]; $('log').innerHTML=''; $('box').focus(); };
</script>
</body>
</html>`;
