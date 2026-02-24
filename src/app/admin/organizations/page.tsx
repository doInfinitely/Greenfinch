'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Shield, Building2, Users, Mail, Plus, RefreshCw, UserPlus, X, ChevronRight } from 'lucide-react';

interface Org {
  id: string;
  name: string;
  slug: string | null;
  membersCount: number;
  createdAt: string;
  imageUrl: string | null;
}

interface Member {
  id: string;
  clerkUserId: string;
  displayName: string;
  email: string;
  profileImageUrl: string | null;
  role: string;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  'org:admin': 'Admin',
  'org:super_admin': 'Super Admin',
  'org:member': 'Member',
  'admin': 'Admin',
  'basic_member': 'Member',
};

const ROLE_COLORS: Record<string, string> = {
  'org:admin': 'bg-purple-100 text-purple-700',
  'org:super_admin': 'bg-amber-100 text-amber-700',
  'org:member': 'bg-gray-100 text-gray-700',
  'admin': 'bg-purple-100 text-purple-700',
  'basic_member': 'bg-gray-100 text-gray-700',
};

export default function OrganizationsAdminPage() {
  const { orgSlug, orgRole } = useAuth();
  const { toast } = useToast();

  const isGreenfinchAdmin = orgSlug === 'greenfinch' && (orgRole === 'org:admin' || orgRole === 'org:super_admin');

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'invitations'>('members');

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [creating, setCreating] = useState(false);

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('basic_member');
  const [inviting, setInviting] = useState(false);

  const [orgSearch, setOrgSearch] = useState('');

  const filteredOrgs = orgs.filter(o =>
    !orgSearch || o.name.toLowerCase().includes(orgSearch.toLowerCase()) || (o.slug ?? '').toLowerCase().includes(orgSearch.toLowerCase())
  );

  useEffect(() => {
    if (isGreenfinchAdmin) fetchOrgs();
  }, [isGreenfinchAdmin]);

  useEffect(() => {
    if (selectedOrg) fetchOrgDetail(selectedOrg.id);
  }, [selectedOrg?.id]);

  async function fetchOrgs() {
    setLoadingOrgs(true);
    try {
      const res = await fetch('/api/admin/organizations');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const sorted = (json.data ?? []).sort((a: Org, b: Org) => a.name.localeCompare(b.name));
      setOrgs(sorted);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to load organizations', variant: 'destructive' });
    } finally {
      setLoadingOrgs(false);
    }
  }

  async function fetchOrgDetail(orgId: string) {
    setLoadingDetail(true);
    setMembers([]);
    setInvitations([]);
    try {
      const [membersRes, invRes] = await Promise.all([
        fetch(`/api/admin/organizations/${orgId}/members`),
        fetch(`/api/admin/organizations/${orgId}/invitations`),
      ]);
      const [membersJson, invJson] = await Promise.all([membersRes.json(), invRes.json()]);
      setMembers(membersJson.members ?? []);
      setInvitations(invJson.invitations ?? []);
    } catch {
      toast({ title: 'Error', description: 'Failed to load org details', variant: 'destructive' });
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrgName.trim(), slug: newOrgSlug.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Organization created', description: `"${json.data.name}" is ready` });
      setShowCreateDialog(false);
      setNewOrgName('');
      setNewOrgSlug('');
      await fetchOrgs();
      setSelectedOrg(json.data);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || !selectedOrg) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/admin/organizations/${selectedOrg.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Invitation sent', description: `Invite sent to ${inviteEmail}` });
      setShowInviteDialog(false);
      setInviteEmail('');
      setInviteRole('basic_member');
      fetchOrgDetail(selectedOrg.id);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    if (!selectedOrg) return;
    try {
      const res = await fetch(`/api/admin/organizations/${selectedOrg.id}/invitations`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error);
      }
      toast({ title: 'Invitation revoked' });
      fetchOrgDetail(selectedOrg.id);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (!isGreenfinchAdmin) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto h-10 w-10 text-gray-300 mb-3" />
          <p className="font-medium text-gray-700">Greenfinch admin access required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-72 border-r bg-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Organizations</h2>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchOrgs} disabled={loadingOrgs} data-testid="btn-refresh-orgs">
                <RefreshCw className={`h-3.5 w-3.5 ${loadingOrgs ? 'animate-spin' : ''}`} />
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setShowCreateDialog(true)} data-testid="btn-create-org">
                <Plus className="h-3.5 w-3.5" />New Org
              </Button>
            </div>
          </div>
          <Input
            placeholder="Search organizations..."
            value={orgSearch}
            onChange={e => setOrgSearch(e.target.value)}
            className="h-8 text-sm"
            data-testid="input-org-search"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingOrgs ? (
            <div className="p-4 text-sm text-gray-400 text-center">Loading...</div>
          ) : filteredOrgs.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">No organizations found</div>
          ) : (
            filteredOrgs.map(org => (
              <button
                key={org.id}
                data-testid={`org-item-${org.id}`}
                onClick={() => { setSelectedOrg(org); setActiveTab('members'); }}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors border-b border-gray-50 ${selectedOrg?.id === org.id ? 'bg-green-50 border-l-2 border-l-green-600' : ''}`}
              >
                {org.imageUrl ? (
                  <img src={org.imageUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Building2 className="h-4 w-4 text-green-700" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-gray-900 truncate">{org.name}</p>
                  <p className="text-xs text-gray-400 truncate">{org.slug ?? 'no slug'} · {org.membersCount} member{org.membersCount !== 1 ? 's' : ''}</p>
                </div>
                {selectedOrg?.id === org.id && <ChevronRight className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedOrg ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-400">
              <Building2 className="mx-auto h-10 w-10 mb-3 text-gray-200" />
              <p className="text-sm">Select an organization to manage</p>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-4xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                {selectedOrg.imageUrl ? (
                  <img src={selectedOrg.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded bg-green-100 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-green-700" />
                  </div>
                )}
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">{selectedOrg.name}</h1>
                  <p className="text-sm text-gray-400">{selectedOrg.slug ?? 'no slug'} · Created {formatDate(selectedOrg.createdAt)}</p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => setShowInviteDialog(true)}
                data-testid="btn-invite-member"
              >
                <UserPlus className="h-4 w-4 mr-1" />Invite Member
              </Button>
            </div>

            <div className="flex items-center gap-4 border-b mb-4">
              <button
                onClick={() => setActiveTab('members')}
                className={`text-sm font-medium pb-3 border-b-2 transition-colors ${activeTab === 'members' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                data-testid="tab-members"
              >
                Members ({members.length})
              </button>
              <button
                onClick={() => setActiveTab('invitations')}
                className={`text-sm font-medium pb-3 border-b-2 transition-colors ${activeTab === 'invitations' ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                data-testid="tab-invitations"
              >
                Pending Invitations ({invitations.length})
              </button>
              <button
                onClick={() => fetchOrgDetail(selectedOrg.id)}
                className="ml-auto pb-3 text-gray-400 hover:text-gray-600"
                data-testid="btn-refresh-detail"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingDetail ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingDetail ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-5 w-5 animate-spin text-gray-300" />
              </div>
            ) : activeTab === 'members' ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead className="hidden sm:table-cell">Joined</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map(member => (
                    <TableRow key={member.id} data-testid={`row-member-${member.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={member.profileImageUrl || ''} />
                            <AvatarFallback>{member.displayName?.charAt(0) || '?'}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm text-gray-900">{member.displayName}</p>
                            <p className="text-xs text-gray-400">{member.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-gray-400">{formatDate(member.joinedAt)}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-700'}`}>
                          {ROLE_LABELS[member.role] || member.role}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {members.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-gray-400 text-sm">No members</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="hidden sm:table-cell">Sent</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map(inv => (
                    <TableRow key={inv.id} data-testid={`row-invitation-${inv.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center">
                            <Mail className="h-3.5 w-3.5 text-gray-400" />
                          </div>
                          <span className="text-sm">{inv.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-gray-400">{formatDate(inv.createdAt)}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${ROLE_COLORS[inv.role] || 'bg-gray-100 text-gray-700'}`}>
                          {ROLE_LABELS[inv.role] || inv.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleRevokeInvitation(inv.id)}
                          data-testid={`btn-revoke-${inv.id}`}
                        >
                          <X className="h-3.5 w-3.5 text-gray-400" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {invitations.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-gray-400 text-sm">No pending invitations</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>Set up a new Clerk organization for a client or team.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Organization name <span className="text-red-500">*</span></Label>
              <Input
                id="org-name"
                placeholder="Acme Corp"
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                data-testid="input-org-name"
                onKeyDown={e => e.key === 'Enter' && handleCreateOrg()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-slug">
                Slug <span className="text-gray-400 text-xs font-normal">(optional — auto-generated if blank)</span>
              </Label>
              <Input
                id="org-slug"
                placeholder="acme-corp"
                value={newOrgSlug}
                onChange={e => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                data-testid="input-org-slug"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setNewOrgName(''); setNewOrgSlug(''); }}>
              Cancel
            </Button>
            <Button onClick={handleCreateOrg} disabled={!newOrgName.trim() || creating} data-testid="btn-confirm-create-org">
              {creating ? 'Creating...' : 'Create Organization'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite to {selectedOrg?.name}</DialogTitle>
            <DialogDescription>
              Send an invitation email to add a new member to this organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@company.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                data-testid="input-invite-email"
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="basic_member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowInviteDialog(false); setInviteEmail(''); setInviteRole('basic_member'); }}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting} data-testid="btn-send-invite">
              {inviting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
