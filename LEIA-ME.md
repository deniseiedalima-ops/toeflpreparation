# Plataforma TOEFL iBT · English With Denise

Formato oficial do TOEFL iBT desde 21/01/2026: Reading (30 min, adaptativo) → Listening (29 min, adaptativo) → Writing (23 min) → Speaking (≈ 8 min), com notas de 1 a 6.

## O que tem neste ZIP

```
toefl/index.html   ← a plataforma (o link que os alunos abrem)
api/toefl.js       ← grava os resultados no Notion
```

Nenhum dos dois substitui arquivos que já estão no seu repositório.

## Como subir (no repositório que você já tem)

1. No GitHub, abra o repositório → **Add file → Upload files** → arraste a pasta `toefl` e a pasta `api` deste ZIP → **Commit**.
   (Se o repositório já tem uma pasta `api`, o GitHub só acrescenta o `toefl.js` lá dentro.)
2. A Vercel publica sozinha. O link dos alunos fica assim: **https://SEU-DOMINIO.vercel.app/toefl/**

## Criar a base de resultados no Notion (uma vez só)

1. No Notion, crie uma base (tabela) chamada **TOEFL Resultados** com estas colunas, exatamente com estes nomes:

| Coluna | Tipo |
|---|---|
| Aluno | Título (já vem criada; é só renomear "Name") |
| Simulado | Texto |
| Tipo | Seleção |
| Data | Data |
| Reading | Número |
| Listening | Número |
| Geral parcial | Número |
| Acertos | Texto |
| Corrigido | Caixa de seleção |

2. Menu **•••** da base → **Conexões** → adicione a mesma integração que a TEAP usa.
3. Copie o ID da base: é o trecho de 32 caracteres do link, antes do `?v=`.
4. Na Vercel → seu projeto → **Settings → Environment Variables**, adicione:
   - `TOEFL_RESULTADOS_DB` = o ID copiado
   - `NOTION_TOKEN` (se ainda não existir nesse projeto) = o mesmo token da TEAP
5. **Deployments → Redeploy**, para a variável nova valer.

Cada resultado vira uma página na base. Os textos de Writing (e-mail e discussão) e os erros de cada seção ficam dentro da página. A caixa **Corrigido** é para você marcar quando terminar de corrigir Writing e Speaking.

### Gravações do Speaking (opcional)
Sem configuração nenhuma, o aluno ouve as próprias gravações no resultado e pode baixá-las para mandar pelo WhatsApp.
Para receber o link de cada gravação direto no Notion, crie no Cloudinary um *upload preset* do tipo **Unsigned** e preencha no topo do `toefl/index.html`:
```js
const CLOUDINARY_CLOUD = 'seu-cloud-name';
const CLOUDINARY_PRESET = 'nome-do-preset';
```

## Ajustes rápidos (topo do `toefl/index.html`)

- `OUVIR_MAX`: quantas vezes cada áudio pode ser ouvido (hoje: 2x nos simulados por habilidade, 1x no completo, como na prova).
- `CORTE_ADAPTATIVO`: acerto mínimo no módulo 1 para ir ao módulo 2 difícil (hoje 60%).
- `SECOES`: tempos de cada seção.

## Como o conteúdo entra

Você me manda o conteúdo colado no chat e eu encaixo nos espaços. Para referência, é assim que cada tarefa fica no código:

**Reading** (módulos `base`, `dificil` e `facil`):
- *Complete the Words*: palavra completa e o pedaço que falta → `fr{{om|om}}` mostra "fr___" e a resposta é "om".
- *Read in Daily Life* e *Read an Academic Passage*: título, texto e perguntas de 4 alternativas com a letra correta.

**Listening** (mesmos módulos): link do áudio que você gravou + transcrição + perguntas.
- *Listen and Choose a Response*: 1 fala e 4 respostas possíveis.
- *Conversation*, *Announcement* e *Academic Talk*: áudio e perguntas.
- Enquanto não houver áudio, o navegador lê a transcrição em voz alta. Serve para testar, mas a sua gravação fica bem melhor.

**Writing**:
- *Build a Sentence*: fala da pessoa A, palavra inicial fixa (opcional), palavras embaralhadas e a frase correta.
- *Write an Email*: situação, os 3 pontos que o e-mail precisa cobrir e o destinatário (7 min).
- *Academic Discussion*: pergunta do professor e posts de 2 alunos (10 min).

**Speaking**:
- *Listen and Repeat*: frase (áudio ou texto) e segundos para repetir.
- *Take an Interview*: contexto e perguntas, com 45 s para cada resposta.

**Simulados completos**: cada um aponta para um simulado de cada seção (ex.: `reading: 'R4', listening: 'L4', writing: 'W4', speaking: 'S4'`). Ele só aparece liberado quando as 4 seções têm conteúdo.

Os itens **Demo** (R0, L0, W0, S0 e C0) servem só de exemplo. Peça para eu tirar quando quiser.

## Sobre a nota

Reading e Listening ganham uma nota **estimada** de 1 a 6 pelo percentual de acertos. Quem cai no módulo 2 fácil fica limitado a 4,0, como acontece na prova adaptativa. Isso é uma aproximação, não a tabela oficial da ETS. Writing (e-mail e discussão) e Speaking ficam para a sua correção.
