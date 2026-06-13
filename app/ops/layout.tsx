'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TabNavigation, TabNavigationLink } from '@/components/TabNavigation'

const TABS = [
  { href: '/ops', label: 'Health Overview', match: (p: string) => p === '/ops' },
  { href: '/ops/scrapers', label: 'Scrapers', match: (p: string) => p.startsWith('/ops/scrapers') },
]

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/ops'
  return (
    <div>
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 pt-4 sm:px-6">
          <div>
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-50">
              Beast Recon — Agent Status
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Operations &amp; monitoring for the daily reconciliation pipeline.
            </p>
          </div>
        </div>
        <TabNavigation className="mt-4">
          <div className="mx-auto flex w-full max-w-7xl items-center px-6">
            {TABS.map((t) => (
              <TabNavigationLink key={t.href} asChild active={t.match(pathname)}>
                <Link href={t.href}>{t.label}</Link>
              </TabNavigationLink>
            ))}
          </div>
        </TabNavigation>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</div>
    </div>
  )
}
