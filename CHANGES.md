# CHANGES — v15.6 (scoring automático com Gemini + cron horário)

Novas features de scoring sobrepostas à v15:

- **Score na criação**: empresa nova ou associado novo → backend dispara
  matches Gemini em background. Matches já vêm com score Gemini, não com
  o algoritmo local (50 base).
- **Score na edição**: editar campos relevantes (`setor`, `tipo`, `descricao`,
  `necessidades`, `produtosOferecidos`, `produtosDemandados`, `segmento`,
  `servicos`, `categorias`) → recalcula scores de **todos os matches PENDING**
  daquela entidade via Gemini. Não bloqueia a resposta da API.
- **Cron horário**: cron task roda em `0 * * * *` (toda hora cheia, configurável
  via `SCORE_CRON_PATTERN`) recalculando todos os matches PENDING globalmente.
- **Imutabilidade preservada**: matches em `CONTACTED`/`INTERESTED`/`CONFIRMED`/
  `REJECTED` **nunca** são tocados por nenhum desses fluxos. Regra v15 mantida.

## Endpoints novos

| Endpoint | Descrição |
|---|---|
| `POST /api/ai/recalcular-scores` | Dispara recalculo manual (admin). Body opcional `{empresaId}` ou `{associadoId}`. |
| `GET /api/ai/cron-status` | Estado do cron (admin). |

## Variáveis de ambiente novas

| Var | Default | Descrição |
|---|---|---|
| `SCORE_CRON_ENABLED` | `true` | Liga/desliga o cron horário. |
| `SCORE_CRON_PATTERN` | `0 * * * *` | Cron pattern padrão (hora cheia). |

## Arquivos novos

- `backend/src/services/scoringService.js` — recalculo Gemini de pares.
- `backend/src/services/scoringCron.js` — cron task com `node-cron`.

## Dependência nova

- `node-cron@^3.0.3` adicionada em `backend/package.json`.

---



Esta versão refatora o fluxo de geração e contato dos matches. Antes, ao
clicar em "Gerar Match IA", o sistema disparava o HSM em paralelo para
empresa **e** associado (ou para os dois associados num par B2B). Agora,
o contato é **sequencial e condicional**: a IA só contata a segunda parte
depois que a primeira aceitar.

Baseline: v14.17. Nada da v14 foi removido — apenas refinado.
Histórico da v14 está preservado em `CHANGES_v14.md`.

---

## 🎯 Fluxo de match (handshake 2 etapas)

### Assoc × Empresa

| Etapa | Ação | Status do `Match` |
|---|---|---|
| Admin clica "Gerar Match IA" | cria match | `PENDING` |
| Sistema dispara HSM `hsmbra` → **só pro Associado** | aguarda | `CONTACTED` |
| Associado responde "interesse" no WhatsApp | sistema dispara `hsmbrac` **pra Empresa** automaticamente | `INTERESTED` |
| Empresa responde "interesse" | match fechado | `CONFIRMED` |
| Qualquer um rejeita em qualquer etapa | cadeia interrompida | `REJECTED` |

### Assoc × Assoc (B2B)

Mesmo fluxo, com o associado de **menor ID** (Origem) recebendo o `hsmbra`
primeiro, e o de **maior ID** (Destino) recebendo o `hsmbrac` apenas
quando a Origem aceitar. A convenção `origem < destino` já existia no
schema desde a v14 e foi reaproveitada.

### Anti-duplicação

Uma vez que um par `(empresa, associado)` ou `(origem, destino)` já existe
no banco — **independente do status** — o "Gerar Matches" pula totalmente.
Não atualiza score, não re-dispara HSM, não muda nada. Para regenerar de
fato, é preciso deletar o match antes (ou zerar o banco via seed).

---

## 📨 Templates HSM (Meta WhatsApp)

Os textos foram atualizados para os fornecidos pelo cliente. Centralizados
em `backend/src/services/hsmTemplates.js`. Nomes dos templates aprovados
na Meta são configuráveis via env vars:

- `HSM_TEMPLATE_INICIO` (default: `hsmbra`) — primeiro contato
- `HSM_TEMPLATE_AVANCO` (default: `hsmbrac`) — segundo contato (após aceite)
- `HSM_TEMPLATE_LANGUAGE` (default: `pt_BR`)

Parâmetros nomeados (Meta Cloud API v17+): `{{nome}}`, `{{segmento}}`,
`{{produtos_servico}}`. Se o template não estiver aprovado ainda na Meta,
o sistema cai em **fallback de texto livre** (válido apenas dentro da
janela de 24h da Meta) usando o texto exato definido no `hsmTemplates.js`.

### Texto do `hsmbra` (início)

> Olá, {{nome}}, tudo bem? Identificamos que a sua empresa atua com
> {{segmento}} e pode ter sinergia com oportunidades ativas dentro da
> nossa rede, especialmente relacionadas a {{produtos_servico}}. Temos
> empresas buscando exatamente esse tipo de solução e acreditamos que
> pode haver um fit interessante para geração de negócios. Faz sentido
> avaliarmos uma conexão rápida para explorar essa oportunidade?

### Texto do `hsmbrac` (avanço)

> Olá, {{nome}}, tudo bem? Temos uma novidade. Encontramos uma empresa
> dentro da nossa rede com forte aderência ao que você busca em
> {{segmento}}. Ela demonstrou interesse em se conectar com você para
> explorar oportunidades relacionadas a {{produtos_servico}}. Faz sentido
> avançarmos com essa conexão? Se sim, posso organizar uma introdução
> rápida entre vocês 🤝

---

## Backend

### `services/hsmTemplates.js` (NOVO)
Centraliza nomes de templates, textos e helper de renderização com
parâmetros nomeados. Substitui o hardcoding que estava espalhado.

### `services/whatsappService.js` — REFATORADO

- **`buscarMatchesPendentes(tipo, id)`**: agora retorna estrutura unificada
  com `matchType` (`'match'` | `'matchB2B'`), `etapa`
  (`'aguardando_primeiro'` | `'aguardando_segundo'`) e `outraParte` já
  resolvida. Suporta tanto matches Assoc × Empresa quanto B2B.

- **Handlers refatorados** (`apresentarMatch`, `handleRespostaMatch`,
  `mostrarDetalhes`, `handleConfirmacao`, `rejeitarMatch`): trabalham com
  a nova estrutura unificada. Lógica de transição de status agora vive
  em duas funções dedicadas:
  - `processarPrimeiraConfirmacao`: PENDING/CONTACTED → INTERESTED +
    dispara `hsmbrac` automaticamente para a outra parte.
  - `processarSegundaConfirmacao`: INTERESTED → CONFIRMED.

- **`sendHSMInicio(to, nome, segmento, produto)`** (NOVO): envia o
  template de início (`hsmbra`).
- **`sendHSMAvanco(to, nome, segmento, produto)`** (NOVO): envia o
  template de avanço (`hsmbrac`).
- **`sendHSMBra1`**: mantido como **alias** de `sendHSMInicio` para
  retrocompatibilidade. Pode ser removido em versões futuras.

- **`sendMatchHSMBulk(matchIds)`** — COMPORTAMENTO ALTERADO: agora envia
  o `hsmbra` **APENAS** para o associado de cada match (antes enviava em
  paralelo para empresa **e** associado). Pula matches que não estão em
  `PENDING` (anti-duplicação). Atualiza status para `CONTACTED` após
  envio bem-sucedido.

- **`sendMatchB2BHSMBulk(matchB2BIds)`** (NOVO): envia o `hsmbra`
  **APENAS** para o `associadoOrigem` (menor ID) de cada par B2B.
  Mesma lógica de anti-duplicação.

### `controllers/webhookController.js`
- `sendHSM` (POST `/api/whatsapp/send-hsm`): chama `sendHSMInicio` em vez
  de `sendHSMBra1` (na prática é o mesmo, mas o nome é mais explícito).
