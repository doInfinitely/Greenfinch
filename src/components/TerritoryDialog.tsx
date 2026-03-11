'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, X, Plus } from 'lucide-react';
import type { TerritoryType, TerritoryDefinition, TerritoryDefinitionPolygon } from '@/lib/schema';
import dynamic from 'next/dynamic';

const TerritoryDrawMap = dynamic(() => import('./TerritoryDrawMap'), { ssr: false });

interface TeamMember {
  id: string;
  dbUserId: string | null;
  clerkUserId: string;
  displayName: string;
  email: string;
  profileImageUrl: string | null;
}

interface TerritoryData {
  id?: string;
  name: string;
  color: string;
  type: TerritoryType;
  definition: TerritoryDefinition;
  assignedUserId: string | null;
  assignedClerkUserId: string | null;
}

interface OverlapWarning {
  territoryName: string;
  overlappingValues: string[];
}

interface TerritoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  territory?: TerritoryData | null;
  members: TeamMember[];
  availableZipCodes: string[];
  availableCounties: string[];
  onSave: (data: TerritoryData) => Promise<void>;
}

const COLOR_PALETTE = [
  '#16a34a', // green
  '#2563eb', // blue
  '#dc2626', // red
  '#ea580c', // orange
  '#9333ea', // purple
  '#0891b2', // cyan
  '#ca8a04', // yellow
  '#be185d', // pink
  '#4f46e5', // indigo
  '#059669', // emerald
];

