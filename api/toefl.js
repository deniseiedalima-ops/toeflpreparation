// API da Plataforma TOEFL · English With Denise
// Rotas (todas em /api/toefl?acao=...):
//   config    → devolve o Google Client ID para a página
//   login     → confere o login Google, cria/atualiza o aluno no Notion e devolve uma sessão
//   enviar    → grava o resultado de um simulado no Notion (precisa da sessão)
//   historico → devolve os resultados do aluno logado (precisa da sessão)
//   setup     → cria as bases "TOEFL Alunos" e "TOEFL Resultados" no Notion (uma vez só)
//
// Variáveis de ambiente na Vercel:
//   NOTION_TOKEN          token da integração do Notion
//   GOOGLE_CLIENT_ID      Client ID do Google (o mesmo do app, com o domínio novo autorizado)
//   SESSION_SECRET        qualquer frase longa e secreta (assina as sessões dos alunos)
//   SETUP_KEY             senha para rodar o setup
//   NOTION_PARENT_PAGE    página do Notion onde as bases serão criadas (só para o setup)
//   TOEFL_ALUNOS_DB       ID da base de alunos (o setup devolve)
//   TOEFL_RESULTADOS_DB   ID da base de resultados (o setup devolve)
//   ACESSO_RESTRITO       opcional: "1" = aluno novo entra como "Pendente" até você liberar

const crypto = require('crypto');

const NOTION_API = 'https://api.notion.com/v1';
const env = k => (process.env[k] || '').trim();
// Aceita o ID puro, com hífens ou o link inteiro do Notion e devolve só o ID de 32 caracteres.
const idNotion = k => {
  const bruto = env(k).replace(/-/g, '');
  const m = bruto.match(/[0-9a-f]{32}/i);
  if (!m) throw new Error(`Variável ${k} vazia ou inválida na Vercel`);
  return m[0];
};
const nHeaders = () => ({
  Authorization: `Bearer ${env('NOTION_TOKEN') || env('REACT_APP_NOTION_TOKEN')}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});
async function notion(path, method = 'GET', body) {
  if (!env('NOTION_TOKEN') && !env('REACT_APP_NOTION_TOKEN')) throw new Error('Variável NOTION_TOKEN vazia na Vercel');
  const r = await fetch(NOTION_API + path, { method, headers: nHeaders(), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Notion: ${j.message || r.status}`);
  return j;
}

const NOMES = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking' };
const cut = (s, n = 1990) => String(s ?? '').slice(0, n);
const rich = s => [{ text: { content: cut(s) } }];
const plain = p => (p && (p.title || p.rich_text) || []).map(t => t.plain_text).join('');
const hoje = () => new Date().toISOString();

/* ---------- sessão assinada (HMAC) ---------- */
const b64 = s => Buffer.from(s).toString('base64url');
function assinar(dados) {
  const corpo = b64(JSON.stringify({ ...dados, exp: Date.now() + 30 * 24 * 3600 * 1000 }));
  const sig = crypto.createHmac('sha256', env('SESSION_SECRET')).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}
function lerSessao(token) {
  if (!token || !env('SESSION_SECRET')) return null;
  const [corpo, sig] = String(token).split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', env('SESSION_SECRET')).update(corpo).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  const d = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  return d.exp > Date.now() ? d : null;
}

/* ---------- login Google ---------- */
async function verificarGoogle(credential) {
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw new Error('Login Google inválido');
  const t = await r.json();
  if (t.aud !== env('GOOGLE_CLIENT_ID')) throw new Error('Client ID não confere');
  if (String(t.email_verified) !== 'true') throw new Error('E-mail Google não verificado');
  return { email: t.email.toLowerCase(), nome: t.name || t.email, foto: t.picture || '', googleId: t.sub };
}

async function acharAluno(email) {
  const q = await notion(`/databases/${idNotion('TOEFL_ALUNOS_DB')}/query`, 'POST', { filter: { property: 'E-mail', email: { equals: email } }, page_size: 1 });
  return q.results[0] || null;
}

