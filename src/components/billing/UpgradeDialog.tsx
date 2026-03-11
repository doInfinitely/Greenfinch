'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight } from 'lucide-react';

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tierId: string;
  onConfirm: () => void;
}

interface PreviewData {
  direction: string;
  amountDue: number;
  currency: string;
  currentTier: { name: string; monthlyPriceUsd: number };
  newTier: { name: string; monthlyCredits: number; monthlyPriceUsd: number };
}

export default function UpgradeDialog({
  open,
  onOpenChange,
  tierId,
  onConfirm,
}: UpgradeDialogProps) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tierId) return;
    setLoading(true);
    setError(null);
    setPreview(null);

    fetch('/api/billing/change-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tierId, preview: true }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load preview');
        setPreview(data.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, tierId]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const res = await fetch('/api/billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upgrade failed');
      onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upgrade failed');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Upgrade</DialogTitle>
          <DialogDescription>
            Review the changes before upgrading your plan.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-sm text-red-600 py-4">{error}</div>
        ) : preview ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-center gap-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Current</p>
                <p className="font-semibold">{preview.currentTier.name}</p>
                <p className="text-sm text-muted-foreground">
                  ${(preview.currentTier.monthlyPriceUsd / 100).toFixed(0)}/mo
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm text-muted-foreground">New</p>
                <p className="font-semibold">{preview.newTier.name}</p>
                <p className="text-sm text-muted-foreground">
                  ${(preview.newTier.monthlyPriceUsd / 100).toFixed(0)}/mo
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-gray-50 p-4 text-center">
              <p className="text-sm text-muted-foreground">Prorated amount due today</p>
              <p className="text-2xl font-bold">
                ${(preview.amountDue / 100).toFixed(2)}
                {' '}
                <span className="text-sm font-normal uppercase text-muted-foreground">
                  {preview.currency}
                </span>
              </p>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              You&apos;ll be charged the prorated difference immediately. Future invoices will reflect the new plan price.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading || confirming || !!error}>
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Upgrading...
              </>
            ) : (
              'Confirm Upgrade'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
