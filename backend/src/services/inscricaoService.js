// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI - Serviço de Inscrição Pública
// ═══════════════════════════════════════════════════════════
// Geração de slug único para eventos + validação de reCAPTCHA
// opcional (ativa apenas se as env vars estiverem configuradas).
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');
const prisma = require('../config/database');

// ─── Gera slug único de 10 chars (base36) ───
// Formato: sem caracteres ambíguos (0/O, 1/l), fácil de copiar/digitar.
// Colisão: probabilidade desprezível, mas verificamos no banco mesmo assim.
async function gerarSlugUnico(maxTentativas = 5) {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789'; // 31 chars sem ambiguidade
  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    const bytes = crypto.randomBytes(10);
    let slug = '';
    for (let i = 0; i < 10; i++) {
      slug += alfabeto[bytes[i] % alfabeto.length];
    }
    const existente = await prisma.evento.findUnique({
      where: { inscricaoSlug: slug },
      select: { id: true }
    });
    if (!existente) return slug;
  }
  throw new Error('Não foi possível gerar slug único após várias tentativas');
}

// ─── Valida reCAPTCHA server-side ───
// Se CAPTCHA_SECRET não está setado, aceita qualquer request (dev mode).
// Suporta reCAPTCHA v3 do Google e Cloudflare Turnstile.
// Configuração via env:
//   CAPTCHA_PROVIDER = 'google' | 'turnstile' | ''  (vazio = desabilitado)
//   CAPTCHA_SECRET   = secret key do provedor
async function validarCaptcha(token, userIp) {
  const provider = (process.env.CAPTCHA_PROVIDER || '').toLowerCase();
  const secret = process.env.CAPTCHA_SECRET;

  // Captcha desabilitado — aceita sem validar
  if (!provider || !secret) {
    return { success: true, skipped: true };
  }

  if (!token) {
    return { success: false, error: 'Token de captcha ausente' };
  }

  let verifyUrl;
  if (provider === 'google') {
    verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
  } else if (provider === 'turnstile') {
    verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  } else {
    console.warn(`CAPTCHA_PROVIDER desconhecido: ${provider}`);
    return { success: true, skipped: true };
  }

  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (userIp) params.append('remoteip', userIp);

  try {
    const resp = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const data = await resp.json();
    if (data.success) {
      return { success: true, score: data.score || null };
    }
    return { success: false, error: 'Validação do captcha falhou', codes: data['error-codes'] };
  } catch (err) {
    console.error('Erro ao validar captcha:', err);
    return { success: false, error: 'Erro ao consultar provedor de captcha' };
  }
}

module.exports = { gerarSlugUnico, validarCaptcha };
