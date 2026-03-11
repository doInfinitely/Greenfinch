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
import { Loader2, ArrowDown, AlertTriangle } from 'lucide-react';

interface DowngradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tierId: string;
  onConfirm: () => void;
}

interface DowngradePreview {
  direction: string;
  effectiveDate: string | null;
  currentTier: {
    name: string;
    monthlyPriceUsd: number;
    monthlyCredits: number;
    seatsIncluded: number;
  };
  newTier: {
    name: string;
    monthlyCredits: number;
    monthlyPriceUsd: number;
    seatsIncluded: number;
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DowngradeDialog({
  open,
  onOpenChange,
  tierId,
  onConfirm,
}: DowngradeDialogProps) {
  const [preview, setPreview] = useState<DowngradePreview | null>(null);
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
      if (!res.ok) throw new Error(data.error || 'Downgrade failed');
      onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Downgrade failed');
    } finally {
      setConfirming(false);
    }
  };

  const creditsLost = preview
    ? preview.currentTier.monthlyCredits - preview.newTier.monthlyCredits
    : 0;
  const seatsLost = preview
    ? preview.currentTier.seatsIncluded - preview.newTier.seatsIncluded
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Downgrade</DialogTitle>
          <DialogDescription>
            Your plan change will take effect at the end of your current billing period.
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
              <ArrowDown className="h-5 w-5 text-amber-500" />
              <div className="text-center">
                <p className="text-sm text-muted-foreground">New</p>
                <p className="font-semibold">{preview.newTier.name}</p>
                <p className="text-sm text-muted-foreground">
                  ${(preview.newTier.monthlyPriceUsd / 100).toFixed(0)}/mo
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-gray-50 p-4 text-center">
              <p className="text-sm text-muted-foreground">Effective date</p>
              <p className="text-lg font-semibold">{formatDate(preview.effectiveDate)}</p>
            </div>

            {(creditsLost > 0 || seatsLost > 0) && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1">
                <div className="flex items-center gap-2 text-amber-800">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm font-medium">What you&apos;ll lose</span>
                </div>
                {creditsLost > 0 && (
                  <p className="text-sm text-amber-700 ml-6">
                    {creditsLost.toLocaleString()} fewer credits per month
                  </p>
                )}
                {seatsLost > 0 && (
                  <p className="text-sm text-amber-700 ml-6">
                    {seatsLost} fewer seat{seatsLost > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              You&apos;ll keep your current plan until the end of this billing period. You can cancel this change at any time before then.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || confirming || !!error}
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Scheduling...
              </>
            ) : (
              'Confirm Downgrade'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