- `sendHSMMatches` (POST `/api/whatsapp/send-hsm-matches`): retorna
  `skipped` separado de `failed` para que o frontend mostre mensagem
  diferente quando o motivo é anti-duplicação.
- `sendHSMMatchesB2B` (POST `/api/whatsapp/send-hsm-matches-b2b`)
  (NOVO): equivalente B2B do anterior.
- `getStatus` (GET `/api/whatsapp/status`): expõe os dois nomes de
  template (`inicio` e `avanco`) em vez do antigo `hsmTemplate` único.

### `controllers/aiController.js`
- `gerarMatchesInteligentes`: **regra v15** — se um match `(empresa,
  associado)` já existe no banco, pula totalmente. Não atualiza score,
  não dispara HSM, não muda nada (mesmo se o status for PENDING).
  Antes só pulava status ≠ PENDING. Retorna campo `preservados` na
  resposta.
- `gerarMatchesB2B`: já fazia skip se par já existia desde a v14
  — mantido sem mudança.

### `controllers/matchController.js`
- `create` — refatorado para ser **idempotente**:
  - Se o par já existe e `status !== 'PENDING'` → retorna existente sem
    modificar (matches "tratados" são imutáveis via esse endpoint).
  - Se já existe em `PENDING` → atualiza apenas `score`, `produto`,
    `prioridade`, `observacoes` (não toca `status`).
  - Se não existe → cria novo `PENDING`.
- Antes: usava `prisma.match.upsert()` que sobrescrevia tudo
  indiscriminadamente.

### `routes/index.js`
- Nova rota: `POST /api/whatsapp/send-hsm-matches-b2b`.

---

## Frontend (`frontend/src/bratecc-connect-ai.jsx`)

Os textos das telas foram atualizados para descrever o handshake. Não
houve mudança estrutural nos componentes.

### `MatchesPage` (Assoc × Empresa)
- Mensagem de feedback após "Gerar Matches": agora explica que o `hsmbra`
  foi enviado para os associados e que as empresas serão contatadas
  automaticamente quando os associados responderem.
- `handleSendWhatsApp` (envio individual por linha): sempre dispara o
  HSM apenas para o associado, mesmo no fallback. O fluxo antigo
  permitia mandar pra empresa direto se ela tivesse telefone — isso
  quebrava o handshake.
- Rodapé da tabela: rótulo do HSM atualizado para indicar o fluxo de 2
  etapas (`hsmbra` início → `hsmbrac` avanço após aceite).

### `B2BPage` (Assoc × Assoc)
- `handleGenerateMatches` agora chama o backend explicitamente:
  - `POST /api/ai/matches-b2b` para gerar os pares no banco
  - `POST /api/whatsapp/send-hsm-matches-b2b` para disparar o `hsmbra` só
    pro associado de origem
  - Antes, esse handler chamava só `onRegenerateMatches()` que não
    persistia matches B2B no banco (lógica era 100% local/client-side).
- `handleSendWhatsApp` (envio individual): mesma mudança — usa o endpoint
  específico de B2B em vez de `/whatsapp/send-hsm` direto.

### `regenerateAllMatches` (handler global de "regerar tudo")
- Fallbacks atualizados: quando o endpoint em lote falha, o envio direto
  individual agora vai para o **associado** (não para a empresa).
- Mensagem de log: `hsmbra` em vez de `hsmbra1`.

---

## 🧪 Como testar o handshake

### Opção A — Banco zerado (sem dados demo)

Recomendado se você quer cadastrar tudo manualmente para teste:

```bash
docker compose down -v
RUN_DB_SEED=minimal docker compose up -d --build
```

Resultado: banco totalmente vazio, exceto pelo usuário admin
(`admin@bratecc.com` / `admin123` — configurável via `ADMIN_EMAIL` /
`ADMIN_PASSWORD` no env). Nenhum associado, empresa, evento ou match.

Faça login na interface e cadastre os dados de teste manualmente.

### Opção B — Banco populado com dados demo

