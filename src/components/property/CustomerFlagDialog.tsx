'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { CUSTOMER_FLAG_CONFIG, CUSTOMER_FLAG_TYPES, type CustomerFlagType } from '@/lib/customer-flags';
import { UserCheck, Swords, Ban, Flame, FileSignature, History, Loader2, type LucideIcon } from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  UserCheck, Swords, Ban, Flame, FileSignature, History,
};

interface FlagState {
  enabled: boolean;
  notes: string;
  competitorName: string;
  id?: string;
}

interface CustomerFlagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  onFlagsChange?: () => void;
}

export default function CustomerFlagDialog({ open, onOpenChange, propertyId, onFlagsChange }: CustomerFlagDialogProps) {
  const [flags, setFlags] = useState<Record<CustomerFlagType, FlagState>>(() => initFlags());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<CustomerFlagType | null>(null);

  function initFlags(): Record<CustomerFlagType, FlagState> {
    const state = {} as Record<CustomerFlagType, FlagState>;
    for (const ft of CUSTOMER_FLAG_TYPES) {
      state[ft] = { enabled: false, notes: '', competitorName: '' };
    }
    return state;
  }

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/customer-flags`);
      if (res.ok) {
        const data = await res.json();
        const newState = initFlags();
        for (const f of data.flags) {
          const ft = f.flagType as CustomerFlagType;
          if (newState[ft]) {
            newState[ft] = {
              enabled: true,
              notes: f.notes || '',
              competitorName: f.competitorName || '',
              id: f.id,
            };
          }
        }
        setFlags(newState);
      }
    } catch {}
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    if (open) fetchFlags();
  }, [open, fetchFlags]);

  const handleToggle = async (flagType: CustomerFlagType) => {
    const current = flags[flagType];
    setSaving(flagType);

    try {
      if (current.enabled) {
        // Remove flag
        await fetch(`/api/properties/${propertyId}/customer-flags?flagType=${flagType}`, {
          method: 'DELETE',
        });
        setFlags(prev => ({
          ...prev,
          [flagType]: { enabled: false, notes: '', competitorName: '', id: undefined },
        }));
      } else {
        // Add flag
        const res = await fetch(`/api/properties/${propertyId}/customer-flags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flagType }),
        });
        if (res.ok) {
          const data = await res.json();
          setFlags(prev => ({
            ...prev,
            [flagType]: { enabled: true, notes: '', competitorName: '', id: data.flag?.id },
          }));
        }
      }
      onFlagsChange?.();
    } catch {}
    setSaving(null);
  };

  const handleSaveDetails = async (flagType: CustomerFlagType) => {
    const current = flags[flagType];
    if (!current.enabled) return;

    setSaving(flagType);
    try {
      await fetch(`/api/properties/${propertyId}/customer-flags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flagType,
          notes: current.notes,
          competitorName: current.competitorName,
        }),
      });
      onFlagsChange?.();
    } catch {}
    setSaving(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customer Status Flags</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {CUSTOMER_FLAG_TYPES.map((ft) => {
              const config = CUSTOMER_FLAG_CONFIG[ft];
              const Icon = ICON_MAP[config.icon];
              const state = flags[ft];
              const isSaving = saving === ft;

              return (
                <div key={ft} className="border border-gray-200 rounded-lg p-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={state.enabled}
                      onChange={() => handleToggle(ft)}
                      disabled={isSaving}
                    />
                    <span className={`inline-flex items-center gap-1.5 ${config.textColor}`}>
                      {Icon && <Icon className="w-4 h-4" />}
                      <span className="font-medium text-sm">{config.label}</span>
                    </span>
                    {isSaving && <Loader2 className="w-3 h-3 animate-spin text-gray-400 ml-auto" />}
                  </label>

                  {state.enabled && (
                    <div className="mt-2 pl-8 space-y-2">
                      {config.hasCompetitor && (
                        <input
                          type="text"
                          value={state.competitorName}
                          onChange={(e) => setFlags(prev => ({
                            ...prev,
                            [ft]: { ...prev[ft], competitorName: e.target.value },
                          }))}
                          onBlur={() => handleSaveDetails(ft)}
                          placeholder="Competitor name..."
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                        />
                      )}
                      <textarea
                        value={state.notes}
                        onChange={(e) => setFlags(prev => ({
                          ...prev,
                          [ft]: { ...prev[ft], notes: e.target.value },
                        }))}
                        onBlur={() => handleSaveDetails(ft)}
                        placeholder="Notes (optional)..."
                        rows={2}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-none focus:outline-none focus:ring-1 focus:ring-green-500"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
