#!/bin/sh
set -e

# Docker Compose: DB_HOST=postgres. Railway/managed DB: só DATABASE_URL (sem DB_HOST).
if [ -n "${DB_HOST}" ]; then
  echo "🔄 Aguardando PostgreSQL em ${DB_HOST}:${DB_PORT:-5432}..."
  until nc -z "${DB_HOST}" "${DB_PORT:-5432}" 2>/dev/null; do
    echo "⏳ PostgreSQL não disponível ainda, aguardando..."
    sleep 2
  done
  echo "✅ PostgreSQL disponível (TCP)!"
else
  echo "🔄 DATABASE_URL sem DB_HOST — pulando espera TCP (Postgres gerenciado / Railway)."
fi

echo "🔄 Executando migrations..."
set +e
npx prisma migrate deploy
mv_exit=$?
if [ "$mv_exit" -ne 0 ]; then
  echo "⚠️ migrate deploy saiu com $mv_exit — tentando db push..."
  npx prisma db push --accept-data-loss
  push_exit=$?
  if [ "$push_exit" -ne 0 ]; then
    echo "⚠️ db push também falhou ($push_exit). Verifique DATABASE_URL (ex.: ?sslmode=require no Railway). O Node ainda será iniciado."
  fi
fi
set -e

# Seed: dois modos suportados.
#   • RUN_DB_SEED=1       → seed COMPLETO (apaga tudo e popula com dados demo)
#   • RUN_DB_SEED=minimal → seed MÍNIMO (apaga tudo, cria só o admin)
#   • (vazio)             → não mexe no banco
# Em ambos os modos os dados existentes SÃO APAGADOS. Use com cuidado.
case "${RUN_DB_SEED:-}" in
  1|full|true)
    echo "🌱 RUN_DB_SEED=$RUN_DB_SEED — executando seed COMPLETO (com dados demo)..."
    node prisma/seed.js || echo "⚠️  Seed falhou — veja o log acima (DATABASE_URL, SSL, etc.)"
    ;;
  minimal|min|admin-only)
    echo "🌱 RUN_DB_SEED=$RUN_DB_SEED — executando seed MÍNIMO (só admin, banco zerado)..."
    node prisma/seed-minimal.js || echo "⚠️  Seed mínimo falhou — veja o log acima."
    ;;
  *)
    echo "🌱 Seed ignorado (defina RUN_DB_SEED=1 para popular com dados demo, ou RUN_DB_SEED=minimal para banco zerado com só o admin)."
    ;;
esac

echo "🚀 Iniciando servidor..."
exec "$@"
