'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { useAuth, useUser, OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import {
  MapPin,
  Building2,
  Users,
  LayoutDashboard,
  Kanban,
  Settings,
  UsersRound,
  BarChart3,
  BookOpen,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import EnrichmentQueuePopover from '@/components/EnrichmentQueuePopover';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
  internalOnly?: boolean;
}

export default function AppSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { orgSlug, orgRole, isSignedIn } = useAuth();
  const { user } = useUser();

  const isGreenfinchMember = orgSlug === 'greenfinch';
  const isOrgAdmin = orgRole === 'org:admin';

  const navGroups: NavGroup[] = [
    {
      label: 'PROSPECTING',
      items: [
        { href: '/dashboard/map', label: 'Properties', icon: <MapPin className="w-4 h-4" /> },
        { href: '/organizations', label: 'Organizations', icon: <Building2 className="w-4 h-4" /> },
        { href: '/contacts', label: 'Contacts', icon: <Users className="w-4 h-4" /> },
      ],
    },
    {
      label: 'PIPELINE',
      items: [
        { href: '/pipeline/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
        { href: '/pipeline/board', label: 'Pipeline Board', icon: <Kanban className="w-4 h-4" /> },
      ],
    },
    {
      label: 'ADMIN',
      adminOnly: true,
      items: [
        { href: '/org-admin/team', label: 'Team Management', icon: <UsersRound className="w-4 h-4" /> },
        { href: '/org-admin/analytics', label: 'Org Analytics', icon: <BarChart3 className="w-4 h-4" /> },
      ],
    },
    {
      label: 'INTERNAL',
      internalOnly: true,
      items: [
        { href: '/admin', label: 'Data Admin', icon: <Settings className="w-4 h-4" /> },
      ],
    },
    {
      label: 'HELP',
      items: [
        { href: '/docs', label: 'Documentation', icon: <BookOpen className="w-4 h-4" /> },
        { href: '/support', label: 'Support', icon: <HelpCircle className="w-4 h-4" /> },
      ],
    },
  ];

  const isActive = (href: string) => {
    if (href === '/dashboard/map') {
      return pathname === '/dashboard/map' || pathname === '/dashboard' || pathname === '/dashboard/list';
    }
    return pathname?.startsWith(href);
  };

  const filteredGroups = navGroups.filter(group => {
    if (group.internalOnly && !isGreenfinchMember) return false;
    if (group.adminOnly && !isOrgAdmin) return false;
    return true;
  });

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 relative flex-shrink-0">
            <Image
              src="/greenfinch-logo.jpg"
              alt="Greenfinch"
              fill
              className="object-contain rounded"
              priority
            />
          </div>
          {!collapsed && (
            <span className="font-semibold text-lg text-foreground">Greenfinch</span>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        {filteredGroups.map((group) => (
          <div key={group.label} className="mb-6">
            {!collapsed && (
              <div className="px-4 mb-2">
                <span className="text-xs font-semibold text-muted-foreground tracking-wider">
                  {group.label}
                </span>
              </div>
            )}
            <ul className="space-y-1 px-2">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive(item.href)
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                    title={collapsed ? item.label : undefined}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {item.icon}
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-border space-y-4">
        {isSignedIn && (
          <div className="flex items-center gap-2">
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: 'w-8 h-8',
                },
              }}
            />
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user?.firstName || user?.primaryEmailAddress?.emailAddress?.split('@')[0]}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      <aside
        className={`hidden lg:flex flex-col border-r border-border bg-card transition-all duration-300 ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute bottom-20 -right-3 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center hover:bg-muted"
          style={{ left: collapsed ? '52px' : '248px' }}
          data-testid="button-toggle-sidebar"
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronLeft className="w-3 h-3" />
          )}
        </button>
      </aside>

      <div
        className={`fixed inset-0 z-40 lg:hidden transition-opacity ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
        <aside className="absolute left-0 top-0 bottom-0 w-64 bg-card">
          <SidebarContent />
        </aside>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2"
            data-testid="button-mobile-menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <div className="w-6 h-6 relative">
              <Image
                src="/greenfinch-logo.jpg"
                alt="Greenfinch"
                fill
                className="object-contain rounded"
              />
            </div>
            <span className="font-semibold">Greenfinch</span>
          </Link>
          <div className="w-10" />
        </header>

        <header className="h-14 border-b border-border bg-card hidden lg:flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            {isSignedIn && (
              <OrganizationSwitcher
                hidePersonal
                appearance={{
                  elements: {
                    rootBox: 'flex items-center',
                    organizationSwitcherTrigger: 'px-2 py-1 text-sm',
                  },
                }}
              />
            )}
          </div>
          <div className="flex items-center gap-4">
            <EnrichmentQueuePopover />
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