async function login(body) {
  if (!env('SESSION_SECRET')) throw new Error('Variável SESSION_SECRET vazia na Vercel');
  const g = await verificarGoogle(body.credential);
  let pg = await acharAluno(g.email);
  if (!pg) {
    pg = await notion('/pages', 'POST', {
      parent: { database_id: idNotion('TOEFL_ALUNOS_DB') },
      icon: { type: 'emoji', emoji: '🎓' },
      properties: {
        'Aluno': { title: rich(g.nome) },
        'E-mail': { email: g.email },
        'Foto': { url: g.foto || null },
        'Google ID': { rich_text: rich(g.googleId) },
        'Status': { select: { name: env('ACESSO_RESTRITO') === '1' ? 'Pendente' : 'Ativo' } },
        'Primeiro acesso': { date: { start: hoje() } },
        'Último acesso': { date: { start: hoje() } },
        'Acessos': { number: 1 },
      },
    });
  } else {
    const extra = {};
    if (!(pg.properties['Primeiro acesso'] && pg.properties['Primeiro acesso'].date)) extra['Primeiro acesso'] = { date: { start: hoje() } };
    if (!plain(pg.properties['Google ID'])) extra['Google ID'] = { rich_text: rich(g.googleId) };
    await notion(`/pages/${pg.id}`, 'PATCH', { properties: {
      ...extra,
      'Último acesso': { date: { start: hoje() } },
      'Acessos': { number: ((pg.properties['Acessos'] || {}).number || 0) + 1 },
      'Foto': { url: g.foto || null },
    } });
  }
  const status = (pg.properties['Status'] && pg.properties['Status'].select && pg.properties['Status'].select.name) || 'Ativo';
  if (status === 'Bloqueado' || status === 'Pendente') {
    return { bloqueado: true, status, nome: g.nome };
  }
  const nome = plain(pg.properties['Aluno']) || g.nome;
  const professora = !!(pg.properties['Professora'] && pg.properties['Professora'].checkbox);
  return { token: assinar({ email: g.email, alunoId: pg.id, nome, professora }), nome, email: g.email, foto: g.foto, professora };
}

/* ---------- gravar resultado ---------- */
const bloco = (type, t) => ({ object: 'block', type, [type]: { rich_text: rich(t) } });
function paragrafos(texto) {
  const s = String(texto || ''); const out = [];
  for (let i = 0; i < s.length; i += 1900) out.push(bloco('paragraph', s.slice(i, i + 1900)));
  return out.length ? out : [bloco('paragraph', '(em branco)')];
}

async function enviar(body, sessao) {
  const { simulado, simId, modo, geral, duracaoMin, secoes = {} } = body;
  if (!simulado) throw new Error('Missing fields');
  const tipo = modo === 'completo' ? 'Completo' : (NOMES[Object.keys(secoes)[0]] || 'Completo');
  const num = v => (v == null || v === '' ? null : Number(v));
  const R = secoes.reading, L = secoes.listening, W = secoes.writing, S = secoes.speaking;
  const temCorrecao = !!(W && (W.textos || []).length) || !!(S && (S.gravacoes || []).length);
  const obj = Object.values(secoes).filter(s => s.total);
  const ac = obj.reduce((a, s) => a + s.acertos, 0), tot = obj.reduce((a, s) => a + s.total, 0);
  const pt = {}; Object.values(secoes).forEach(s => Object.entries(s.porTipo || {}).forEach(([k, v]) => { pt[k] = pt[k] || { a: 0, t: 0 }; pt[k].a += v.a; pt[k].t += v.t; }));
  const fracos = Object.entries(pt).filter(([, v]) => v.t && v.a / v.t < 0.6).map(([k]) => k);
  const mod2 = s => (s && s.caminho && s.caminho !== 'base') ? { select: { name: s.caminho === 'dificil' ? 'Difícil' : 'Fácil' } } : { select: null };
  const palavras = n => { const t = W && (W.textos || []).find(x => x.nome === n); return t ? t.palavras : null; };
  const links = S ? (S.gravacoes || []).map(g => g.url).filter(Boolean) : [];

  const children = [];
  for (const [k, s] of Object.entries(secoes)) {
    children.push(bloco('heading_2', `${NOMES[k]} — ${s.titulo}` + (s.banda != null ? ` · banda ${s.banda}` : '')));
    if (s.caminho && s.caminho !== 'base') children.push(bloco('bulleted_list_item', `Módulo 2: ${s.caminho === 'dificil' ? 'difícil' : 'fácil'}`));
    Object.entries(s.porTipo || {}).forEach(([n, v]) => children.push(bloco('bulleted_list_item', `${n}: ${v.a}/${v.t}`)));
    if ((s.erros || []).length) { children.push(bloco('heading_3', 'Erros')); s.erros.slice(0, 30).forEach(e => children.push(bloco('bulleted_list_item', e))); }
    (s.textos || []).forEach(t => { children.push(bloco('heading_3', `${t.nome} (${t.palavras} palavras)`)); children.push(bloco('quote', 'Prompt: ' + t.prompt)); children.push(...paragrafos(t.texto)); });
    if ((s.gravacoes || []).length) { children.push(bloco('heading_3', 'Gravações')); s.gravacoes.forEach(g => children.push(bloco('bulleted_list_item', `${g.nome} — "${g.prompt}" → ${g.url || 'sem link (aluno envia pelo WhatsApp)'}`))); }
  }

  const criada = await notion('/pages', 'POST', {
    parent: { database_id: idNotion('TOEFL_RESULTADOS_DB') },
    properties: {
      'Resultado': { title: rich(`${sessao.nome} · ${simulado}`) },
      'Aluno': { relation: [{ id: sessao.alunoId }] },
      'E-mail': { email: sessao.email },
      'Simulado': { rich_text: rich(simulado) },
      'ID simulado': { rich_text: rich(simId || '') },
      'Tipo': { select: { name: tipo } },
      'Data': { date: { start: hoje() } },
      'Reading': { number: num(R && R.banda) },
      'Listening': { number: num(L && L.banda) },
      'Geral estimado': { number: modo === 'completo' ? num(geral) : null },
      'Módulo 2 Reading': mod2(R),
      'Módulo 2 Listening': mod2(L),
      'Acertos': { number: tot ? ac : null },
      'Total objetivas': { number: tot || null },
      '% Objetivas': { number: tot ? Math.round(ac / tot * 1000) / 1000 : null },
      'Pontos fracos': { multi_select: fracos.slice(0, 10).map(name => ({ name })) },
      'Palavras e-mail': { number: palavras('Write an Email') },
      'Palavras discussão': { number: palavras('Write for an Academic Discussion') },
      'Gravações': { url: links[0] || null },
      'Duração (min)': { number: num(duracaoMin) },
      'Correção': { select: { name: temCorrecao ? 'Aguardando correção' : 'Só objetivas' } },
      'Detalhes': { rich_text: rich(JSON.stringify(pt)) },
    },
    children: children.slice(0, 100),
  });
  return { ok: true, pageId: criada.id };
}

