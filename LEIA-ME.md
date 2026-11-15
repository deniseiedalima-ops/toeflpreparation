# Plataforma TOEFL iBT · English With Denise

Formato oficial do TOEFL iBT desde 21/01/2026: Reading (30 min, adaptativo) → Listening (29 min, adaptativo) → Writing (23 min) → Speaking (≈ 8 min), com notas de 1 a 6.
Cada aluno entra com a própria conta Google, e tudo fica registrado no Notion.

## Arquivos

```
toefl/index.html   ← a plataforma
api/toefl.js       ← login Google + Notion
vercel.json        ← faz o endereço principal abrir a plataforma
```

Suba os três no repositório `toeflpreparation`, substituindo os antigos.

---

## Configuração (uma vez só, uns 15 minutos)

### 1. Google: autorizar o domínio novo
1. Acesse console.cloud.google.com → o mesmo projeto do login do app English With Denise → **APIs e serviços → Credenciais**.
2. Abra o **ID do cliente OAuth** que você já usa.
3. Em **Origens JavaScript autorizadas**, clique em **Adicionar URI** e cole: `https://toeflpreparation.vercel.app`
4. Salve e copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).

### 2. Notion: criar a página onde as bases vão morar
1. Crie uma página chamada **Plataforma TOEFL**.
2. Menu **•••** → **Conexões** → adicione a mesma integração da TEAP.
3. Copie o link da página. O ID são os 32 caracteres do final do link.

### 3. Vercel: variáveis de ambiente
No projeto `toeflpreparation`, vá em **Settings → Environment Variables** e adicione:

| Nome | Valor |
|---|---|
| `NOTION_TOKEN` | o mesmo token da TEAP |
| `GOOGLE_CLIENT_ID` | o ID do cliente do passo 1 |
| `SESSION_SECRET` | uma frase longa inventada, ex.: `cafe-com-leite-toefl-2026-denise` |
| `SETUP_KEY` | uma senha qualquer, só para o passo 4 |
| `NOTION_PARENT_PAGE` | o ID da página do passo 2 |

Depois disso: **Deployments → ••• → Redeploy**.

### 4. Criar as bases no Notion (automático)
Abra no navegador, trocando `SUASENHA` pela sua `SETUP_KEY`:

`https://toeflpreparation.vercel.app/api/toefl?acao=setup&chave=SUASENHA`

As duas bases aparecem dentro da página **Plataforma TOEFL**, e a tela mostra dois IDs. Volte na Vercel, adicione as variáveis abaixo e faça **Redeploy** de novo:

| Nome | Valor |
|---|---|
| `TOEFL_ALUNOS_DB` | o ID que apareceu em `TOEFL_ALUNOS_DB` |
| `TOEFL_RESULTADOS_DB` | o ID que apareceu em `TOEFL_RESULTADOS_DB` |

### 5. Testar
Abra https://toeflpreparation.vercel.app, entre com o seu Gmail e faça um simulado Demo. Confira se você aparece em **TOEFL Alunos** e o resultado em **TOEFL Resultados**.

---

## As bases no Notion

### 🎓 TOEFL Alunos (uma linha por aluno, criada no primeiro login)
- **Preenchidas sozinhas:** Aluno, E-mail, Foto, Google ID, Primeiro acesso, Último acesso, Acessos.
- **Calculadas a partir dos resultados:** Simulados feitos, Melhor geral, Melhor Reading, Melhor Listening, Último simulado, Para corrigir.
- **Você preenche:** Status (Ativo / Pendente / Bloqueado), Turma, Meta (banda), Data da prova, Observações.

### 📊 TOEFL Resultados (uma linha por simulado feito)
- **Preenchidas sozinhas:** aluno (ligado à base de alunos), simulado, tipo, data e hora, bandas de Reading e Listening, geral estimado, módulo 2 (difícil/fácil), acertos, % das objetivas, pontos fracos (tipos de tarefa abaixo de 60%), palavras do e-mail e da discussão, duração e link da gravação.
- **Dentro de cada página:** os erros, o texto completo do e-mail e da discussão e as gravações do Speaking.
- **Você preenche ao corrigir:** Writing, Speaking, Feedback e Correção → **Corrigido**.
- **Nota final:** calculada sozinha com as seções que já têm nota, arredondada a 0,5. As notas de Writing e Speaking que você lançar aparecem para o aluno na aba **Meu desempenho**.

**Visualizações que valem a pena criar** (o Notion não deixa criar por fora):
- Em Resultados, um quadro agrupado por **Correção**, para ver a fila do que falta corrigir.
- Em Resultados, uma tabela agrupada por **Aluno**.
- Em Alunos, uma galeria com a **Foto**.

### Acesso só para quem você liberar (opcional)
Adicione `ACESSO_RESTRITO` = `1` na Vercel. A partir daí, quem entrar pela primeira vez fica como **Pendente** em TOEFL Alunos e só usa a plataforma depois que você mudar para **Ativo**. Mudar para **Bloqueado** tira o acesso.

### Gravações do Speaking direto no Notion (opcional)
No Cloudinary, crie um *upload preset* do tipo **Unsigned** e preencha no topo do `toefl/index.html`:
```js
const CLOUDINARY_CLOUD = 'seu-cloud-name';
const CLOUDINARY_PRESET = 'nome-do-preset';
```
Sem isso, o aluno ouve e baixa as gravações no resultado para mandar pelo WhatsApp.

---

## Ajustes rápidos (topo do `toefl/index.html`)
- `OUVIR_MAX`: quantas vezes cada áudio pode ser ouvido (2x por habilidade, 1x no completo).
- `CORTE_ADAPTATIVO`: acerto mínimo no módulo 1 para ir ao módulo 2 difícil (60%).
- `SECOES`: tempos de cada seção.

## Conteúdo
Já prontos: **Reading 1, Listening 1, Writing 1, Speaking 1** e o **Simulado Completo 1** (que usa esses quatro).
Os espaços R2–R4, L2–L4, W2–W4, S2–S4 e C2–C4 aparecem como "Em breve" até receberem conteúdo.

Como cada tarefa é escrita no código (para referência):
- *Complete the Words*: as letras que faltam vão entre chaves → `bu{{ilt}}` aparece como "bu___" e a resposta é "ilt".
- *Read in Daily Life / Academic Passage*: texto + perguntas (4 alternativas). Uma palavra entre `[[ ]]` aparece destacada (para perguntas de vocabulário). Parágrafos são separados por uma linha em branco.
- *Listening*: `transcricao` (o texto que você grava) + `audio` (link do MP3 gravado). Sem link, o navegador lê a transcrição.
- *Build a Sentence*: `modelo` com `_` em cada lacuna e as palavras fixas no lugar (ex.: `'Yes, _ _ _ _ on the top shelf.'`), `opcoes` (os blocos, incluindo 1 distrator) e `resposta` (os blocos na ordem certa).
- *Listen and Repeat*: `cenario`, 7 `frases` com o tempo de resposta de cada uma, e `imagem` (link de uma ilustração, opcional).
- *Take an Interview*: `contexto` + 4 `perguntas`, 45 s cada.

As alternativas são embaralhadas a cada tentativa.

## Sobre a nota
Reading e Listening ganham uma nota **estimada** de 1 a 6 pelos acertos. Quem cai no módulo 2 fácil fica limitado a 4,0. Isso é uma aproximação, não a tabela oficial da ETS. Writing e Speaking ficam com a sua correção.
