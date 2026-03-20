import { Resend } from 'resend'
import { prisma } from './db'

const resend = new Resend(process.env.RESEND_API_KEY)

interface SendEmailParams {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailParams) {
  try {
    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'BRATECC Connect AI <noreply@bratecc.com>',
      to,
      subject,
      html,
    })

    // Log success
    await prisma.emailLog.create({
      data: {
        to,
        subject,
        body: html,
        status: 'sent',
      }
    })

    return { success: true, data }
  } catch (error) {
    // Log error
    await prisma.emailLog.create({
      data: {
        to,
        subject,
        body: html,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    })

    return { success: false, error }
  }
}

// Email templates
export const emailTemplates = {
  matchNotification: (empresaName: string, associadoName: string, score: number) => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #7c3aed, #ec4899); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .score { font-size: 48px; font-weight: bold; color: #10b981; text-align: center; margin: 20px 0; }
        .btn { display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎯 Novo Match Encontrado!</h1>
        </div>
        <div class="content">
          <p>Encontramos uma excelente oportunidade de negócio:</p>
          <h2>${empresaName}</h2>
          <p>Match com: <strong>${associadoName}</strong></p>
          <div class="score">${score}%</div>
          <p>Score de compatibilidade</p>
          <a href="${process.env.NEXTAUTH_URL}/dashboard" class="btn">Ver Detalhes</a>
        </div>
      </div>
    </body>
    </html>
  `,

  welcomeEmail: (name: string) => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #7c3aed, #ec4899); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; }
        .content { padding: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Bem-vindo ao BRATECC Connect AI</h1>
        </div>
        <div class="content">
          <h2>Olá, ${name}! 👋</h2>
          <p>Sua conta foi criada com sucesso. Nossa IA já está trabalhando para encontrar as melhores oportunidades de negócio para você.</p>
          <p><strong>Próximos passos:</strong></p>
          <ul>
            <li>Complete seu perfil</li>
            <li>Cadastre seus serviços/produtos</li>
            <li>Explore os matches gerados pela IA</li>
          </ul>
        </div>
      </div>
    </body>
    </html>
  `,
}