/* ---------- histórico do aluno ---------- */
async function historico(sessao) {
  const q = await notion(`/databases/${idNotion('TOEFL_RESULTADOS_DB')}/query`, 'POST', {
    filter: { property: 'E-mail', email: { equals: sessao.email } },
    sorts: [{ property: 'Data', direction: 'descending' }], page_size: 100,
  });
  return q.results.map(p => {
    const pr = p.properties; const n = k => (pr[k] && pr[k].number != null ? pr[k].number : null);
    let porTipo = {}; try { porTipo = JSON.parse(plain(pr['Detalhes']) || '{}'); } catch {}
    const d = pr['Data'] && pr['Data'].date ? pr['Data'].date.start : null;
    return {
      quando: d ? Date.parse(d) : 0, data: d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' }) : '',
      simulado: plain(pr['Simulado']), simId: plain(pr['ID simulado']),
      modo: pr['Tipo'] && pr['Tipo'].select && pr['Tipo'].select.name === 'Completo' ? 'completo' : 'habilidade',
      reading: n('Reading'), listening: n('Listening'), writing: n('Writing'), speaking: n('Speaking'),
      geralParcial: n('Geral estimado'), porTipo,
      correcao: pr['Correção'] && pr['Correção'].select ? pr['Correção'].select.name : '',
      id: p.id,
      feedback: plain(pr['Feedback geral'] || pr['Feedback']),
      feedbackWriting: plain(pr['Feedback Writing']),
      feedbackSpeaking: plain(pr['Feedback Speaking']),
      editado: p.last_edited_time,
      notaFinal: pr['Nota final'] && pr['Nota final'].formula && typeof pr['Nota final'].formula.number === 'number' ? pr['Nota final'].formula.number : null,
    };
  });
}

