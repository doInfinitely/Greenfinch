'use client';

import { useState, useEffect } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, UserPlus, Mail, Calendar, Shield, MoreHorizontal, Trash2, ArrowUpRight, RefreshCw, X, Check } from 'lucide-react';
import { useAuth, useOrganization } from '@clerk/nextjs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useToast } from '@/hooks/use-toast';

interface TeamMember {
  id: string;
  clerkUserId: string;
  displayName: string;
  email: string;
  profileImageUrl: string | null;
  role: string;
  joinedAt: string;
  isCurrentUser: boolean;
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

export default function TeamManagement() {
  const { orgRole, userId: currentClerkUserId } = useAuth();
  const { organization } = useOrganization();
  const { toast } = useToast();
  
  const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';
  
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('basic_member');
  const [inviting, setInviting] = useState(false);
  const [activeTab, setActiveTab] = useState<'members' | 'invitations'>('members');

  // Reset state and refetch when organization changes
  useEffect(() => {
    // Reset state when org changes
    setMembers([]);
    setInvitations([]);
    setLoading(true);
    
    if (isAdmin && organization?.id) {
      fetchTeamData();
    } else if (!organization?.id) {
      setLoading(false);
    }
  }, [isAdmin, organization?.id]);

  async function fetchTeamData() {
    setLoading(true);
    try {
      const [membersRes, invitationsRes] = await Promise.all([
        fetch('/api/org/members'),
        fetch('/api/org/invitations'),
      ]);

      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members.map((m: any) => ({
          ...m,
          isCurrentUser: m.clerkUserId === currentClerkUserId,
        })));
      }

      if (invitationsRes.ok) {
        const data = await invitationsRes.json();
        setInvitations(data.invitations || []);
      }
    } catch (error) {
      console.error('Failed to fetch team data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load team members',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    
    setInviting(true);
    try {
      const res = await fetch('/api/org/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send invitation');
      }

      toast({
        title: 'Invitation sent',
        description: `An invitation has been sent to ${inviteEmail}`,
      });
      
      setShowInviteDialog(false);
      setInviteEmail('');
      setInviteRole('basic_member');
      fetchTeamData();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send invitation',
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    try {
      const res = await fetch(`/api/org/invitations/${invitationId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to revoke invitation');
      }

      toast({
        title: 'Invitation revoked',
        description: 'The invitation has been cancelled',
      });
      
      fetchTeamData();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to revoke invitation',
        variant: 'destructive',
      });
    }
  }

  async function handleUpdateRole(memberId: string, newRole: string) {
    try {
      const res = await fetch(`/api/org/members/${memberId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update role');
      }

      toast({
        title: 'Role updated',
        description: 'Team member role has been updated',
      });
      
      fetchTeamData();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update role',
        variant: 'destructive',
      });
    }
  }

  async function handleRemoveMember(memberId: string) {
    try {
      const res = await fetch(`/api/org/members/${memberId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove member');
      }

      toast({
        title: 'Member removed',
        description: 'Team member has been removed from the organization',
      });
      
      fetchTeamData();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove member',
        variant: 'destructive',
      });
    }
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  if (!isAdmin) {
    return (
      <AppSidebar>
        <div className="h-full bg-gray-50 dark:bg-gray-950 p-6">
          <div className="max-w-2xl mx-auto text-center py-12">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-gray-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Access Denied</h1>
            <p className="text-muted-foreground">
              You need admin permissions to access this page.
            </p>
          </div>
        </div>
      </AppSidebar>
    );
  }

  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 dark:bg-gray-950 p-6 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Team</h1>
              <p className="text-muted-foreground">Manage your organization's team members</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchTeamData}
                disabled={loading}
                data-testid="button-refresh-team"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                onClick={() => setShowInviteDialog(true)}
                size="sm"
                data-testid="button-invite-member"
              >
                <UserPlus className="w-4 h-4 mr-1" />
                Invite Member
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setActiveTab('members')}
                  className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                    activeTab === 'members'
                      ? 'border-green-600 text-green-600'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                  data-testid="tab-members"
                >
                  Members ({members.length})
                </button>
                <button
                  onClick={() => setActiveTab('invitations')}
                  className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                    activeTab === 'invitations'
                      ? 'border-green-600 text-green-600'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                  data-testid="tab-invitations"
                >
                  Pending Invitations ({invitations.length})
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : activeTab === 'members' ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead className="hidden sm:table-cell">Joined</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.id} data-testid={`row-member-${member.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-9 h-9">
                              <AvatarImage src={member.profileImageUrl || ''} />
                              <AvatarFallback>
                                {member.displayName?.charAt(0) || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground truncate">
                                  {member.displayName}
                                </span>
                                {member.isCurrentUser && (
                                  <Badge variant="outline" className="text-xs">You</Badge>
                                )}
                              </div>
                              <span className="text-sm text-muted-foreground truncate block">
                                {member.email}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {formatDate(member.joinedAt)}
                        </TableCell>
                        <TableCell>
                          {member.isCurrentUser ? (
                            <Badge className={ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-700'}>
                              {ROLE_LABELS[member.role] || member.role}
                            </Badge>
                          ) : (
                            <Select
                              value={member.role}
                              onValueChange={(value) => handleUpdateRole(member.id, value)}
                            >
                              <SelectTrigger className="w-[120px]" data-testid={`select-role-${member.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="org:admin">Admin</SelectItem>
                                <SelectItem value="org:member">Member</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          {!member.isCurrentUser && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" data-testid={`button-member-actions-${member.id}`}>
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleRemoveMember(member.id)}
                                  className="text-red-600"
                                  data-testid={`button-remove-member-${member.id}`}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Remove from team
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {members.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No team members found
                        </TableCell>
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
                    {invitations.map((invitation) => (
                      <TableRow key={invitation.id} data-testid={`row-invitation-${invitation.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <span className="text-foreground">{invitation.email}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {formatDate(invitation.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge className={ROLE_COLORS[invitation.role] || 'bg-gray-100 text-gray-700'}>
                            {ROLE_LABELS[invitation.role] || invitation.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRevokeInvitation(invitation.id)}
                            data-testid={`button-revoke-invitation-${invitation.id}`}
                          >
                            <X className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {invitations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No pending invitations
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation email to add a new member to your team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
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
            <Button
              variant="outline"
              onClick={() => {
                setShowInviteDialog(false);
                setInviteEmail('');
                setInviteRole('basic_member');
              }}
              data-testid="button-cancel-invite"
            >
              Cancel
            </Button>
            <Button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviting}
              data-testid="button-send-invite"
            >
              {inviting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppSidebar>
  );
}
