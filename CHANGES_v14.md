# CHANGES — v14 (correções de CRUD, schema e relacionamentos)

Esta versão consolida 13 correções em três camadas (backend, frontend, schema),
sobre o baseline da v13. Todas as regressões da v12 foram reaplicadas.

## 🔐 ATENÇÃO DE SEGURANÇA

O ZIP anterior (v13) continha `.env` com a chave Gemini exposta em texto claro
(`AIzaSyBjrG5bK9Ymbx4wlOBJ9v9pwkO9Lmqt0HU`). **Revogue essa chave no Google AI
Studio e gere uma nova.** Este pacote já não inclui `.env` — apenas `.env.example`.
O `.gitignore` foi reforçado para nunca mais commitar `.env` por engano.

---

## Backend — Controllers

### empresaController.js
- **`update`**: agora atualiza `porte`, `produtosOferecidos`, `produtosDemandados`
  (campos adicionados ao schema na v13, mas ignorados pelo update — eram
  permanentemente não-editáveis).
- **`createMany`**: bulk import agora também preenche os 3 campos novos.
- **`remove`**: agora usa `$transaction` e limpa `MatchEvento` órfãos antes de
  deletar a empresa (MatchEvento tem IDs soltos sem FK no schema — sem este
  cleanup, registros ficavam apontando para empresas inexistentes).

### associadoController.js
- **`remove`**: corrigido bug de ordem (tentava deletar `user` antes do
  `associado`, causando FK violation quando `onDelete: SetNull` não tinha sido
  aplicado ainda). Agora usa `$transaction`: deleta MatchEvento órfãos →
  deleta associado → deleta user (se existir). Ordem atômica e segura.
- **`createMany`** (NOVO): bulk import de associados, com suporte opcional a
  criação de `User` vinculado (`criarUsuario: true` + `senha`). Simetria com
  `empresaController.createMany`.

### eventoController.js
- **`toggleStatus`**: agora respeita estados terminais. Eventos em
  `FINALIZADO` ou `CANCELADO` retornam 400 com mensagem clara (antes podiam
  ser re-abertos por toggle, o que não fazia sentido). ActivityLog agora
  registra `from` e `to`.
- **`addParticipante`** / **`addAssociado`**: agora geram ActivityLog
  (antes só os outros métodos geravam — quebrava auditoria).
- **`removeParticipante`** (NOVO): `DELETE /eventos/:id/participantes/:empresaId`.
  Remove participação + limpa MatchEvento relacionado à empresa neste evento.
- **`removeAssociado`** (NOVO): `DELETE /eventos/:id/associados/:associadoId`.
  Remove vínculo + limpa MatchEvento relacionado ao associado neste evento.

### aiController.js (em `gerarMatchesB2B`)
- **Normalização bidirecional de par**: antes de criar `MatchB2B`, normaliza
  o par para que `associadoOrigem < associadoDestino`. Isso, combinado com o
  novo CHECK constraint no banco, impede que a sinergia `(A, B)` e `(B, A)`
  coexistam como dois registros distintos. Serviços origem/destino também
  são trocados junto. Auto-matches (origem == destino) são pulados.

---

## Backend — Rotas (`src/routes/index.js`)

Novos endpoints:
- `POST /api/associados/import`
- `DELETE /api/eventos/:id/participantes/:empresaId`
- `DELETE /api/eventos/:id/associados/:associadoId`

Todos protegidos por `authMiddleware + adminMiddleware`.

---

## Schema / Banco

### `prisma/schema.prisma`
- **`MatchB2B`**: comentário reforçando a convenção bidirecional
  (origem sempre < destino). A garantia forte vem da migration SQL abaixo.

### `prisma/migrations/manual_matchb2b_check.sql` (NOVO)
Migration SQL manual que:
1. Normaliza registros existentes (se origem > destino, troca com destino)
2. Remove duplicatas que surgirem da normalização (mantém o id maior)
3. Adiciona `CHECK ("associadoOrigem" < "associadoDestino")` na tabela

**Como aplicar**:
```bash
psql -U usuario -d bratecc_db -f backend/prisma/migrations/manual_matchb2b_check.sql
```

### MatchEvento — limpeza manual (workaround)
`MatchEvento.entidade1Id` e `entidade2Id` são `Int` soltos (sem FK/@relation),
então o Prisma não faz cascade automático quando a empresa/associado
referenciado é deletado. Como paliativo, os controllers `remove` de empresa,
associado, participante e associado-do-evento agora fazem `deleteMany` manual
nos `MatchEvento` afetados, dentro de transaction.

**Fix definitivo futuro** (não aplicado aqui): refatorar `MatchEvento` para ter
duas FKs explícitas (`empresaId` / `associadoId` nullable) em vez dos IDs
polimórficos — isso requer migration de dados e refactor do aiService.

---

## Frontend (`frontend/src/bratecc-connect-ai.jsx`)

- **`API_URL`**: agora vem de `import.meta.env.VITE_API_URL` (com fallback
  para localhost). Permite build de produção apontando pro backend real.
- **Token em localStorage** (`TOKEN_KEY = "bratecc_jwt"`): persiste entre
  sessões. F5 não desloga mais. Getter/setter reativo.
- **Tratamento de 401**: helper `api` detecta 401, limpa token e propaga
  erro com `.status = 401`. Componentes podem redirecionar pro login.
- **Login fallback hardcoded REMOVIDO**: antes, `admin@bratecc.com/admin123`
  e 5 emails de associados funcionavam mesmo sem backend. Anti-padrão de
  segurança. Agora login **só** funciona via `POST /api/auth/login`.
- **Fallback silencioso pra mocks REMOVIDO**: `loadData`, `addEmpresa`,
  `addAssociado`, `addEvento` não caem mais em dados hardcoded se a API
  falhar. Erro é exposto ao usuário com mensagem clara, estado fica vazio.

---

## `.gitignore`

Expandido pra cobrir:
- `.env` em qualquer subpasta (`backend/.env`, `frontend/.env`)
- `.env.production`, `.env.*.local`
- Exceção explícita pra `.env.example` (esses SIM devem ser commitados)
- Volumes Docker locais (`postgres-data/`, `docker-volumes/`)
- Coverage de testes, arquivos temporários de editores, arquivos de sistema

---

## Recomendação: inicializar Git

Entre v12 → v13, correções foram perdidas por falta de versionamento.
Sugestão forte:
```bash
cd /caminho/do/projeto
git init
git add .
git commit -m "v14 — CRUDs vinculados ao Postgres, relacionamentos corrigidos"
git remote add origin <seu-repo>
git push -u origin main
```

A partir daí, qualquer regressão é trivial de detectar (`git diff`) e reverter
(`git revert`).
