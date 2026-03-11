'use client';

import Link from 'next/link';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function CreditBalanceIndicator({ collapsed }: { collapsed?: boolean }) {
  const { data: balance, isLoading } = useCreditBalance();

  if (isLoading || !balance) return null;

  const { totalAvailable, currentBalance, rolloverBalance, purchasedBalance } = balance;
  const maxCredits = totalAvailable + 100; // Show relative to current + buffer
  const usagePercent = Math.max(0, Math.min(100, (totalAvailable / Math.max(maxCredits, 1)) * 100));
  const isLow = totalAvailable > 0 && totalAvailable < 50;
  const isEmpty = totalAvailable <= 0;

  const barColor = isEmpty
    ? 'bg-red-500'
    : isLow
    ? 'bg-amber-500'
    : 'bg-green-500';

  const content = (
    <Link
      href="/billing"
      className={`block px-3 py-2 rounded-md hover:bg-gray-50 transition-colors ${
        isEmpty ? 'bg-red-50' : isLow ? 'bg-amber-50' : ''
      }`}
    >
      {!collapsed && (
        <>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Credits</span>
            <span className={`text-xs font-semibold ${isEmpty ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-foreground'}`}>
              {totalAvailable.toLocaleString()}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </>
      )}
      {collapsed && (
        <div className="flex justify-center">
          <div className={`w-2 h-2 rounded-full ${barColor}`} />
        </div>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{totalAvailable.toLocaleString()} credits</p>
          <p className="text-xs text-muted-foreground">
            {currentBalance} current + {rolloverBalance} rollover + {purchasedBalance} purchased
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
