// GPTEXPORT 1.3.0 — exportador de conversas do ChatGPT para .md no padrão do Cofre de Notas.
// Um script só, dois usos (ver docs/PASTAS-CONVERSAS.md):
//  - Cofre de Notas: injetado na janela "chatgpt"; grava em D:\915_CofreNotas-Conversas\1_Chatgpt.
//  - Chrome: colar no Console (F12) do chatgpt.com; na 1ª vez pede a pasta e depois lembra.
// Antes de exportar confere a pasta: conversa idêntica é ignorada, alterada substitui o arquivo antigo.
// Depois de exportar confere cada .md contra o padrão do Cofre (cabeçalho + turnos).
// Roda antes do DOM existir no Cofre, por isso as guardas abaixo.
(() => {
  'use strict';
  if (window.top !== window) return;                 // so no frame principal
  if (location.hostname !== 'chatgpt.com') return;   // nao montar painel em auth.openai.com etc.
  if (window.__GPTEXPORT__) { console.log('[GPTEXPORT] já carregado — recarregue a página (F5) para colar de novo.'); return; }

  const VERSAO = '1.3.0';
  const CFG = { pausaMin: 1500, pausaMax: 4000, tentativas: 5, pagGeral: 100, pagProjeto: 50, maxPaginas: 50, cabecalhoBytes: 4096 };
  const DIA = 864e5;
  const st = { token: null, cancelar: false, rodando: false, dir: null };

  // ---------- utilidades ----------
  const esp = ms => new Promise(r => setTimeout(r, ms));
  const pausa = () => esp(CFG.pausaMin + Math.random() * (CFG.pausaMax - CFG.pausaMin));
  const toMs = v => (v == null ? 0 : typeof v === 'number' ? v * 1000 : Date.parse(v));
  const iso = v => { const t = toMs(v); return t ? new Date(t).toISOString() : ''; };
  const conta = (o, k) => (o[k] = (o[k] || 0) + 1);
  const dois = n => String(n).padStart(2, '0');
  const dataLocal = d => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`; // AAAA-MM-DD no fuso local
  const diasAtras = n => dataLocal(new Date(Date.now() - n * DIA));
  const linha = (bloco, detalhe, veredicto) => ({ bloco, detalhe, veredicto });
  const slug = s => (s || 'sem-titulo').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
  const noPeriodo = (v, corte, teto) => { const t = toMs(v); return t >= corte && t <= teto; };

  async function listarGeral(corte, teto) {
    const out = [];
    let off = 0;
    for (let p = 0; p < CFG.maxPaginas; p++) {
      const j = await api(`/backend-api/conversations?offset=${off}&limit=${CFG.pagGeral}&order=updated`);
      const pg = j.items || [];
      off += pg.length;
      for (const c of pg) if (noPeriodo(c.update_time, corte, teto)) out.push({ id: c.id, title: c.title, update_time: c.update_time, projeto: '' });
      if (!pg.length || toMs(pg.at(-1).update_time) < corte || off >= (j.total ?? Infinity)) break;
      await esp(800);
    }
    return out;
  }

  async function listarProjetos(corte, teto) {
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
          if (noPeriodo(it.update_time, corte, teto)) out.push({ id: it.id, title: it.title, update_time: it.update_time, projeto: pj.nome });
        }
        c = j.cursor;
        await esp(800);
      }
    }
    return { projetos, conversas: out };
  }

  // ---------- citações (novas: content_references | antigas: 【…】) ----------
  const MARCADOR_CIT = /\uE200cite(?:\uE202[^\uE200\uE201]*)+\uE201/gu;
  const RESIDUO_PUA = /[\uE000-\uF8FF]/gu;
  const normCit = s => s.replace(/[\u00A0\u202F\u2007\u2060]/gu, ' ').replace(/[\uE203\uE204]/gu, '');
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
    // padrão do Cofre (src/lib/import/frontmatter.ts): title, origem, uuid, created, updated + extras
    // `updated` vem da listagem: é o mesmo valor usado para reconhecer duplicata idêntica
    const titulo = (conv.title || meta.title || 'Sem título').replace(/"/g, '');
    const fm = [
      '---',
      `title: "${titulo}"`,
      'origem: CHATGPT',
      `uuid: ${meta.id}`,
      `created: ${iso(conv.create_time)}`,
      `updated: ${iso(meta.update_time || conv.update_time)}`,
      `projeto: "${(meta.projeto || '').replace(/"/g, '')}"`,
      `modelo: ${modelo}`,
      `url: https://chatgpt.com/c/${meta.id}`,
      `exportador: gptexport ${VERSAO}`,
      '---',
      ''
    ].join('\n');
    // turnos iguais aos do Claude: "## 👤 You *(AAAA-MM-DD HH:MM)*" (UTC), que a limpeza de cortesias reconhece
    const hora = ts => iso(ts).slice(0, 16).replace('T', ' ');
    const corpo = itens.map(i => `## ${i.role === 'user' ? '👤 You' : '🤖 ChatGPT'} *(${i.ts ? hora(i.ts) : ''})*\n\n${i.txt}\n`).join('\n');
    const saida = `${fm}\n${corpo}`;
    est.residuos += (saida.match(RESIDUO_PUA) || []).length;
    return saida;
  }

  /** Nome de arquivo de conversa nova: data de criação (não muda com edições) + título + 8 do id. */
  const nomeNovo = (conv, meta) =>
    `${iso(conv.create_time || meta.update_time).slice(0, 10)}-${slug(conv.title || meta.title)}-${meta.id.slice(0, 8)}.md`;

  // ---------- conferência (padrão do Cofre) ----------
  const CAMPOS_COFRE = ['title', 'origem', 'uuid', 'created', 'updated'];

  /** Lista de problemas do .md contra o padrão do Cofre; vazia = aprovado. */
  function conferir(md) {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
    if (!fm) return ['sem cabeçalho'];
    const problemas = [];
    const faltam = CAMPOS_COFRE.filter(k => !new RegExp(`^${k}:[ \\t]*[^\\s"]`, 'm').test(fm[1]) && !new RegExp(`^${k}:[ \\t]*"[^"]`, 'm').test(fm[1]));
    if (faltam.length) problemas.push(`cabeçalho sem ${faltam.join(', ')}`);
    if (!/^origem: CHATGPT$/m.test(fm[1])) problemas.push('origem diferente de CHATGPT');
    if (!/^## 👤 You \*\(/m.test(md)) problemas.push('sem pergunta');
    if (!/^## 🤖 ChatGPT \*\(/m.test(md)) problemas.push('sem resposta do ChatGPT (imagem gerada e pesquisa aprofundada não são exportadas)');
    if ((md.match(RESIDUO_PUA) || []).length) problemas.push('marcador de citação sobrando');
    if (/\[(?:parte|conteúdo) [^\]\n]* não suportad[oa]\]/.test(md)) problemas.push('conteúdo não suportado');
    return problemas;
  }

  // ---------- destino ----------
  // Cofre: grava direto na pasta padrão (comandos Rust salvar_/listar_conversas_chatgpt).
  // Chrome: o navegador só grava numa pasta que você escolheu uma vez; a escolha fica guardada
  // (IndexedDB do chatgpt.com) e é reusada. "Alterar pasta" troca. Sem esse recurso: Downloads.
  const PASTA_PADRAO = 'D:\\915_CofreNotas-Conversas\\1_Chatgpt';
  const NOME_PADRAO = '1_Chatgpt';
  const invokeCofre = () => window.__TAURI_INTERNALS__?.invoke;

  function idb(modo, fn) {
    return new Promise((ok, erro) => {
      const r = indexedDB.open('gptexport', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('cfg');
      r.onerror = () => erro(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction('cfg', modo);
        const req = fn(tx.objectStore('cfg'));
        tx.oncomplete = () => ok(req.result);
        tx.onerror = () => erro(tx.error);
      };
    });
  }
  const lerPastaGuardada = () => idb('readonly', s => s.get('pasta')).catch(() => null);
  const guardarPasta = dir => idb('readwrite', s => s.put(dir, 'pasta')).catch(() => null);

  const rotuloDestino = d => d.tipo === 'cofre' ? PASTA_PADRAO
    : d.tipo === 'pasta' ? (d.dir.name === NOME_PADRAO ? PASTA_PADRAO : `pasta "${d.dir.name}" (escolhida por você)`)
    : 'downloads do navegador (sem conferir duplicatas)';

  async function escolherPasta() {
    const dir = await window.showDirectoryPicker({ id: 'gptexport', mode: 'readwrite' });
    st.dir = dir;
    await guardarPasta(dir);
    mostrarDestino({ tipo: 'pasta', dir });
    return dir;
  }

  /** Chamado logo no clique (o Chrome exige o gesto para pedir permissão ou abrir o seletor). */
  async function prepararDestino() {
    if (invokeCofre()) return { tipo: 'cofre' };
    if (!window.showDirectoryPicker) return { tipo: 'download' };
    let dir = st.dir || await lerPastaGuardada();
    if (dir && await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') dir = null;
    try {
      if (!dir) dir = await escolherPasta();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`seleção de pasta cancelada — escolha ${PASTA_PADRAO}`);
      throw e;
    }
    st.dir = dir;
    return { tipo: 'pasta', dir };
  }

  // ---------- duplicatas: o que já está na pasta ----------
  /** uuid e updated do cabeçalho (aceita também o formato antigo id/alterado). */
  function lerCabecalho(nome, txt) {
    const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
    if (!fm) return null;
    const v = k => ((new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(fm[1]) || [])[1] || '').trim();
    const uuid = v('uuid') || v('id');
    if (!uuid) return null;
    return { nome, uuid, updated: v('updated') || v('alterado'), padrao: v('origem') === 'CHATGPT' };
  }

  /** Mapa uuid → arquivo existente (havendo mais de um, vale o de updated mais novo). */
  async function indexarPasta(dest) {
    const brutos = [];
    if (dest.tipo === 'cofre') {
      brutos.push(...await invokeCofre()('listar_conversas_chatgpt'));
    } else if (dest.tipo === 'pasta') {
      for await (const [nome, h] of dest.dir.entries()) {
        if (h.kind !== 'file' || !/\.md$/i.test(nome)) continue;
        brutos.push({ nome, cabecalho: await (await h.getFile()).slice(0, CFG.cabecalhoBytes).text() });
      }
    }
    const idx = new Map();
    for (const b of brutos) {
      const e = lerCabecalho(b.nome, b.cabecalho);
      if (!e) continue;
      const atual = idx.get(e.uuid);
      if (!atual || toMs(e.updated) > toMs(atual.updated)) idx.set(e.uuid, e);
    }
    return idx;
  }

  /**
   * nova = não está na pasta | identica = mesma conversa, mesmo updated, já no padrão → ignorada
   * alterada = está na pasta mas mudou (ou ainda no formato antigo) → regrava no MESMO arquivo
   */
  function classificar(lista, idx) {
    return lista.map(c => {
      const e = idx.get(c.id);
      if (!e) return { ...c, situacao: 'nova' };
      if (e.padrao && iso(e.updated) === iso(c.update_time)) return { ...c, situacao: 'identica', arquivo: e.nome };
      return { ...c, situacao: 'alterada', arquivo: e.nome };
    });
  }

  async function salvar(dest, nome, txt) {
    if (dest.tipo === 'cofre') {
      await invokeCofre()('salvar_conversa_chatgpt', { nome, conteudo: txt });
      return;
    }
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

  // ---------- execução ----------
  // Diagnosticar: só lista quantas e quais conversas entram no período; nada é baixado.
  // Exportar: lista de novo e baixa cada conversa como .md.
  const novoEst = () => ({ nos: 0, visiveis: 0, msgs: 0, mescladas: 0, anexos: 0, imagens: 0, residuos: 0, pulados: {}, tipos: {}, cit: { trocadas: 0, fontes: 0 } });
  const minutos = n => Math.ceil(n * 2.9 / 60); // ~2,9 s por conversa (pausa anti-bloqueio + download)

  /** Conversas do período (geral + Projetos, sem repetir), da mais nova para a mais antiga. */
  async function listarPeriodo(corte, teto, res) {
    await token();
    res.push(linha('1 token', 'obtido', 'OK'));
    const geral = await listarGeral(corte, teto);
    res.push(linha('2 listagem geral', `${geral.length} no período`, 'OK'));
    const { projetos, conversas: proj } = await listarProjetos(corte, teto);
    res.push(linha('3 projetos', `${projetos.length} projeto(s) | ${proj.length} conversa(s) no período`, 'OK'));
    const mapa = new Map();
    for (const c of [...geral, ...proj]) {
      if (!mapa.has(c.id)) mapa.set(c.id, c);
      else if (c.projeto) mapa.get(c.id).projeto = c.projeto;
    }
    const lista = [...mapa.values()].sort((a, b) => toMs(b.update_time) - toMs(a.update_time));
    res.push(linha('4 consolidado', `${lista.length} única(s) | repetidas entre geral e projetos: ${geral.length + proj.length - lista.length}`, 'OK'));
    return lista;
  }

  const linhaConversa = (c, i) =>
    `${String(i + 1).padStart(4)}. ${iso(c.update_time).slice(0, 10)}  ${c.title || 'Sem título'}${c.projeto ? `  [${c.projeto}]` : ''}${c.situacao === 'alterada' ? '  (alterada: substitui o arquivo antigo)' : ''}`;

  function avisarDuplicatas(identicas, dest) {
    if (dest.tipo === 'download') log('⚠ Sem acesso à pasta: não dá para conferir duplicatas; tudo será baixado.\n');
    if (!identicas.length) return;
    log(`⚠ ${identicas.length} duplicata(s) idêntica(s) — já estão na pasta sem alteração e serão ignoradas:\n${identicas.map(linhaConversa).join('\n')}\n`);
  }

  function mostrarLista(fila) {
    if (!fila.length) { log('Nada a exportar no período.'); return; }
    const alteradas = fila.filter(c => c.situacao === 'alterada').length;
    log(`${fila.length} conversa(s) serão exportadas — ${fila.length - alteradas} nova(s), ${alteradas} alterada(s) — tempo estimado ~${minutos(fila.length)} min\n\n${fila.map(linhaConversa).join('\n')}`);
  }

  function mostrarConferencia(salvas, reprovadas) {
    log(`\nConferência (padrão do Cofre): ${salvas - reprovadas.length} aprovada(s), ${reprovadas.length} com problema`);
    reprovadas.forEach(r => log(`  ✗ ${r.nome} — ${r.problemas.join('; ')}`));
  }

  /** periodo = { corte, teto } em ms (inclusive), vindo dos campos De/Até do painel. */
  async function executar(periodo, exportar) {
    if (st.rodando) return;
    const { corte, teto } = periodo;
    if (!(corte <= teto)) { log('Período inválido: a data "De" está depois da data "Até".'); return; }
    st.rodando = true; st.cancelar = false; limparLog();
    const t0 = Date.now();
    const res = [], falhas = [], reprovadas = [], est = novoEst();
    let novas = 0, substituidas = 0;
    try {
      const dest = await prepararDestino(); // 1º await: precisa do gesto do clique (permissão/seletor de pasta)
      log(`${exportar ? 'EXPORTAR' : 'DIAGNOSTICAR'} — de ${corte ? dataLocal(new Date(corte)) : 'o início'} até ${dataLocal(new Date(teto))}\nDestino: ${rotuloDestino(dest)}\n`);
      status('Listando conversas…');
      const lista = await listarPeriodo(corte, teto, res);
      status('Conferindo duplicatas na pasta…');
      const classificadas = classificar(lista, await indexarPasta(dest));
      const identicas = classificadas.filter(c => c.situacao === 'identica');
      const alvo = classificadas.filter(c => c.situacao !== 'identica');
      res.push(linha('4b duplicatas', `${identicas.length} idêntica(s) ignorada(s) | ${alvo.length} para exportar`, 'OK'));
      avisarDuplicatas(identicas, dest);
      if (!exportar) { mostrarLista(alvo); return; }

      log(`Exportando ${alvo.length} conversa(s) — ~${minutos(alvo.length)} min`);
      for (let i = 0; i < alvo.length; i++) {
        if (st.cancelar) { log('Cancelado pelo usuário.'); break; }
        const c = alvo[i];
        status(`PROCESSANDO ${i + 1}/${alvo.length}`);
        try {
          const conv = await api(`/backend-api/conversation/${c.id}`);
          const md = paraMd(conv, c, est);
          const nome = c.arquivo || nomeNovo(conv, c); // alterada: mesmo arquivo, sem deixar versão antiga
          await salvar(dest, nome, md);
          if (c.arquivo) substituidas++; else novas++;
          const problemas = conferir(md);
          if (problemas.length) reprovadas.push({ nome, problemas });
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
      const salvas = novas + substituidas;
      res.push(linha('10 destino', `${salvas} de ${alvo.length} salvos em ${rotuloDestino(dest)}`, salvas === alvo.length ? 'OK' : 'ATENCAO'));
      res.push(linha('11 conferência', `${salvas - reprovadas.length} aprovada(s) | ${reprovadas.length} com problema`, reprovadas.length ? 'ATENCAO' : 'OK'));
      res.push(linha('12 tempo', `${Math.round((Date.now() - t0) / 1000)}s`, 'OK'));
      log(`\nResultado: ${novas} nova(s), ${substituidas} substituída(s), ${identicas.length} ignorada(s) por duplicata, ${falhas.length} falha(s) — ${Math.round((Date.now() - t0) / 1000)}s`);
      mostrarConferencia(salvas, reprovadas);
    } catch (e) {
      res.push(linha('ERRO', e.message, 'FALHA'));
    } finally {
      // popup: só o resumo e o que falhou; o relatório técnico completo fica no console
      console.table(res);
      if (falhas.length) console.table(falhas);
      if (reprovadas.length) console.table(reprovadas.map(r => ({ arquivo: r.nome, problemas: r.problemas.join('; ') })));
      res.filter(r => r.veredicto === 'FALHA').forEach(r => log(`[${r.veredicto}] ${r.bloco}: ${r.detalhe}`));
      status('');
      st.rodando = false;
    }
  }

  // ---------- painel (só estilo inline: o CSP do chatgpt.com bloqueia CSS externo) ----------
  let $log, $status, $destino;
  const el = (tag, props = {}, filhos = []) => { const e = Object.assign(document.createElement(tag), props); filhos.forEach(f => e.appendChild(f)); return e; };
  const mostrarDestino = d => { if ($destino) $destino.textContent = `Destino: ${rotuloDestino(d)}`; };
  const log = msg => { console.log(`[GPTEXPORT] ${msg}`); if ($log) { $log.textContent += msg + '\n'; $log.scrollTop = $log.scrollHeight; } };
  const limparLog = () => { if ($log) $log.textContent = ''; };
  const status = t => { if ($status) $status.textContent = t; };

  function montarUI() {
    if (document.getElementById('gptx-btn')) return;
    const bt = 'padding:5px 9px;border-radius:6px;border:1px solid #6b7280;background:#374151;color:#f9fafb;font:12px system-ui;cursor:pointer';
    const campo = 'padding:4px;border-radius:6px;font:12px system-ui;color:#111827;background:#f9fafb;border:1px solid #6b7280';
    const $de = el('input', { type: 'date', value: diasAtras(7), style: campo });
    const $ate = el('input', { type: 'date', value: dataLocal(new Date()), style: campo });
    // atalho só preenche as datas; quem manda são os campos De/Até
    const atalho = el('select', { style: campo, onchange: () => {
      $de.value = atalho.value === 'tudo' ? '' : diasAtras(+atalho.value);
      $ate.value = dataLocal(new Date());
    } }, [
      el('option', { value: '7', textContent: 'Últimos 7 dias' }),
      el('option', { value: '30', textContent: 'Últimos 30 dias' }),
      el('option', { value: '90', textContent: 'Últimos 90 dias' }),
      el('option', { value: '365', textContent: 'Último ano' }),
      el('option', { value: 'tudo', textContent: 'Tudo (De vazio)' })
    ]);
    // De vazio = desde o início; Até vale o dia inteiro (até 23:59:59)
    const periodo = () => ({
      corte: $de.value ? new Date(`${$de.value}T00:00:00`).getTime() : 0,
      teto: $ate.value ? new Date(`${$ate.value}T00:00:00`).getTime() + DIA - 1 : Date.now()
    });
    // destino: no Cofre é fixo; no Chrome mostra o padrão e permite trocar
    const podeEscolher = !invokeCofre() && !!window.showDirectoryPicker;
    $destino = el('span', { style: 'font:12px system-ui;color:#d1d5db;word-break:break-all' });
    mostrarDestino(invokeCofre() ? { tipo: 'cofre' } : podeEscolher ? { tipo: 'pasta', dir: st.dir || { name: NOME_PADRAO } } : { tipo: 'download' });
    if (podeEscolher && !st.dir) lerPastaGuardada().then(d => { if (d) { st.dir = d; mostrarDestino({ tipo: 'pasta', dir: d }); } });
    const alterar = el('button', { textContent: 'Alterar pasta', title: `Padrão: ${PASTA_PADRAO}`, style: bt, onclick: () => {
      escolherPasta().catch(e => { if (e.name !== 'AbortError') log(`Não foi possível trocar a pasta: ${e.message}`); });
    } });
    $status = el('span', { style: 'font:12px system-ui;color:#fbbf24' });
    $log = el('pre', { textContent: 'Escolha o período e clique em Diagnosticar para ver quantas e quais conversas serão exportadas.', style: 'flex:1 1 auto;min-height:80px;margin:10px 0 0;overflow:auto;white-space:pre-wrap;font:12px/1.5 ui-monospace,Consolas,monospace;background:#111827;color:#d1d5db;padding:8px;border-radius:8px' });
    // popup centralizado, aberto assim que o script roda; ✕ fecha e o botão ⬇ GPT reabre
    const painel = el('div', { id: 'gptx-painel', style: 'display:flex;flex-direction:column;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;width:min(640px,92vw);max-height:85vh;box-sizing:border-box;background:#1f2937;color:#f9fafb;border:1px solid #4b5563;border-radius:12px;padding:14px;box-shadow:0 20px 60px rgba(0,0,0,.5);font:13px system-ui' });
    const alternar = () => { painel.style.display = painel.style.display === 'none' ? 'flex' : 'none'; };
    [
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px' }, [
        el('div', { textContent: `Exportar conversas do ChatGPT — v${VERSAO}`, style: 'font-weight:600;font-size:14px' }),
        el('button', { textContent: '✕', title: 'Fechar (o botão ⬇ GPT reabre)', style: bt, onclick: alternar })
      ]),
      el('div', { style: 'display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px;padding:6px 8px;background:#111827;border-radius:8px' },
        podeEscolher ? [$destino, alterar] : [$destino]),
      el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, [
        atalho,
        el('span', { textContent: 'De' }), $de,
        el('span', { textContent: 'Até' }), $ate
      ]),
      el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
        el('button', { textContent: 'Diagnosticar', style: bt, onclick: () => executar(periodo(), false) }),
        el('button', { textContent: 'Exportar', style: bt + ';background:#2563eb;border-color:#2563eb', onclick: () => executar(periodo(), true) }),
        el('button', { textContent: 'Cancelar', style: bt, onclick: () => { st.cancelar = true; } })
      ]),
      el('div', { style: 'margin-top:8px;min-height:16px' }, [$status]),
      $log
    ].forEach(f => painel.appendChild(f));
    const btn = el('button', { id: 'gptx-btn', textContent: '⬇ GPT', title: 'Exportar conversas', style: 'position:fixed;right:16px;bottom:88px;z-index:2147483647;' + bt, onclick: alternar });
    document.body.append(painel, btn);
  }

  // acesso pelo console para depuração: __GPTEXPORT__.paraMd(conv, {id}, __GPTEXPORT__.novoEst())
  window.__GPTEXPORT__ = { versao: VERSAO, paraMd, novoEst, executar, conferir, lerCabecalho, classificar };
  const iniciar = () => { if (!document.body) return; montarUI(); setInterval(montarUI, 3000); }; // SPA: recoloca o botão
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