export default function TerritoryDialog({
  open,
  onOpenChange,
  territory,
  members,
  availableZipCodes,
  availableCounties,
  onSave,
}: TerritoryDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [type, setType] = useState<TerritoryType>('zip_codes');
  const [selectedZipCodes, setSelectedZipCodes] = useState<string[]>([]);
  const [selectedCounties, setSelectedCounties] = useState<string[]>([]);
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null);
  const [assignedClerkUserId, setAssignedClerkUserId] = useState<string | null>(null);
  const [polygonGeometry, setPolygonGeometry] = useState<GeoJSON.Polygon | null>(null);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [zipSearch, setZipSearch] = useState('');
  const [countySearch, setCountySearch] = useState('');
  const [overlaps, setOverlaps] = useState<OverlapWarning[]>([]);

  const isEditing = !!territory?.id;

  // Fetch mapbox token on mount
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(d => setMapboxToken(d.mapboxToken || null))
      .catch(() => {});
  }, []);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (territory) {
        setName(territory.name);
        setColor(territory.color);
        setType(territory.type);
        setAssignedUserId(territory.assignedUserId);
        setAssignedClerkUserId(territory.assignedClerkUserId);
        if (territory.type === 'zip_codes' && 'zipCodes' in territory.definition) {
          setSelectedZipCodes(territory.definition.zipCodes);
        } else if (territory.type === 'counties' && 'counties' in territory.definition) {
          setSelectedCounties(territory.definition.counties);
        } else if (territory.type === 'polygon' && 'geometry' in territory.definition) {
          setPolygonGeometry((territory.definition as TerritoryDefinitionPolygon).geometry);
        }
      } else {
        setName('');
        setColor(COLOR_PALETTE[0]);
        setType('zip_codes');
        setSelectedZipCodes([]);
        setSelectedCounties([]);
        setPolygonGeometry(null);
        setAssignedUserId(null);
        setAssignedClerkUserId(null);
      }
      setOverlaps([]);
      setZipSearch('');
      setCountySearch('');
    }
  }, [open, territory]);

  // Check for overlaps when definition changes
  const checkOverlap = useCallback(async () => {
    let definition: TerritoryDefinition | null = null;
    if (type === 'zip_codes' && selectedZipCodes.length > 0) {
      definition = { zipCodes: selectedZipCodes };
    } else if (type === 'counties' && selectedCounties.length > 0) {
      definition = { counties: selectedCounties };
    }

    if (!definition) {
      setOverlaps([]);
      return;
    }

    try {
      const res = await fetch('/api/territories/overlap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          definition,
          excludeTerritoryId: territory?.id,
        }),
      });
      const data = await res.json();
      if (data.overlaps) {
        setOverlaps(data.overlaps.map((o: { territoryName: string; overlappingValues: string[] }) => ({
          territoryName: o.territoryName,
          overlappingValues: o.overlappingValues,
        })));
      }
    } catch {
      // Silently fail overlap check
    }
  }, [type, selectedZipCodes, selectedCounties, territory?.id]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(checkOverlap, 500);
    return () => clearTimeout(timer);
  }, [checkOverlap, open]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Name required', description: 'Please enter a territory name', variant: 'destructive' });
      return;
    }

    let definition: TerritoryDefinition;
    if (type === 'zip_codes') {
      if (selectedZipCodes.length === 0) {
        toast({ title: 'Zip codes required', description: 'Please select at least one zip code', variant: 'destructive' });
        return;
      }
      definition = { zipCodes: selectedZipCodes };
    } else if (type === 'counties') {
      if (selectedCounties.length === 0) {
        toast({ title: 'Counties required', description: 'Please select at least one county', variant: 'destructive' });
        return;
      }
      definition = { counties: selectedCounties };
    } else if (type === 'polygon') {
      if (!polygonGeometry) {
        toast({ title: 'Polygon required', description: 'Please draw a territory boundary on the map', variant: 'destructive' });
        return;
      }
      definition = { geometry: polygonGeometry };
    } else {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: territory?.id,
        name: name.trim(),
        color,
        type,
        definition,
        assignedUserId,
        assignedClerkUserId,
      });
      onOpenChange(false);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save territory', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleMemberSelect = (value: string) => {
    if (value === 'unassigned') {
      setAssignedUserId(null);
      setAssignedClerkUserId(null);
    } else {
      const member = members.find(m => m.dbUserId === value);
      if (member) {
        setAssignedUserId(member.dbUserId);
        setAssignedClerkUserId(member.clerkUserId);
      }
    }
  };

  const filteredZipCodes = availableZipCodes.filter(z =>
    !selectedZipCodes.includes(z) && z.includes(zipSearch)
  );

  const filteredCounties = availableCounties.filter(c =>
    !selectedCounties.includes(c) && c.toLowerCase().includes(countySearch.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Territory' : 'Create Territory'}</DialogTitle>
          <DialogDescription>
            Define a geographic area and assign it to a team member.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Name & Color */}
          <div className="grid grid-cols-[1fr,auto] gap-4">
            <div>
              <Label htmlFor="territory-name">Name</Label>
              <Input
                id="territory-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Downtown Dallas"
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex gap-1.5 mt-2">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                      color === c ? 'border-gray-900 scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Assigned Rep */}
          <div>
            <Label>Assigned Rep</Label>
            <Select
              value={assignedUserId || 'unassigned'}
              onValueChange={handleMemberSelect}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {members.filter(m => m.dbUserId).map((member) => (
                  <SelectItem key={member.dbUserId!} value={member.dbUserId!}>
                    {member.displayName} ({member.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Territory Type Tabs */}
          <Tabs value={type} onValueChange={(v) => setType(v as TerritoryType)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="zip_codes">Zip Codes</TabsTrigger>
              <TabsTrigger value="counties">Counties</TabsTrigger>
              <TabsTrigger value="polygon">Draw on Map</TabsTrigger>
            </TabsList>

            <TabsContent value="zip_codes" className="space-y-3 mt-3">
              {/* Selected zips */}
              <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                {selectedZipCodes.map((zip) => (
                  <Badge key={zip} variant="secondary" className="gap-1 pr-1">
                    {zip}
                    <button
                      onClick={() => setSelectedZipCodes(prev => prev.filter(z => z !== zip))}
                      className="hover:bg-gray-300 rounded-full p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {selectedZipCodes.length === 0 && (
                  <span className="text-sm text-muted-foreground">No zip codes selected</span>
                )}
              </div>
              {/* Search + add */}
              <Input
                placeholder="Search zip codes..."
                value={zipSearch}
                onChange={(e) => setZipSearch(e.target.value)}
              />
              <div className="max-h-40 overflow-y-auto border rounded-md">
                {filteredZipCodes.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground text-center">
                    {zipSearch ? 'No matching zip codes' : 'All zip codes selected'}
                  </p>
                ) : (
                  filteredZipCodes.slice(0, 50).map((zip) => (
                    <button
                      key={zip}
                      onClick={() => setSelectedZipCodes(prev => [...prev, zip])}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 border-b last:border-b-0"
                    >
                      <Plus className="w-3 h-3 text-gray-400" />
                      {zip}
                    </button>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="counties" className="space-y-3 mt-3">
              {/* Selected counties */}
              <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                {selectedCounties.map((county) => (
                  <Badge key={county} variant="secondary" className="gap-1 pr-1">
                    {county}
                    <button
                      onClick={() => setSelectedCounties(prev => prev.filter(c => c !== county))}
                      className="hover:bg-gray-300 rounded-full p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {selectedCounties.length === 0 && (
                  <span className="text-sm text-muted-foreground">No counties selected</span>
                )}
              </div>
              {/* Search + add */}
              <Input
                placeholder="Search counties..."
                value={countySearch}
                onChange={(e) => setCountySearch(e.target.value)}
              />
              <div className="max-h-40 overflow-y-auto border rounded-md">
                {filteredCounties.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground text-center">
                    {countySearch ? 'No matching counties' : 'All counties selected'}
                  </p>
                ) : (
                  filteredCounties.map((county) => (
                    <button
                      key={county}
                      onClick={() => setSelectedCounties(prev => [...prev, county])}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 border-b last:border-b-0"
                    >
                      <Plus className="w-3 h-3 text-gray-400" />
                      {county}
                    </button>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="polygon" className="space-y-3 mt-3">
              {mapboxToken ? (
                <TerritoryDrawMap
                  accessToken={mapboxToken}
                  initialGeometry={polygonGeometry}
                  onGeometryChange={setPolygonGeometry}
                />
              ) : (
                <div className="w-full h-[300px] flex items-center justify-center bg-gray-100 rounded-md border">
                  <p className="text-gray-500 text-sm">Loading map...</p>
                </div>
              )}
              {polygonGeometry && (
                <p className="text-sm text-green-600">
                  Polygon drawn with {polygonGeometry.coordinates[0].length - 1} points
                </p>
              )}
            </TabsContent>
          </Tabs>

          {/* Overlap Warning */}
          {overlaps.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800">Territory Overlap Detected</p>
                {overlaps.map((o, i) => (
                  <p key={i} className="text-amber-700 mt-1">
                    Overlaps with <strong>{o.territoryName}</strong>: {o.overlappingValues.join(', ')}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Update Territory' : 'Create Territory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