/* ---------- detalhe de um resultado: textos e gravações do próprio aluno ---------- */
async function detalhe(body, sessao) {
  const id = String(body.id || '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error('Resultado inválido');
  const pg = await notion(`/pages/${id}`);
  const dono = pg.properties && pg.properties['E-mail'] && pg.properties['E-mail'].email;
  if (!dono || dono.toLowerCase() !== sessao.email) throw new Error('Este resultado não é seu');
  const blocos = (await notion(`/blocks/${id}/children?page_size=100`)).results || [];
  const txt = b => ((b[b.type] && b[b.type].rich_text) || []).map(t => t.plain_text).join('');
  const textos = []; const gravacoes = []; let atual = null; let emGrav = false;
  for (const b of blocos) {
    if (b.type === 'heading_2') { atual = null; emGrav = false; continue; }
    if (b.type === 'heading_3') {
      const t = txt(b);
      emGrav = t === 'Gravações';
      atual = /Write an Email|Academic Discussion/.test(t) ? { titulo: t, prompt: '', texto: '' } : null;
      if (atual) textos.push(atual);
      continue;
    }
    if (atual && b.type === 'quote') atual.prompt = txt(b).replace(/^Prompt:\s*/, '');
    else if (atual && b.type === 'paragraph') atual.texto += (atual.texto ? '\n' : '') + txt(b);
    else if (emGrav && b.type === 'bulleted_list_item') {
      const t = txt(b); const m = t.match(/https?:\/\/\S+/);
      gravacoes.push({ descricao: t.replace(/\s*→.*$/, ''), url: m ? m[0] : null });
    }
  }
  return { textos, gravacoes };
}

/* ---------- Painel da professora ---------- */
const linkNotion = id => 'https://www.notion.so/' + String(id).replace(/-/g, '');
async function painel() {
  const [al, rs] = await Promise.all([
    notion(`/databases/${idNotion('TOEFL_ALUNOS_DB')}/query`, 'POST', { page_size: 100, sorts: [{ property: 'Último acesso', direction: 'descending' }] }),
    notion(`/databases/${idNotion('TOEFL_RESULTADOS_DB')}/query`, 'POST', { page_size: 40, sorts: [{ property: 'Data', direction: 'descending' }] }),
  ]);
  const sel = (p, k) => p.properties[k] && p.properties[k].select ? p.properties[k].select.name : '';
  const num = (p, k) => p.properties[k] && p.properties[k].number != null ? p.properties[k].number : null;
  const data = (p, k) => p.properties[k] && p.properties[k].date ? p.properties[k].date.start : null;
  const alunos = al.results.map(p => ({ nome: plain(p.properties['Aluno']), email: p.properties['E-mail'] && p.properties['E-mail'].email, status: sel(p, 'Status'), turma: sel(p, 'Turma'), meta: num(p, 'Meta (banda)'), ultimo: data(p, 'Último acesso'), url: linkNotion(p.id) }));
  const nomePorId = Object.fromEntries(al.results.map(p => [p.id, plain(p.properties['Aluno'])]));
  const resultados = rs.results.map(p => {
    const rel = p.properties['Aluno'] && p.properties['Aluno'].relation || [];
    const nf = p.properties['Nota final'] && p.properties['Nota final'].formula;
    return { aluno: rel[0] ? (nomePorId[rel[0].id] || '') : plain(p.properties['Resultado']).split(' · ')[0], simulado: plain(p.properties['Simulado']), tipo: sel(p, 'Tipo'), data: data(p, 'Data'), correcao: sel(p, 'Correção'), nota: nf && typeof nf.number === 'number' ? nf.number : null, url: linkNotion(p.id) };
  });
  return {
    alunos, resultados,
    links: { alunos: linkNotion(idNotion('TOEFL_ALUNOS_DB')), resultados: linkNotion(idNotion('TOEFL_RESULTADOS_DB')) },
  };
}
async function cadastrar(body) {
  const nome = String(body.nome || '').trim(), email = String(body.email || '').trim().toLowerCase();
  if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Preencha nome e um e-mail válido');
  if (await acharAluno(email)) throw new Error('Esse e-mail já está cadastrado');
  const props = {
    'Aluno': { title: rich(nome) }, 'E-mail': { email },
    'Status': { select: { name: 'Ativo' } }, 'Acessos': { number: 0 },
  };
  if (body.turma) props['Turma'] = { select: { name: body.turma === 'Grupo' ? 'Grupo' : 'Particular' } };
  if (body.meta) props['Meta (banda)'] = { number: Number(body.meta) };
  if (body.dataProva) props['Data da prova'] = { date: { start: String(body.dataProva).slice(0, 10) } };
  const pg = await notion('/pages', 'POST', { parent: { database_id: idNotion('TOEFL_ALUNOS_DB') }, icon: { type: 'emoji', emoji: '🎓' }, properties: props });
  return { ok: true, url: linkNotion(pg.id) };
}

/* ---------- perfil do aluno (meta e data da prova que a Denise preenche) ---------- */
async function perfilAluno(sessao) {
  try {
    const pg = await notion(`/pages/${sessao.alunoId}`);
    const pr = pg.properties || {};
    return {
      meta: pr['Meta (banda)'] && pr['Meta (banda)'].number != null ? pr['Meta (banda)'].number : null,
      dataProva: pr['Data da prova'] && pr['Data da prova'].date ? pr['Data da prova'].date.start : null,
    };
  } catch { return { meta: null, dataProva: null }; }
}

/* ---------- setup: cria as duas bases ---------- */
const sel = (nomes) => ({ select: { options: nomes.map(([name, color]) => ({ name, color })) } });
async function setup() {
  const parent = { type: 'page_id', page_id: idNotion('NOTION_PARENT_PAGE') };
  const alunos = await notion('/databases', 'POST', {
    parent, icon: { type: 'emoji', emoji: '🎓' },
    title: rich('TOEFL Alunos'),
    description: rich('Alunos da Plataforma TOEFL · cadastro automático pelo login Google'),
    properties: {
      'Aluno': { title: {} },
      'E-mail': { email: {} },
      'Status': sel([['Ativo', 'green'], ['Pendente', 'yellow'], ['Bloqueado', 'red']]),
      'Turma': sel([['Particular', 'purple'], ['Grupo', 'blue']]),
      'Meta (banda)': { number: { format: 'number' } },
      'Data da prova': { date: {} },
      'Primeiro acesso': { date: {} },
      'Último acesso': { date: {} },
      'Acessos': { number: { format: 'number' } },
      'Foto': { url: {} },
      'Google ID': { rich_text: {} },
      'Observações': { rich_text: {} },
    },
  });

  const resultados = await notion('/databases', 'POST', {
    parent, icon: { type: 'emoji', emoji: '📊' },
    title: rich('TOEFL Resultados'),
    description: rich('Um registro por simulado feito na Plataforma TOEFL'),
    properties: {
      'Resultado': { title: {} },
      'Aluno': { relation: { database_id: alunos.id, type: 'dual_property', dual_property: {} } },
      'E-mail': { email: {} },
      'Simulado': { rich_text: {} },
      'ID simulado': { rich_text: {} },
      'Tipo': sel([['Completo', 'orange'], ['Reading', 'blue'], ['Listening', 'purple'], ['Writing', 'green'], ['Speaking', 'pink']]),
      'Data': { date: {} },
      'Reading': { number: { format: 'number' } },
      'Listening': { number: { format: 'number' } },
      'Writing': { number: { format: 'number' } },
      'Speaking': { number: { format: 'number' } },
      'Geral estimado': { number: { format: 'number' } },
      'Módulo 2 Reading': sel([['Difícil', 'green'], ['Fácil', 'yellow']]),
      'Módulo 2 Listening': sel([['Difícil', 'green'], ['Fácil', 'yellow']]),
      'Acertos': { number: { format: 'number' } },
      'Total objetivas': { number: { format: 'number' } },
      '% Objetivas': { number: { format: 'percent' } },
      'Pontos fracos': { multi_select: { options: [] } },
      'Palavras e-mail': { number: { format: 'number' } },
      'Palavras discussão': { number: { format: 'number' } },
      'Gravações': { url: {} },
      'Duração (min)': { number: { format: 'number' } },
      'Correção': sel([['Aguardando correção', 'yellow'], ['Corrigido', 'green'], ['Só objetivas', 'gray']]),
      'Feedback geral': { rich_text: {} },
      'Feedback Writing': { rich_text: {} },
      'Feedback Speaking': { rich_text: {} },
      'Detalhes': { rich_text: {} },
    },
  });

  const avisos = [];
  // Nota geral final: média das seções preenchidas (Writing e Speaking entram quando você corrige), arredondada a 0,5.
  try {
    await notion(`/databases/${resultados.id}`, 'PATCH', { properties: { 'Nota final': { formula: { expression:
      'let(v, [prop("Reading"), prop("Listening"), prop("Writing"), prop("Speaking")].filter(!empty(current)), if(empty(v), "", format(round(v.sum() / v.length() * 2) / 2)))' } } } });
  } catch (e) { avisos.push('Fórmula "Nota final" não criada: ' + e.message); }

  // Na base de alunos: renomeia a relação e cria os resumos.
  try {
    const a = await notion(`/databases/${alunos.id}`);
    const rel = Object.entries(a.properties).find(([, p]) => p.type === 'relation');
    if (rel) {
      await notion(`/databases/${alunos.id}`, 'PATCH', { properties: { [rel[0]]: { name: 'Resultados' } } });
      const roll = (prop, fn) => ({ rollup: { relation_property_name: 'Resultados', rollup_property_name: prop, function: fn } });
      await notion(`/databases/${alunos.id}`, 'PATCH', { properties: {
        'Simulados feitos': roll('Resultado', 'count'),
        'Melhor geral': roll('Geral estimado', 'max'),
        'Melhor Reading': roll('Reading', 'max'),
        'Melhor Listening': roll('Listening', 'max'),
        'Último simulado': roll('Data', 'latest_date'),
        'Para corrigir': roll('Correção', 'count_per_group'),
      } });
    }
  } catch (e) { avisos.push('Resumos na base de alunos: ' + e.message); }

  return { TOEFL_ALUNOS_DB: alunos.id, TOEFL_RESULTADOS_DB: resultados.id, alunos: alunos.url, resultados: resultados.url, avisos };
}


/* =====================================================================
   CORREÇÃO AUTOMÁTICA (OpenAI): Writing e Speaking
   Variáveis: OPENAI_API_KEY (obrigatória), OPENAI_MODEL (padrão gpt-4o-mini),
              OPENAI_TRANSCRIBE_MODEL (padrão whisper-1)
   ===================================================================== */
// Voz natural para Listening e Speaking (OpenAI TTS). Variável opcional: OPENAI_TTS_MODEL (padrão tts-1).
const VOZES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
async function gerarVoz(body) {
  if (!env('OPENAI_API_KEY')) throw new Error('Vozes de IA desligadas (falta OPENAI_API_KEY)');
  const texto = String(body.texto || '').trim();
  if (!texto || texto.length > 2500) throw new Error('Texto inválido para áudio');
  const voz = VOZES.includes(body.voz) ? body.voz : 'nova';
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env('OPENAI_TTS_MODEL') || 'tts-1', voice: voz, input: texto, response_format: 'mp3', speed: 0.95 }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('Voz: ' + ((j.error && j.error.message) || r.status)); }
  return Buffer.from(await r.arrayBuffer());
}

