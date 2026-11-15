// Recebe o resultado da Plataforma TOEFL (toefl/index.html) e grava no Notion.
// Variáveis de ambiente na Vercel: NOTION_TOKEN e TOEFL_RESULTADOS_DB.

const NOTION_API = 'https://api.notion.com/v1';
const nHeaders = () => ({
  Authorization: `Bearer ${process.env.NOTION_TOKEN || process.env.REACT_APP_NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});

const NOMES = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking' };
const txt = s => String(s ?? '').slice(0, 1990);
const rich = s => [{ text: { content: txt(s) } }];

// Notion aceita no máximo 2000 caracteres por bloco: quebra textos longos.
function paragrafos(texto) {
  const out = []; const s = String(texto || '');
  for (let i = 0; i < s.length; i += 1900) out.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(s.slice(i, i + 1900)) } });
  return out.length ? out : [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rich('(em branco)') } }];
}
const h2 = t => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(t) } });
const h3 = t => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich(t) } });
const item = t => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(t) } });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { aluno, simulado, modo, geral, secoes = {} } = body;
    if (!aluno || !simulado) return res.status(400).json({ error: 'Missing fields' });
    if (!process.env.TOEFL_RESULTADOS_DB) return res.status(500).json({ error: 'TOEFL_RESULTADOS_DB not set' });

    const tipo = modo === 'completo' ? 'Completo' : (NOMES[Object.keys(secoes)[0]] || 'Completo');
    const num = v => (v == null ? null : Number(v));
    const objetivas = Object.values(secoes).filter(s => s.total).map(s => `${s.acertos}/${s.total}`).join(' · ');

    const children = [];
    for (const [k, s] of Object.entries(secoes)) {
      children.push(h2(`${NOMES[k]} — ${s.titulo}` + (s.banda != null ? ` · banda ${s.banda}` : '')));
      if (s.caminho && s.caminho !== 'base') children.push(item(`Módulo 2: ${s.caminho === 'dificil' ? 'difícil' : 'fácil'}`));
      Object.entries(s.porTipo || {}).forEach(([n, v]) => children.push(item(`${n}: ${v.a}/${v.t}`)));
      if ((s.erros || []).length) { children.push(h3('Erros')); s.erros.slice(0, 40).forEach(e => children.push(item(e))); }
      (s.textos || []).forEach(t => { children.push(h3(`${t.nome} (${t.palavras} palavras)`)); children.push(...paragrafos('Prompt: ' + t.prompt)); children.push(...paragrafos(t.texto)); });
      if ((s.gravacoes || []).length) {
        children.push(h3('Gravações'));
        s.gravacoes.forEach(g => children.push(item(`${g.nome} — "${g.prompt}" → ${g.url || 'sem link (aluno deve enviar o arquivo)'}`)));
      }
    }

    const r = await fetch(`${NOTION_API}/pages`, {
      method: 'POST', headers: nHeaders(),
      body: JSON.stringify({
        parent: { database_id: process.env.TOEFL_RESULTADOS_DB },
        properties: {
          'Aluno': { title: rich(aluno) },
          'Simulado': { rich_text: rich(simulado) },
          'Tipo': { select: { name: tipo } },
          'Data': { date: { start: new Date().toISOString().slice(0, 10) } },
          'Reading': { number: num(secoes.reading && secoes.reading.banda) },
          'Listening': { number: num(secoes.listening && secoes.listening.banda) },
          'Geral parcial': { number: modo === 'completo' ? num(geral) : null },
          'Acertos': { rich_text: rich(objetivas || '—') },
          'Corrigido': { checkbox: false },
        },
        children: children.slice(0, 100),
      }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(500).json({ error: e.message || 'Notion error' }); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
