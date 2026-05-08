'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TabNavigation, TabNavigationLink } from '@/components/TabNavigation'

const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/cb', label: 'Health Overview', match: (p) => p === '/cb' },
  { href: '/cb/reliability', label: 'Reliability', match: (p) => p.startsWith('/cb/reliability') },
  { href: '/cb/scrapers', label: 'Scrapers', match: (p) => p.startsWith('/cb/scrapers') },
  { href: '/cb/runs', label: 'Run History', match: (p) => p.startsWith('/cb/runs') },
]

export default function CbReportingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname() || '/cb'

  return (
    <div>
      {/* Section header + tab nav, mirrors the alerts dashboard sticky header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 pt-4 sm:px-6">
          <div>
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-50">
              Chargeback Reporting
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Operations & monitoring for the daily scraper pipeline.
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
