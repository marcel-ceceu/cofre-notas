// GPTEXPORT 1.0.1-tauri — script de inicializacao da janela "chatgpt" do Cofre de Notas.
// Mesma logica do userscript gptexport 1.0.1; roda antes do DOM existir, por isso as guardas abaixo.
(() => {
  'use strict';
  if (window.top !== window) return;                 // so no frame principal
  if (location.hostname !== 'chatgpt.com') return;   // nao montar painel em auth.openai.com etc.
  if (window.__GPTEXPORT__) return;

  const VERSAO = '1.0.1-tauri';
  const CFG = { pausaMin: 1500, pausaMax: 4000, tentativas: 5, pagGeral: 100, pagProjeto: 50, maxPaginas: 50, amostra: 3 };
  const DIA = 864e5;
  const st = { token: null, cancelar: false, rodando: false };

  // ---------- utilidades ----------
  const esp = ms => new Promise(r => setTimeout(r, ms));
  const pausa = () => esp(CFG.pausaMin + Math.random() * (CFG.pausaMax - CFG.pausaMin));
  const toMs = v => (v == null ? 0 : typeof v === 'number' ? v * 1000 : Date.parse(v));
  const iso = v => { const t = toMs(v); return t ? new Date(t).toISOString() : ''; };
  const conta = (o, k) => (o[k] = (o[k] || 0) + 1);
  const linha = (bloco, detalhe, veredicto) => ({ bloco, detalhe, veredicto });
  const slug = s => (s || 'sem-titulo').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'sem-titulo';
  const cookie = k => (document.cookie.match(`(^|;)\\s*${k}\\s*=\\s*([^;]+)`) || []).pop() || '';
  const DEVICE_ID = cookie('oai-did') || crypto.randomUUID();

  // ---------- API (sessão logada) ----------
  async function token(forcar = false) {
    if (st.token && !forcar) return st.token;
    const s = await fetch('/api/auth/session').then(r => r.json()).catch(() => null);
    if (!s?.accessToken) throw new Error('token ausente (faça login no chatgpt.com)');
    return (st.token = s.accessToken);
  }

  async function api(path) {
    for (let t = 1; t <= CFG.tentativas; t++) {
      if (st.cancelar) throw new Error('cancelado');
      const tk = await token();
      const r = await fetch(path, { headers: { Authorization: `Bearer ${tk}`, 'X-Authorization': `Bearer ${tk}`, 'Oai-Device-Id': DEVICE_ID, 'Oai-Language': 'pt-BR' } });
      if (r.ok) return r.json();
      if (r.status === 401 && t === 1) { await token(true); continue; }
      if (r.status === 429 || r.status >= 500) {
        const ra = Number(r.headers.get('retry-after'));
        const ms = r.status === 429
          ? (ra > 0 ? ra * 1000 : Math.min(120000, 30000 * t))
          : Math.min(60000, 2000 * 2 ** t);
        log(`HTTP ${r.status} — aguardando ${Math.round(ms / 1000)}s (tentativa ${t}/${CFG.tentativas})`);
        await esp(ms);
        continue;
      }
      throw new Error(`HTTP ${r.status} em ${path}`);
    }
    throw new Error(`esgotou tentativas: ${path}`);
  }

  // ---------- listagem (geral e Projetos são conjuntos separados) ----------
  async function listarGeral(corte) {
    const out = [];
    let off = 0;
    for (let p = 0; p < CFG.maxPaginas; p++) {
      const j = await api(`/backend-api/conversations?offset=${off}&limit=${CFG.pagGeral}&order=updated`);
      const pg = j.items || [];
      off += pg.length;
      for (const c of pg) if (toMs(c.update_time) >= corte) out.push({ id: c.id, title: c.title, update_time: c.update_time, projeto: '' });
      if (!pg.length || toMs(pg.at(-1).update_time) < corte || off >= (j.total ?? Infinity)) break;
      await esp(800);
    }
    return out;
  }

  async function listarProjetos(corte) {
    const projetos = [], out = [];
    let cur = null;
    for (let p = 0; p < CFG.maxPaginas; p++) {
      const q = `conversations_per_gizmo=0${cur != null ? `&cursor=${encodeURIComponent(cur)}` : ''}`;
      const sb = await api(`/backend-api/gizmos/snorlax/sidebar?${q}`);
      for (const x of sb.items || []) {
        const g = x?.gizmo?.gizmo ?? x?.gizmo ?? x;
        if (g?.id) projetos.push({ id: g.id, nome: g.display?.name || g.id });
      }
      cur = sb.cursor;
      if (cur == null) break;
    }
    for (const pj of projetos) {
      let c = 0;
      for (let p = 0; p < CFG.maxPaginas && c != null; p++) {
        const j = await api(`/backend-api/gizmos/${pj.id}/conversations?cursor=${encodeURIComponent(c)}&limit=${CFG.pagProjeto}`);
        for (const it of j.items || []) {
          if (toMs(it.update_time) >= corte) out.push({ id: it.id, title: it.title, update_time: it.update_time, projeto: pj.nome });
        }
        c = j.cursor;
        await esp(800);
      }
    }
    return { projetos, conversas: out };
  }

  // ---------- citações (novas: content_references | antigas: 【…】) ----------
  const MARCADOR_CIT = /cite(?:[^]*)+/gu;
  const RESIDUO_PUA = /[-]/gu;
  const normCit = s => s.replace(/[   ⁠]/gu, ' ').replace(/[]/gu, '');
  const escMd = s => String(s).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\n/g, ' ');
  const escUrl = s => String(s).replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\n/g, '');
  const fonteMd = f => {
    const rot = (f.attribution || f.title || f.url || 'Fonte').trim();
    const u = f.url?.trim();
    return u ? `[${escMd(rot)}](<${escUrl(u)}>)` : escMd(rot);
  };
  const dedupe = fs => { const v = new Set(); return fs.filter(f => { const k = f?.url?.trim() || f?.title?.trim(); if (!k || v.has(k)) return false; v.add(k); return true; }); };

  function fontesInline(ref) {
    const fs = [];
    for (const it of ref.items || []) fs.push(it, ...(it.supporting_websites || []));
    fs.push(...(ref.fallback_items || []));
    if (!fs.length && ref.type === 'file' && ref.name) fs.push({ title: ref.name });
    if (!fs.length && (ref.url || ref.title || ref.attribution)) fs.push(ref);
    return dedupe(fs);
  }

  function citacoes(txt, meta, est) {
    const refs = meta?.content_references || [];
    let out = normCit(txt);
    const inline = refs.filter(r => r.type !== 'sources_footnote' && r.matched_text)
      .sort((a, b) => b.matched_text.length - a.matched_text.length);
    for (const ref of inline) {
      const alvo = normCit(ref.matched_text);
      if (!alvo || !out.includes(alvo)) continue;
      const fs = fontesInline(ref);
      const rep = fs.length ? `(${fs.map(fonteMd).join(', ')})` : (ref.alt || '').replace(/\[([^\]]*)\]\(\)/g, '$1');
      out = out.split(alvo).join(rep);
      est.cit.trocadas++;
    }
    out = out.replace(MARCADOR_CIT, '').replace(/\s*【[^】]*】/g, '');
    const rodape = dedupe(refs.filter(r => r.type === 'sources_footnote').flatMap(r =>
      r.sources?.length ? r.sources : r.items?.length ? r.items : r.fallback_items || []));
    if (rodape.length) {
      out = `${out.trimEnd()}\n\n**Fontes:**\n\n${rodape.map(f => `- ${fonteMd(f)}`).join('\n')}`;
      est.cit.fontes += rodape.length;
    }
    return out;
  }

  // ---------- conversão para Markdown ----------
  function motivoPular(msg, role, ct, md) {
    if (role === 'system') return 'system';
    if (ct === 'user_editable_context' || ct === 'model_editable_context') return ct;
    if (md.is_visually_hidden_from_conversation) return 'oculta';
    if (md.is_thinking_preamble_message) return 'preambulo-raciocinio';
    if (msg.recipient && msg.recipient !== 'all') return 'chamada-ferramenta';
    if (ct === 'thoughts' || ct === 'reasoning_recap') return ct;
    if (role === 'tool') return 'tool';
    if (role !== 'user' && role !== 'assistant') return `role:${role}`;
    return '';
  }

  function conteudo(c, est) {
    const parte = x => {
      if (typeof x === 'string') return x;
      switch (x?.content_type) {
        case 'image_asset_pointer': est.imagens++; return '[imagem]';
        case 'audio_transcription': return `[áudio] ${x.text || ''}`;
        case 'audio_asset_pointer':
        case 'real_time_user_audio_video_asset_pointer': return '';
        default:
          if (typeof x?.text === 'string') return x.text;
          conta(est.tipos, `parte:${x?.content_type}`);
          return `[parte ${x?.content_type} não suportada]`;
      }
    };
    const partes = p => (p || []).map(parte).filter(s => s !== '').join('\n');
    switch (c.content_type) {
      case 'text':
      case 'multimodal_text': return partes(c.parts);
      case 'code': return '```' + (c.language && c.language !== 'unknown' ? c.language : '') + '\n' + (c.text || '') + '\n```';
      case 'execution_output': return '```\n' + (c.text || '') + '\n```';
      case 'tether_quote': return `> ${c.title || c.text || ''}`;
      default:
        conta(est.tipos, c.content_type || 'sem-tipo');
        return c.text || partes(c.parts) || `[conteúdo ${c.content_type} não suportado]`;
    }
  }

  function paraMd(conv, meta, est) {
    const m = conv.mapping || {};
    const caminho = [];
    for (let id = conv.current_node, g = 0; id && m[id] && g < 100000; id = m[id].parent, g++) caminho.push(m[id]);
    caminho.reverse();
    est.nos += Object.keys(m).length;
    est.visiveis += caminho.length;
    const itens = [];
    let modelo = '';
    for (const n of caminho) {
      const msg = n.message;
      if (!msg?.content) continue;
      const role = msg.author?.role, ct = msg.content.content_type, md = msg.metadata || {};
      const motivo = motivoPular(msg, role, ct, md);
      if (motivo) { conta(est.pulados, motivo); continue; }
      if (role === 'assistant' && md.model_slug) modelo = md.model_slug;
      const txt = conteudo(msg.content, est);
      const refs = md.content_references || [];
      const anexos = (md.attachments || []).filter(a => a.name && !String(a.mime_type || '').startsWith('image/')).map(a => `- 📎 ${a.name}`);
      est.anexos += anexos.length;
      if (!txt.trim() && !anexos.length) { conta(est.pulados, `vazia:${ct}`); continue; }
      const ant = itens.at(-1);
      if (ant && ant.role === 'assistant' && role === 'assistant' && ant.ct === 'text' && ct === 'text') {
        ant.txt = `${ant.txt.trimEnd()}\n\n${txt.trim()}`;
        ant.refs.push(...refs);
        est.mescladas++;
        continue;
      }
      itens.push({ role, ct, ts: msg.create_time, txt: txt.trim(), refs, anexos });
    }
    // citações depois da mesclagem: o bloco "Fontes" fica no fim da resposta inteira
    for (const i of itens) {
      if (i.role === 'assistant') i.txt = citacoes(i.txt, { content_references: i.refs }, est).trim();
      if (i.anexos.length) i.txt += `\n\n${i.anexos.join('\n')}`;
    }
    est.msgs += itens.length;
    const titulo = conv.title || meta.title || 'Sem título';
    const fm = [
      '---',
      `id: ${meta.id}`,
      `titulo: "${titulo.replace(/"/g, "'")}"`,
      `criado: ${iso(conv.create_time)}`,
      `alterado: ${iso(conv.update_time || meta.update_time)}`,
      `projeto: "${(meta.projeto || '').replace(/"/g, "'")}"`,
      `modelo: ${modelo}`,
      `url: https://chatgpt.com/c/${meta.id}`,
      `exportador: gptexport ${VERSAO}`,
      '---',
      ''
    ].join('\n');
    const corpo = itens.map(i => `### ${i.role === 'user' ? 'Você' : 'ChatGPT'}${i.ts ? ` — ${iso(i.ts)}` : ''}\n\n${i.txt}\n`).join('\n');
    const saida = `${fm}# ${titulo}\n\n${corpo}`;
    est.residuos += (saida.match(RESIDUO_PUA) || []).length;
    return saida;
  }

  // ---------- destino ----------
  async function abrirDestino() {
    if (window.showDirectoryPicker) {
      try { return { tipo: 'pasta', dir: await window.showDirectoryPicker({ mode: 'readwrite' }) }; }
      catch (e) { if (e.name === 'AbortError') throw new Error('seleção de pasta cancelada'); }
    }
    return { tipo: 'download' };
  }

  async function salvar(dest, nome, txt) {
    if (dest.tipo === 'pasta') {
      const fh = await dest.dir.getFileHandle(nome, { create: true });
      const w = await fh.createWritable();
      await w.write(txt);
      await w.close();
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/markdown;charset=utf-8' }));
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- execução (Diagnosticar = dry-run com amostra, nada é salvo) ----------
  const novoEst = () => ({ nos: 0, visiveis: 0, msgs: 0, mescladas: 0, anexos: 0, imagens: 0, residuos: 0, pulados: {}, tipos: {}, cit: { trocadas: 0, fontes: 0 } });

  async function executar(dias, exportar) {
    if (st.rodando) return;
    st.rodando = true; st.cancelar = false; limparLog();
    const t0 = Date.now(), corte = t0 - dias * DIA;
    const res = [], falhas = [], est = novoEst();
    let salvos = 0;
    try {
      const dest = exportar ? await abrirDestino() : null; // 1º await: precisa do gesto do clique
      log(`gptexport ${VERSAO} — ${exportar ? 'EXPORTAR' : 'DIAGNOSTICAR'} ${dias} dias`);
      await token();
      res.push(linha('1 token', 'obtido', 'OK'));
      const geral = await listarGeral(corte);
      res.push(linha('2 listagem geral', `${geral.length} no período`, 'OK'));
      const { projetos, conversas: proj } = await listarProjetos(corte);
      res.push(linha('3 projetos', `${projetos.length} projeto(s) | ${proj.length} conversa(s) no período`, 'OK'));

      const mapa = new Map();
      for (const c of [...geral, ...proj]) {
        if (!mapa.has(c.id)) mapa.set(c.id, c);
        else if (c.projeto) mapa.get(c.id).projeto = c.projeto;
      }
      const lista = [...mapa.values()].sort((a, b) => toMs(b.update_time) - toMs(a.update_time));
      const dup = geral.length + proj.length - lista.length;
      res.push(linha('4 consolidado', `${lista.length} única(s) | duplicadas: ${dup} | exportação estimada ~${Math.ceil(lista.length * 2.9 / 60)} min`, dup ? 'ATENCAO' : 'OK'));

      const alvo = exportar ? lista : lista.slice(0, CFG.amostra);
      log(exportar ? `Exportando ${alvo.length} conversa(s)` : `Convertendo amostra de ${alvo.length} conversa(s) — nada será salvo`);
      for (let i = 0; i < alvo.length; i++) {
        if (st.cancelar) { log('Cancelado pelo usuário.'); break; }
        const c = alvo[i];
        status(`PROCESSANDO ${i + 1}/${alvo.length}`);
        try {
          const conv = await api(`/backend-api/conversation/${c.id}`);
          const md = paraMd(conv, c, est);
          const nome = `${iso(c.update_time).slice(0, 10)}_${slug(c.title)}_${c.id.slice(0, 8)}.md`;
          if (exportar) { await salvar(dest, nome, md); salvos++; }
          else console.log(`[GPTEXPORT] prévia de ${nome}:\n\n${md.slice(0, 1500)}`);
        } catch (e) {
          falhas.push({ id: c.id, titulo: c.title, erro: e.message });
          log(`FALHA ${c.id.slice(0, 8)}: ${e.message}`);
          if (e.message === 'cancelado') break;
        }
        if (i < alvo.length - 1) await pausa();
      }

      const nTipos = Object.keys(est.tipos).length;
      res.push(alvo.length
        ? linha('5 conversão', `nós ${est.nos} | caminho visível ${est.visiveis} | msgs ${est.msgs} | mescladas ${est.mescladas} | anexos ${est.anexos} | imagens ${est.imagens}`, est.msgs ? 'OK' : 'FALHA')
        : linha('5 conversão', 'sem conversas no período', 'ATENCAO'));
      res.push(linha('6 puladas', Object.keys(est.pulados).length ? JSON.stringify(est.pulados) : 'nenhuma', 'OK'));
      res.push(linha('7 tipos não tratados', nTipos ? JSON.stringify(est.tipos) : 'nenhum', nTipos ? 'ATENCAO' : 'OK'));
      res.push(linha('8 citações', `trocadas ${est.cit.trocadas} | fontes ${est.cit.fontes} | marcadores residuais ${est.residuos}`, est.residuos ? 'ATENCAO' : 'OK'));
      res.push(linha('9 falhas', falhas.length ? `${falhas.length} (tabela no console)` : 'nenhuma', falhas.length ? 'FALHA' : 'OK'));
      if (exportar) res.push(linha('10 destino', `${salvos} de ${alvo.length} salvos em ${dest.tipo === 'pasta' ? `pasta "${dest.dir.name}"` : 'downloads do navegador'}`, salvos === alvo.length ? 'OK' : 'ATENCAO'));
      res.push(linha('11 tempo', `${Math.round((Date.now() - t0) / 1000)}s`, 'OK'));
    } catch (e) {
      res.push(linha('ERRO', e.message, 'FALHA'));
    } finally {
      console.table(res);
      if (falhas.length) console.table(falhas);
      res.forEach(r => log(`[${r.veredicto}] ${r.bloco}: ${r.detalhe}`));
      status('');
      st.rodando = false;
    }
  }

  // ---------- painel (só estilo inline: o CSP do chatgpt.com bloqueia CSS externo) ----------
  let $log, $status;
  const el = (tag, props = {}, filhos = []) => { const e = Object.assign(document.createElement(tag), props); filhos.forEach(f => e.appendChild(f)); return e; };
  const log = msg => { console.log(`[GPTEXPORT] ${msg}`); if ($log) { $log.textContent += msg + '\n'; $log.scrollTop = $log.scrollHeight; } };
  const limparLog = () => { if ($log) $log.textContent = ''; };
  const status = t => { if ($status) $status.textContent = t; };

  function montarUI() {
    if (document.getElementById('gptx-btn')) return;
    const bt = 'padding:5px 9px;border-radius:6px;border:1px solid #6b7280;background:#374151;color:#f9fafb;font:12px system-ui;cursor:pointer';
    const sel = el('select', { style: 'padding:4px;border-radius:6px;font:12px system-ui' }, [
      el('option', { value: '7', textContent: 'Últimos 7 dias' }),
      el('option', { value: '30', textContent: 'Últimos 30 dias' })
    ]);
    $status = el('span', { style: 'font:12px system-ui;color:#fbbf24' });
    $log = el('pre', { style: 'margin:8px 0 0;max-height:240px;overflow:auto;white-space:pre-wrap;font:11px/1.4 ui-monospace,Consolas,monospace;background:#111827;color:#d1d5db;padding:6px;border-radius:6px' });
    const painel = el('div', { id: 'gptx-painel', style: 'display:none;position:fixed;right:16px;bottom:124px;z-index:2147483647;width:400px;background:#1f2937;color:#f9fafb;border:1px solid #4b5563;border-radius:10px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);font:12px system-ui' }, [
      el('div', { textContent: `Exportar conversas do ChatGPT — v${VERSAO}`, style: 'font-weight:600;margin-bottom:8px' }),
      el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
        sel,
        el('button', { textContent: 'Diagnosticar', style: bt, onclick: () => executar(+sel.value, false) }),
        el('button', { textContent: 'Exportar', style: bt + ';background:#2563eb;border-color:#2563eb', onclick: () => executar(+sel.value, true) }),
        el('button', { textContent: 'Cancelar', style: bt, onclick: () => { st.cancelar = true; } })
      ]),
      el('div', { style: 'margin-top:6px' }, [$status]),
      $log
    ]);
    const btn = el('button', { id: 'gptx-btn', textContent: '⬇ GPT', title: 'Exportar conversas', style: 'position:fixed;right:16px;bottom:88px;z-index:2147483647;' + bt, onclick: () => { painel.style.display = painel.style.display === 'none' ? 'block' : 'none'; } });
    document.body.append(painel, btn);
  }

  // acesso pelo console para depuração: __GPTEXPORT__.paraMd(conv, {id}, __GPTEXPORT__.novoEst())
  window.__GPTEXPORT__ = { versao: VERSAO, paraMd, novoEst, executar };
  const iniciar = () => { if (!document.body) return; montarUI(); setInterval(montarUI, 3000); }; // SPA: recoloca o botão
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
