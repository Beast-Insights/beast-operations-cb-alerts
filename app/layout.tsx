import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { ThemeProvider } from '@/components/ThemeProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Beast Deposit Reconciliation Agent Status',
  description: 'Operations & monitoring for the daily reconciliation pipeline.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.className} min-h-full bg-white antialiased dark:bg-gray-950`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <main className="min-w-0">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  )
}
