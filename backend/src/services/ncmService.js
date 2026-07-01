// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI - Serviço de NCM (Nomenclatura Comum do Mercosul)
// Integração com API pública do Portal Único Siscomex
// ═══════════════════════════════════════════════════════════
//
// A API do Siscomex retorna o arquivo completo de NCMs (~10k códigos) em
// um único JSON. Não oferece busca textual. A estratégia é:
//   1. Baixar o catálogo completo e armazenar em `NcmCache` (Postgres)
//   2. Atender buscas consultando o banco local (rápido)
//   3. Re-baixar a cada 7 dias (TTL) ou sob demanda via refresh()
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');

const SISCOMEX_URL = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO';
const CACHE_TTL_DAYS = 7;

// ─── Verifica se cache está stale ───
async function isCacheStale() {
  const sample = await prisma.ncmCache.findFirst({
    orderBy: { atualizadoEm: 'desc' },
    select: { atualizadoEm: true }
  });

  if (!sample) return true; // nunca foi populado

  const ageMs = Date.now() - sample.atualizadoEm.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > CACHE_TTL_DAYS;
}

// ─── Download do catálogo completo do Siscomex ───
async function downloadFromSiscomex() {
  console.log('📥 Baixando catálogo NCM do Siscomex...');
  const startedAt = Date.now();

  // Timeout de 60s — a API é conhecidamente lenta
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(SISCOMEX_URL, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BRATECC-Connect/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Siscomex respondeu ${response.status}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.Nomenclaturas)) {
      throw new Error('Formato inesperado: campo Nomenclaturas ausente');
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`✅ Catálogo NCM recebido em ${elapsed}s (${data.Nomenclaturas.length} códigos)`);

    return data.Nomenclaturas;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Timeout ao baixar catálogo NCM do Siscomex (>60s)');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Popular/atualizar cache no banco ───
async function refreshCache() {
  const items = await downloadFromSiscomex();

  // Normaliza: remove pontos do código, guarda capítulo (2 primeiros dígitos)
  const normalized = items
    .filter(n => n && n.Codigo && n.Descricao)
    .map(n => {
      const codigo = String(n.Codigo).replace(/\./g, '').trim();
      return {
        codigo,
        descricao: String(n.Descricao).trim(),
        capitulo: codigo.length >= 2 ? codigo.slice(0, 2) : null,
      };
    });

  console.log(`💾 Gravando ${normalized.length} códigos NCM no banco...`);

  // upsert em lotes (~500 por vez) para não sobrecarregar
  const BATCH = 500;
  for (let i = 0; i < normalized.length; i += BATCH) {
    const chunk = normalized.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map(ncm =>
        prisma.ncmCache.upsert({
          where: { codigo: ncm.codigo },
          create: ncm,
          update: { descricao: ncm.descricao, capitulo: ncm.capitulo }
        })
      )
    );
  }

  console.log('✅ Cache NCM atualizado');
  return normalized.length;
}

// ─── Garantir que cache está disponível (lazy load no primeiro uso) ───
async function ensureCache() {
  if (await isCacheStale()) {
    await refreshCache();
  }
}

// ─── Busca NCMs por query (código parcial ou descrição) ───
// Retorna até `limit` resultados ordenados por relevância simples
async function search(query, limit = 20) {
  if (!query || query.trim().length < 2) {
    return [];
  }

  await ensureCache();

  const q = query.trim();
  const qNumeric = q.replace(/\./g, '');
  const isNumeric = /^\d+$/.test(qNumeric);

  if (isNumeric) {
    // Busca por código: prefix match
    return prisma.ncmCache.findMany({
      where: { codigo: { startsWith: qNumeric } },
      orderBy: { codigo: 'asc' },
      take: limit
    });
  }

  // Busca textual: contains insensitive
  return prisma.ncmCache.findMany({
    where: { descricao: { contains: q, mode: 'insensitive' } },
    orderBy: { codigo: 'asc' },
    take: limit
  });
}

// ─── Busca exata por código ───
async function getByCodigo(codigo) {
  if (!codigo) return null;
  const normalized = String(codigo).replace(/\./g, '').trim();
  return prisma.ncmCache.findUnique({ where: { codigo: normalized } });
}

module.exports = {
  isCacheStale,
  refreshCache,
  ensureCache,
  search,
  getByCodigo,
};
