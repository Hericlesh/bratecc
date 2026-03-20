import type { Metadata } from 'next'
import { Syne, DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'

const syne = Syne({ subsets: ['latin'], variable: '--font-syne' })
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' })
const dmMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-dm-mono' })

export const metadata: Metadata = {
  title: 'BRATECC Connect AI | Texas-Brasil Business Intelligence',
  description: 'Sistema inteligente de conexões comerciais com IA',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body className={`${syne.variable} ${dmSans.variable} ${dmMono.variable} font-sans`}>
        {children}
      </body>
    </html>
  )
}
