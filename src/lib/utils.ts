import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrencyCompact(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

export function formatCurrencyFull(value: number | string): string {
  const num = typeof value === 'string' ? parseInt(value, 10) : value;
  if (isNaN(num)) return typeof value === 'string' ? value : '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatLotSize(sqft: number | null): string {
  if (!sqft) return '-';
  const acres = sqft / 43560;
  return `${acres.toFixed(1)} ac`;
}

export function formatBuildingSqft(sqft: number | null): string {
  if (!sqft) return '-';
  if (sqft >= 1000) {
    const k = sqft / 1000;
    return sqft < 19000 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
  }
  return sqft.toString();
}
