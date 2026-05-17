/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Menu, X } from 'lucide-react'
import React, { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils.ts'
import { useMedia } from '@/hooks/useMedia.ts'
import { useAuth } from '@/features/auth/AuthContext.tsx'
import { Logo } from '@/components/common/Logo.tsx'

const menuItems = [{ nameKey: 'header.about', to: '/about' }] as const
const mobileLinks = [{ nameKey: 'header.about', to: '/about' }] as const

export const Header = () => {
  const { isAuthenticated, authType, signIn, signOut } = useAuth()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)
  const [isScrolled, setIsScrolled] = React.useState(false)
  const isLarge = useMedia('(min-width: 64rem)')
  const { t } = useTranslation('common')

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow

    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isMobileMenuOpen])

  return (
    <header
      role="banner"
      data-state={isMobileMenuOpen ? 'active' : 'inactive'}
      {...(isScrolled && { 'data-scrolled': true })}
      className="fixed inset-x-0 top-0 z-50"
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 z-50 border-foreground/5 transition-all duration-300',
          'in-data-scrolled:border-b in-data-scrolled:bg-background/75 in-data-scrolled:backdrop-blur',
          !isLarge && 'h-14 overflow-hidden border-b',
          isMobileMenuOpen && 'h-screen bg-background/75 backdrop-blur',
        )}
      >
        <div className="mx-auto max-w-7xl px-6 lg:px-12">
          <div className="relative flex flex-wrap items-center justify-between lg:py-3">
            <div className="flex justify-between gap-8 max-lg:h-14 max-lg:w-full max-lg:border-b max-lg:border-foreground/5">
              <Link
                to="/"
                aria-label={t('header.home')}
                className="flex items-center gap-2"
              >
                <Logo />
                <span className="text-lg font-semibold">{t('appName')}</span>
              </Link>

              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={
                  isMobileMenuOpen
                    ? t('header.closeMenu')
                    : t('header.openMenu')
                }
                className="relative z-20 -m-2.5 -mr-3 block cursor-pointer p-2.5 lg:hidden"
              >
                <Menu className="m-auto size-5 duration-200 in-data-[state=active]:scale-0 in-data-[state=active]:rotate-180 in-data-[state=active]:opacity-0" />
                <X className="absolute inset-0 m-auto size-5 scale-0 -rotate-180 opacity-0 duration-200 in-data-[state=active]:scale-100 in-data-[state=active]:rotate-0 in-data-[state=active]:opacity-100" />
              </button>
            </div>

            {isLarge && (
              <div className="mr-6 ml-auto border-r border-foreground/10 pr-6">
                <div className="lg:pr-4">
                  <ul className="space-y-6 text-base lg:flex lg:gap-8 lg:space-y-0 lg:text-sm">
                    {menuItems.map((item) => (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          className="block text-muted-foreground duration-150 hover:text-accent-foreground"
                        >
                          <span>{t(item.nameKey)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {!isLarge && isMobileMenuOpen && (
              <nav className="w-full [--color-muted:--alpha(var(--color-foreground)/5%)]">
                {mobileLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="group relative block py-4 text-lg"
                  >
                    {t(link.nameKey)}
                  </Link>
                ))}
              </nav>
            )}

            {/* Only show login/logout buttons in authenticated mode */}
            {authType === 'authenticated' && (
              <div className="mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 in-data-[state=active]:flex max-lg:in-data-[state=active]:mt-6 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent">
                <div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
                  {isAuthenticated ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => signOut()}
                      render={<span>{t('header.logout')}</span>}
                      nativeButton={false}
                    />
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => signIn()}
                        render={<span>{t('header.login')}</span>}
                        nativeButton={false}
                      />
                      <Button
                        size="sm"
                        onClick={() => signIn()}
                        render={<span>{t('header.getStarted')}</span>}
                        nativeButton={false}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
