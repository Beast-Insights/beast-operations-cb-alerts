'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  RiAlertLine,
  RiBarChart2Line,
  RiSunLine,
  RiMoonLine,
  RiMenuFoldLine,
  RiMenuUnfoldLine,
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import { cx } from '@/lib/utils'

type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  // a path is active when pathname startsWith one of these prefixes
  matches: string[]
}

const NAV: NavItem[] = [
  {
    label: 'Alerts',
    href: '/workflow',
    icon: RiAlertLine,
    // anything that isn't a CB Reporting page belongs to Alerts
    matches: ['/', '/alerts', '/workflow', '/processing', '/ops'],
  },
  {
    label: 'Chargeback Reporting',
    href: '/cb',
    icon: RiBarChart2Line,
    matches: ['/cb'],
  },
]

function isActive(pathname: string, item: NavItem): boolean {
  // CB Reporting wins whenever the path is /cb...
  if (pathname === '/cb' || pathname.startsWith('/cb/')) {
    return item.label === 'Chargeback Reporting'
  }
  // Otherwise Alerts is the active section for every other path
  return item.label === 'Alerts'
}

export default function SideNav() {
  const pathname = usePathname() || '/'
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Restore collapsed preference if saved
    try {
      const saved = window.localStorage.getItem('sidenav.collapsed')
      if (saved === '1') setCollapsed(true)
    } catch {}
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      try {
        window.localStorage.setItem('sidenav.collapsed', next ? '1' : '0')
      } catch {}
      return next
    })
  }

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return (
    <aside
      className={cx(
        'sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r bg-white dark:bg-gray-950',
        'border-gray-200 dark:border-gray-800 transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-[232px]',
      )}
    >
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-4 dark:border-gray-800">
        <svg className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#3B82F6" strokeWidth="2" fill="none" />
          <circle cx="12" cy="12" r="5" stroke="#3B82F6" strokeWidth="2" fill="none" />
          <circle cx="12" cy="12" r="1.5" fill="#3B82F6" />
        </svg>
        {!collapsed && (
          <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-50">
            Beast Insights
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item)
            const Icon = item.icon
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cx(
                    'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/60',
                  )}
                >
                  <Icon
                    className={cx(
                      'size-5 shrink-0',
                      active
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-500 group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-300',
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer controls */}
      <div className="flex items-center gap-1 border-t border-gray-200 p-2 dark:border-gray-800">
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-200"
        >
          {collapsed ? (
            <RiMenuUnfoldLine className="size-5" />
          ) : (
            <RiMenuFoldLine className="size-5" />
          )}
        </button>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-200"
        >
          {mounted && (theme === 'dark' ? <RiSunLine className="size-5" /> : <RiMoonLine className="size-5" />)}
        </button>
      </div>
    </aside>
  )
}