async function transcrever(body) {
  if (!env('OPENAI_API_KEY')) throw new Error('Correção automática desligada (falta OPENAI_API_KEY)');
  const buf = Buffer.from(String(body.audio || ''), 'base64');
  if (!buf.length) return { texto: '' };
  if (buf.length > 3 * 1024 * 1024) throw new Error('Gravação grande demais');
  const mime = String(body.mime || 'audio/webm').split(';')[0];
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : 'webm';
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), 'resposta.' + ext);
  fd.append('model', env('OPENAI_TRANSCRIBE_MODEL') || 'whisper-1');
  fd.append('language', 'en');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Transcrição: ' + ((j.error && j.error.message) || r.status));
  return { texto: (j.text || '').trim() };
}

// Precisão do Listen and Repeat: maior sequência comum de palavras (LCS) / tamanho da frase.
const palavras = t => String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function precisao(original, ouvido) {
  const a = palavras(original), b = palavras(ouvido);
  if (!a.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const extra = Math.max(0, b.length - a.length);
  return Math.max(0, (dp[a.length][b.length] - extra * 0.5) / a.length);
}
const meia = v => Math.min(6, Math.max(1, Math.round(v * 2) / 2));
const bandaRepeticao = p => p >= 0.97 ? 6 : p >= 0.9 ? 5.5 : p >= 0.82 ? 5 : p >= 0.74 ? 4.5 : p >= 0.65 ? 4 : p >= 0.55 ? 3.5 : p >= 0.45 ? 3 : p >= 0.35 ? 2.5 : p >= 0.25 ? 2 : p >= 0.12 ? 1.5 : 1;

const RUBRICA = `Você é uma avaliadora experiente do TOEFL iBT no formato de 2026 (escala de 1 a 6, em passos de 0,5).
Critérios oficiais resumidos:
- Write an Email: cumpre todas as tarefas pedidas; registro adequado (formal/cordial); organização clara; variedade de estruturas; poucos erros. 6 = muito eficaz e quase sem erros; 5 = eficaz com pequenos lapsos; 4 = adequado, algumas falhas de linguagem ou uma tarefa pouco desenvolvida; 3 = parcialmente eficaz, erros frequentes ou tarefas faltando; 2 = limitado; 1 = mínimo ou fora do tema.
- Write for an Academic Discussion: contribuição relevante e bem elaborada, com opinião clara, explicações e exemplos; uso fluente e preciso da língua. Textos com menos de 60 palavras raramente passam de 3.
- Take an Interview (avaliado pela TRANSCRIÇÃO da fala): resposta relevante à pergunta, desenvolvimento (motivo + exemplo), coerência, gramática e vocabulário. Não penalize pontuação nem maiúsculas (é transcrição automática). Resposta vazia ou muito curta = 1 a 2.
Escreva todos os comentários em português do Brasil, em tom acolhedor e direto, como uma professora para um aluno brasileiro. Corrija só erros reais de inglês.`;

async function avaliarIA(textos, entrevista) {
  const pedido = {
    textos: textos.map(t => ({ tipo: t.nome, enunciado: t.prompt, resposta: t.texto })),
    entrevista: entrevista.map(e => ({ pergunta: e.pergunta, transcricao: e.resposta })),
  };
  const formato = `Responda SOMENTE com JSON neste formato:
{"textos":[{"tipo":"(igual ao recebido)","banda":4.5,"comentario":"2 a 3 frases","correcoes":[{"original":"trecho errado","correto":"forma correta","explicacao":"curta"}]}],
 "entrevista":[{"banda":4,"comentario":"1 a 2 frases"}],
 "dica_writing":"1 frase com a principal coisa a melhorar no Writing (ou vazio)",
 "dica_speaking":"1 frase com a principal coisa a melhorar na entrevista (ou vazio)"}
Máximo de 5 correções por texto. Mantenha a mesma ordem dos itens recebidos.`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env('OPENAI_MODEL') || 'gpt-4o-mini', temperature: 0.2, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: RUBRICA + '\n\n' + formato }, { role: 'user', content: JSON.stringify(pedido) }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Correção: ' + ((j.error && j.error.message) || r.status));
  return JSON.parse(j.choices[0].message.content);
}

