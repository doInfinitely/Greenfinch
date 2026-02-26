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
  List,
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
  Database,
  Braces,
  SlidersHorizontal,
  Link2,
  Merge,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import EnrichmentQueuePopover from '@/components/EnrichmentQueuePopover';
import NotificationBell from '@/components/NotificationBell';

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
      label: 'PIPELINE',
      items: [
        { href: '/pipeline/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
        { href: '/pipeline/board', label: 'Pipeline Board', icon: <Kanban className="w-4 h-4" /> },
      ],
    },
    {
      label: 'PROSPECTING',
      items: [
        { href: '/dashboard/map', label: 'Properties', icon: <MapPin className="w-4 h-4" /> },
        { href: '/organizations', label: 'Organizations', icon: <Building2 className="w-4 h-4" /> },
        { href: '/contacts', label: 'Contacts', icon: <Users className="w-4 h-4" /> },
        { href: '/lists', label: 'My Lists', icon: <List className="w-4 h-4" /> },
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
        { href: '/admin/organizations', label: 'Organizations', icon: <Building2 className="w-4 h-4" /> },
        { href: '/admin/database', label: 'Database', icon: <Database className="w-4 h-4" /> },
        { href: '/admin/ai-config', label: 'AI Config', icon: <SlidersHorizontal className="w-4 h-4" /> },
        { href: '/admin/vertex-logs', label: 'Vertex AI Debug', icon: <Braces className="w-4 h-4" /> },
        { href: '/admin/linkedin-overrides', label: 'LinkedIn Overrides', icon: <Link2 className="w-4 h-4" /> },
        { href: '/admin/merge-contacts', label: 'Merge Contacts', icon: <Merge className="w-4 h-4" /> },
        { href: '/admin/merge-properties', label: 'Merge Properties', icon: <Merge className="w-4 h-4" /> },
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
    if (pathname === href) return true;
    return pathname?.startsWith(href + '/') ?? false;
  };

  const filteredGroups = navGroups.filter(group => {
    if (group.internalOnly && !isGreenfinchMember) return false;
    if (group.adminOnly && !isOrgAdmin) return false;
    return true;
  });

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-4 border-b border-gray-200">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 relative flex-shrink-0">
            <Image
              src="/greenfinch-logo.png"
              alt="Greenfinch"
              fill
              sizes="32px"
              className="object-contain"
              priority
            />
          </div>
          {!collapsed && (
            <span className="font-semibold text-lg text-foreground">greenfinch.ai</span>
          )}
        </Link>
      </div>

      {isSignedIn && !collapsed && (
        <div className="px-3 py-3 border-b border-gray-100 lg:hidden">
          <p className="text-xs font-semibold text-muted-foreground tracking-wider mb-2 px-1">ORGANIZATION</p>
          <OrganizationSwitcher
            hidePersonal
            appearance={{
              elements: {
                rootBox: 'w-full',
                organizationSwitcherTrigger: 'w-full px-2 py-2 text-sm rounded-md hover:bg-gray-50 justify-start',
              },
            }}
          />
        </div>
      )}

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
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      isActive(item.href)
                        ? 'bg-green-50 text-green-600 border-l-4 border-green-600 rounded-l-none'
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

      <div className="p-4 border-t border-gray-200 space-y-4">
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
    <div className="flex h-screen bg-gray-50">
      <aside
        className={`hidden lg:flex flex-col border-r border-gray-200 bg-white transition-all duration-300 relative ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute top-1/2 -right-3 transform -translate-y-1/2 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-100 shadow-sm z-10"
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
        <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-lg">
          <SidebarContent />
        </aside>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-4 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2"
            data-testid="button-mobile-menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <EnrichmentQueuePopover />
          </div>
        </header>

        <header className="h-14 border-b border-gray-200 bg-white hidden lg:flex items-center justify-between px-4">
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
          <div className="flex items-center gap-3">
            <NotificationBell />
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