```bash
docker compose down -v
RUN_DB_SEED=1 docker compose up -d --build
```

Cria 6 usuários (1 admin + 5 associados), associados, empresas, eventos
e alguns matches de exemplo. Útil pra ver o sistema funcionando "out of
the box".

### Comum aos dois modos

1. Aguarde ~30s. Logs do backend devem mostrar `🌱 RUN_DB_SEED=...
   executando seed...`.

2. **Configurar WhatsApp** no `.env` (ou via env do compose):
   ```
   META_WHATSAPP_TOKEN=...
   WHATSAPP_LINE_ID=...
   META_VERIFY_TOKEN=bratecc-verify-token-2026
   HSM_TEMPLATE_INICIO=hsmbra
   HSM_TEMPLATE_AVANCO=hsmbrac
   ```

3. **Cadastrar templates na Meta** (Business Manager → WhatsApp → Templates):
   - Nome: `hsmbra`, idioma: `pt_BR`, body com 3 parâmetros nomeados
     (`nome`, `segmento`, `produtos_servico`) e o texto da seção
     "Texto do `hsmbra`" deste arquivo.
   - Nome: `hsmbrac`, idem com o texto do `hsmbrac`.

4. **Login** como admin (`admin@bratecc.com` / `admin123`).

5. **Testar Assoc × Empresa**:
   - Garanta que pelo menos 1 associado tem `whatsapp` cadastrado e que
     a empresa tem `telefone`.
   - Vá em "Assoc × Empresa" → "Gerar Matches".
   - O associado recebe o `hsmbra` no WhatsApp.
   - Status do match no banco vira `CONTACTED`.
   - Associado responde "sim" / "tenho interesse" no WhatsApp.
   - O bot pergunta se confirma. Associado confirma.
   - Status vira `INTERESTED`. A empresa recebe o `hsmbrac` automaticamente.
   - Empresa responde "sim". Status vira `CONFIRMED`. Match fechado.

6. **Testar Assoc × Assoc**:
   - Idem, mas tela "Assoc × Assoc". O associado de menor ID recebe o
     `hsmbra` primeiro; o de maior ID recebe o `hsmbrac` quando o
     primeiro aceitar.

7. **Testar anti-duplicação**:
   - Clique "Gerar Matches" novamente sem zerar o banco. Resultado: o
     contador `preservados` aparece nos logs e nenhum HSM é re-enviado.
   - Tente também via API: `POST /api/ai/matches/:empresaId` →
     resposta tem `totalMatches: 0, preservados: N`.

8. **Verificar logs**: `docker compose logs -f backend` mostra cada
   transição de status com a etapa indicada.

### Com a aplicação já rodando — limpar/popular sem rebuild

```bash
make seed-minimal   # apaga tudo, mantém só admin
make seed           # apaga tudo + popula com dados demo
```

---

## ⚠️ Observações sobre fallback de texto livre

O `hsmTemplates.js` tem um **fallback de texto livre** que é acionado
quando o template não está aprovado na Meta (ou quando aprova falha).
Esse fallback **só funciona dentro da janela de 24h** após o usuário ter
mandado a primeira mensagem para o número Business — fora dessa janela,
a Meta bloqueia mensagens livres e exige template aprovado.

Em produção, garanta que `hsmbra` e `hsmbrac` estão aprovados na Meta.
Em desenvolvimento, peça pro destinatário mandar uma mensagem qualquer
para o número Business antes de testar (isso abre a janela de 24h).

---

## 🔧 Variáveis de ambiente novas

| Variável | Default | Descrição |
|---|---|---|
| `HSM_TEMPLATE_INICIO` | `hsmbra` | Nome do template aprovado para o 1º contato |
| `HSM_TEMPLATE_AVANCO` | `hsmbrac` | Nome do template aprovado para o 2º contato |
| `HSM_TEMPLATE_LANGUAGE` | `pt_BR` | Código de idioma dos templates na Meta |

Já estão refletidas em `.env.example`.
