'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { CANCELLATION_REASONS, type CancellationReason } from '@/lib/plan-config';

type Step = 'survey' | 'retention' | 'confirm';

interface CancelSubscriptionFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodEndDate: string | null;
  onComplete: () => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'the end of your billing period';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function CancelSubscriptionFlow({
  open,
  onOpenChange,
  periodEndDate,
  onComplete,
}: CancelSubscriptionFlowProps) {
  const [step, setStep] = useState<Step>('survey');
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [feedback, setFeedback] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);

  const resetState = () => {
    setStep('survey');
    setReason('');
    setFeedback('');
    setConfirming(false);
    setShowFinalConfirm(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  const handleSurveyNext = () => {
    if (!reason) return;
    setStep('retention');
  };

  const handleRetentionContinue = () => {
    setStep('confirm');
  };

  const handleConfirmCancel = () => {
    setShowFinalConfirm(true);
  };

  const handleFinalConfirm = async () => {
    setConfirming(true);
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          feedback: feedback || null,
          retentionOfferShown: true,
          retentionOfferAccepted: false,
          immediate: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cancellation failed');
      onComplete();
      handleOpenChange(false);
    } catch {
      // Error handled by parent re-fetch
    } finally {
      setConfirming(false);
      setShowFinalConfirm(false);
    }
  };

  return (
    <>
      <Dialog open={open && !showFinalConfirm} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          {step === 'survey' && (
            <>
              <DialogHeader>
                <DialogTitle>We&apos;re sorry to see you go</DialogTitle>
                <DialogDescription>
                  Please let us know why you&apos;re canceling so we can improve.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-2">
                <Label className="text-sm font-medium">Reason for canceling</Label>
                <div className="space-y-2">
                  {CANCELLATION_REASONS.map((r) => (
                    <label
                      key={r.value}
                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        reason === r.value ? 'border-primary bg-primary/5' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="cancel-reason"
                        value={r.value}
                        checked={reason === r.value}
                        onChange={() => setReason(r.value)}
                        className="accent-primary"
                      />
                      <span className="text-sm">{r.label}</span>
                    </label>
                  ))}
                </div>

                <div className="pt-2">
                  <Label htmlFor="cancel-feedback" className="text-sm font-medium">
                    Additional feedback (optional)
                  </Label>
                  <Textarea
                    id="cancel-feedback"
                    placeholder="Tell us more about your experience..."
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    className="mt-1.5"
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Never Mind
                </Button>
                <Button onClick={handleSurveyNext} disabled={!reason}>
                  Continue
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 'retention' && (
            <>
              <DialogHeader>
                <DialogTitle>We&apos;d hate to see you go!</DialogTitle>
                <DialogDescription>
                  Before you cancel, consider these options.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="rounded-lg border bg-blue-50 border-blue-200 p-4 text-center space-y-2">
                  <p className="font-medium text-blue-900">
                    Need help getting more value?
                  </p>
                  <p className="text-sm text-blue-700">
                    Our team can help you optimize your workflow and get the most out of your plan.
                    Reach out to us at support@greenfinch.ai.
                  </p>
                </div>

                {reason === 'too_expensive' && (
                  <div className="rounded-lg border bg-green-50 border-green-200 p-4 text-center space-y-2">
                    <p className="font-medium text-green-900">
                      Consider downgrading instead
                    </p>
                    <p className="text-sm text-green-700">
                      You can switch to a lower tier and keep access to core features at a lower price.
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Keep My Subscription
                </Button>
                <Button variant="destructive" onClick={handleRetentionContinue}>
                  Continue Canceling
                </Button>
              </DialogFooter>
            </>
          )}

          {step === 'confirm' && (
            <>
              <DialogHeader>
                <DialogTitle>Confirm Cancellation</DialogTitle>
                <DialogDescription>
                  Your subscription will remain active until the end of your current billing period.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4">
                <div className="rounded-lg border bg-gray-50 p-4 text-center">
                  <p className="text-sm text-muted-foreground">Access ends on</p>
                  <p className="text-lg font-semibold">{formatDate(periodEndDate)}</p>
                </div>
                <p className="text-sm text-muted-foreground text-center mt-3">
                  You can reactivate your subscription at any time before this date.
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Keep My Subscription
                </Button>
                <Button variant="destructive" onClick={handleConfirmCancel}>
                  Cancel Subscription
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Final confirmation AlertDialog */}
      <AlertDialog open={showFinalConfirm} onOpenChange={setShowFinalConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              Your subscription will be canceled at the end of your current billing period
              ({formatDate(periodEndDate)}). You can reactivate before then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>Go Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleFinalConfirm}
              disabled={confirming}
            >
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Canceling...
                </>
              ) : (
                'Yes, Cancel My Subscription'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
