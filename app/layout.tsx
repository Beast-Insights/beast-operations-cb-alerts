import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { ThemeProvider } from '@/components/ThemeProvider'
import SideNav from '@/components/SideNav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Beast Insights — Operations',
  description: 'Operations & monitoring dashboards.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.className} min-h-full bg-white dark:bg-gray-950 antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="flex min-h-screen">
            <SideNav />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
