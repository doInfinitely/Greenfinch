'use client';

import { useState, useEffect, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MapPin, Plus, MoreHorizontal, Trash2, Pencil, UserMinus } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import TerritoryDialog from '@/components/TerritoryDialog';
import type { TerritoryType, TerritoryDefinition, TerritoryDefinitionZipCodes, TerritoryDefinitionCounties } from '@/lib/schema';

interface TeamMember {
  id: string;
  dbUserId: string | null;
  clerkUserId: string;
  displayName: string;
  email: string;
  profileImageUrl: string | null;
}

interface TerritoryRow {
  id: string;
  name: string;
  color: string;
  type: TerritoryType;
  definition: TerritoryDefinition;
  assignedUserId: string | null;
  assignedClerkUserId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  assignedUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    profileImageUrl: string | null;
    displayName: string;
  } | null;
}

const TYPE_LABELS: Record<string, string> = {
  zip_codes: 'Zip Codes',
  counties: 'Counties',
  polygon: 'Polygon',
};

function getDefinitionSummary(type: string, definition: TerritoryDefinition): string {
  if (type === 'zip_codes' && 'zipCodes' in definition) {
    const zips = definition.zipCodes;
    if (zips.length <= 3) return zips.join(', ');
    return `${zips.slice(0, 3).join(', ')} +${zips.length - 3} more`;
  }
  if (type === 'counties' && 'counties' in definition) {
    const counties = definition.counties;
    if (counties.length <= 2) return counties.join(', ');
    return `${counties.slice(0, 2).join(', ')} +${counties.length - 2} more`;
  }
  if (type === 'polygon') return 'Custom polygon';
  return '';
}

export default function TerritoriesPage() {
  const { orgRole } = useAuth();
  const { toast } = useToast();
  const [territories, setTerritories] = useState<TerritoryRow[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTerritory, setEditingTerritory] = useState<TerritoryRow | null>(null);
  const [availableZipCodes, setAvailableZipCodes] = useState<string[]>([]);
  const [availableCounties, setAvailableCounties] = useState<string[]>([]);

  const isAdmin = orgRole === 'org:admin' || orgRole === 'org:super_admin';
  const isManager = orgRole === 'org:manager';
  const canAssign = isAdmin || isManager;

  async function handleAssignRep(territoryId: string, clerkUserId: string | null) {
    try {
      const member = clerkUserId ? members.find(m => m.clerkUserId === clerkUserId) : null;
      const res = await fetch(`/api/territories/${territoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignedUserId: member?.dbUserId || null,
          assignedClerkUserId: clerkUserId || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to assign');
      await fetchTerritories();
      toast({ title: 'Updated', description: 'Territory assignment updated' });
    } catch {
      toast({ title: 'Error', description: 'Failed to assign rep', variant: 'destructive' });
    }
  }

  const fetchTerritories = useCallback(async () => {
    try {
      const res = await fetch('/api/territories');
      const data = await res.json();
      setTerritories(data.territories || []);
    } catch {
      toast({ title: 'Error', description: 'Failed to load territories', variant: 'destructive' });
    }
  }, [toast]);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch('/api/org/members');
      const data = await res.json();
      setMembers(data.members || []);
    } catch {
      // Members aren't critical
    }
  }, []);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const res = await fetch('/api/properties/filter-options');
      const data = await res.json();
      setAvailableZipCodes(data.zipCodes || []);
      setAvailableCounties(data.geoCounties || data.counties || []);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchTerritories(), fetchMembers(), fetchFilterOptions()])
      .finally(() => setLoading(false));
  }, [fetchTerritories, fetchMembers, fetchFilterOptions]);

  const handleCreate = () => {
    setEditingTerritory(null);
    setDialogOpen(true);
  };

  const handleEdit = (territory: TerritoryRow) => {
    setEditingTerritory(territory);
    setDialogOpen(true);
  };

  const handleDelete = async (territoryId: string) => {
    try {
      const res = await fetch(`/api/territories/${territoryId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast({ title: 'Territory deleted' });
      fetchTerritories();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete territory', variant: 'destructive' });
    }
  };

  const handleSave = async (data: {
    id?: string;
    name: string;
    color: string;
    type: TerritoryType;
    definition: TerritoryDefinition;
    assignedUserId: string | null;
    assignedClerkUserId: string | null;
  }) => {
    if (data.id) {
      // Update
      const res = await fetch(`/api/territories/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update');
      toast({ title: 'Territory updated' });
    } else {
      // Create
      const res = await fetch('/api/territories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create');
      toast({ title: 'Territory created' });
    }
    fetchTerritories();
  };

  return (
    <AppSidebar>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Territories</h1>
            <p className="text-muted-foreground">
              Define geographic territories and assign them to team members
            </p>
          </div>
          {isAdmin && (
            <Button onClick={handleCreate} className="gap-2">
              <Plus className="w-4 h-4" />
              Create Territory
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Territory List
            </CardTitle>
            <CardDescription>
              {territories.length} {territories.length === 1 ? 'territory' : 'territories'} defined
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
              </div>
            ) : territories.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No territories defined yet</p>
                <p className="text-sm mt-1">Create territories to assign geographic areas to your team members.</p>
                {isAdmin && (
                  <Button onClick={handleCreate} variant="outline" className="mt-4 gap-2">
                    <Plus className="w-4 h-4" />
                    Create First Territory
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Territory</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Definition</TableHead>
                    <TableHead>Assigned Rep</TableHead>
                    {isAdmin && <TableHead className="w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {territories.map((territory) => (
                    <TableRow key={territory.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: territory.color }}
                          />
                          <span className="font-medium">{territory.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{TYPE_LABELS[territory.type] || territory.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {getDefinitionSummary(territory.type, territory.definition)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {canAssign ? (
                          <Select
                            value={territory.assignedClerkUserId || 'unassigned'}
                            onValueChange={(val) => handleAssignRep(territory.id, val === 'unassigned' ? null : val)}
                          >
                            <SelectTrigger className="w-[180px] h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {members.map((m) => (
                                <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                                  {m.displayName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : territory.assignedUser ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="w-6 h-6">
                              <AvatarImage src={territory.assignedUser.profileImageUrl || undefined} />
                              <AvatarFallback className="text-xs">
                                {territory.assignedUser.displayName?.charAt(0) || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm">{territory.assignedUser.displayName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEdit(territory)}>
                                <Pencil className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDelete(territory.id)}
                                className="text-red-600"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <TerritoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        territory={editingTerritory ? {
          id: editingTerritory.id,
          name: editingTerritory.name,
          color: editingTerritory.color,
          type: editingTerritory.type as TerritoryType,
          definition: editingTerritory.definition,
          assignedUserId: editingTerritory.assignedUserId,
          assignedClerkUserId: editingTerritory.assignedClerkUserId,
        } : null}
        members={members}
        availableZipCodes={availableZipCodes}
        availableCounties={availableCounties}
        onSave={handleSave}
      />
    </AppSidebar>
  );
}