async function corrigir(body, sessao) {
  if (!env('OPENAI_API_KEY')) throw new Error('Correção automática desligada (falta OPENAI_API_KEY)');
  const id = String(body.pageId || '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error('Resultado inválido');
  const pg = await notion(`/pages/${id}`);
  const dono = pg.properties && pg.properties['E-mail'] && pg.properties['E-mail'].email;
  if (!dono || dono.toLowerCase() !== sessao.email) throw new Error('Este resultado não é seu');

  const textos = (body.textos || []).slice(0, 4).map(t => ({ nome: cut(t.nome, 80), prompt: cut(t.prompt, 1500), texto: cut(t.texto, 6000) }));
  const repetir = (body.repetir || []).slice(0, 12).map(x => ({ frase: cut(x.frase, 300), ouvido: cut(x.ouvido, 400) }));
  const entrevista = (body.entrevista || []).slice(0, 6).map(x => ({ pergunta: cut(x.pergunta, 400), resposta: cut(x.resposta, 3000) }));
  repetir.forEach(x => { x.precisao = precisao(x.frase, x.ouvido); });

  const ia = (textos.length || entrevista.length) ? await avaliarIA(textos, entrevista) : { textos: [], entrevista: [] };
  const tIA = (ia.textos || []).map((t, i) => ({ ...textos[i], banda: meia(+t.banda || 1), comentario: t.comentario || '', correcoes: (t.correcoes || []).slice(0, 5) }));
  const eIA = (ia.entrevista || []).map((e, i) => ({ ...entrevista[i], banda: meia(+e.banda || 1), comentario: e.comentario || '' }));

  const writing = tIA.length ? meia(tIA.reduce((s, t) => s + t.banda, 0) / tIA.length) : null;
  const precMedia = repetir.length ? repetir.reduce((s, x) => s + x.precisao, 0) / repetir.length : null;
  const bRep = precMedia != null ? bandaRepeticao(precMedia) : null;
  const bEnt = eIA.length ? eIA.reduce((s, e) => s + e.banda, 0) / eIA.length : null;
  const speaking = bRep != null && bEnt != null ? meia(bRep * 0.4 + bEnt * 0.6) : (bRep ?? (bEnt != null ? meia(bEnt) : null));

  const fbW = tIA.length ? ['🤖 Correção automática', ...tIA.map(t => `${t.nome} (${String(t.banda).replace('.', ',')}): ${t.comentario}` + (t.correcoes.length ? '\n' + t.correcoes.map(c => `• "${c.original}" → "${c.correto}" (${c.explicacao})`).join('\n') : '')), ia.dica_writing ? '👉 ' + ia.dica_writing : ''].filter(Boolean).join('\n\n') : '';
  const fbS = (repetir.length || eIA.length) ? ['🤖 Correção automática',
    repetir.length ? `Listen and Repeat: ${Math.round(precMedia * 100)}% de precisão nas frases.` : '',
    ...eIA.map((e, i) => `Pergunta ${i + 1} (${String(e.banda).replace('.', ',')}): ${e.comentario}`),
    ia.dica_speaking ? '👉 ' + ia.dica_speaking : '', 'A IA avalia pela transcrição: pronúncia e entonação são avaliadas pela Denise quando ela revisar.'].filter(Boolean).join('\n\n') : '';

  const props = { 'Correção': { select: { name: 'Corrigido pela IA' } } };
  if (writing != null) { props['Writing'] = { number: writing }; props['Feedback Writing'] = { rich_text: rich(fbW) }; }
  if (speaking != null) { props['Speaking'] = { number: speaking }; props['Feedback Speaking'] = { rich_text: rich(fbS) }; }
  await notion(`/pages/${id}`, 'PATCH', { properties: props });

  const blocos = [bloco('heading_2', '🤖 Correção automática (IA)')];
  tIA.forEach(t => { blocos.push(bloco('heading_3', `${t.nome} · banda ${t.banda}`)); blocos.push(bloco('paragraph', t.comentario)); t.correcoes.forEach(c => blocos.push(bloco('bulleted_list_item', `"${c.original}" → "${c.correto}" — ${c.explicacao}`))); });
  if (repetir.length) { blocos.push(bloco('heading_3', `Listen and Repeat · ${Math.round(precMedia * 100)}% de precisão`)); repetir.forEach(x => blocos.push(bloco('bulleted_list_item', `${Math.round(x.precisao * 100)}% · Frase: "${x.frase}" · Ouvido: "${x.ouvido || '(nada)'}"`))); }
  if (eIA.length) { blocos.push(bloco('heading_3', 'Take an Interview · transcrições')); eIA.forEach((e, i) => { blocos.push(bloco('bulleted_list_item', `P${i + 1} (${e.banda}): ${e.pergunta}`)); blocos.push(bloco('quote', e.resposta || '(sem fala)')); blocos.push(bloco('paragraph', e.comentario)); }); }
  try { await notion(`/blocks/${id}/children`, 'PATCH', { children: blocos.slice(0, 100) }); } catch {}

  return { writing, speaking, textos: tIA, repetir, entrevista: eIA, precisaoRepeticao: precMedia, dicaWriting: ia.dica_writing || '', dicaSpeaking: ia.dica_speaking || '' };
}

/* ---------- roteador ---------- */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const acao = (req.query && req.query.acao) || 'enviar';
  try {
    if (acao === 'config') return res.status(200).json({ googleClientId: env('GOOGLE_CLIENT_ID'), ia: !!env('OPENAI_API_KEY') });

    if (acao === 'setup') {
      if (!env('SETUP_KEY') || req.query.chave !== env('SETUP_KEY')) return res.status(403).json({ error: 'Chave de setup incorreta' });
      if (env('TOEFL_ALUNOS_DB') && req.query.forcar !== '1') return res.status(400).json({ error: 'As bases já estão configuradas (TOEFL_ALUNOS_DB existe). Use &forcar=1 para criar outras.' });
      if (!env('NOTION_PARENT_PAGE')) return res.status(400).json({ error: 'Falta NOTION_PARENT_PAGE' });
      return res.status(200).json(await setup());
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (acao === 'login') return res.status(200).json(await login(body));

    const sessao = lerSessao(body.token);
    if (!sessao) return res.status(401).json({ error: 'Sessão expirada. Entre de novo com o Google.' });
    if (acao === 'enviar') return res.status(200).json(await enviar(body, sessao));
    if (acao === 'voz') {
      const audio = await gerarVoz(body);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=31536000');
      return res.status(200).end(audio);
    }
    if (acao === 'transcrever') return res.status(200).json(await transcrever(body));
    if (acao === 'corrigir') return res.status(200).json(await corrigir(body, sessao));
    if (acao === 'painel' || acao === 'cadastrar') {
      if (!sessao.professora) return res.status(403).json({ error: 'Área exclusiva da professora' });
      return res.status(200).json(acao === 'painel' ? await painel() : await cadastrar(body));
    }
    if (acao === 'detalhe') return res.status(200).json(await detalhe(body, sessao));
    if (acao === 'historico') {
      const [itens, perfil] = await Promise.all([historico(sessao), perfilAluno(sessao)]);
      return res.status(200).json({ itens, perfil });
    }
    return res.status(404).json({ error: 'Ação desconhecida' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
