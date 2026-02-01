'use client';

import { Skeleton } from '@/components/ui/skeleton';

interface PageSkeletonProps {
  variant?: 'table' | 'cards' | 'detail' | 'dashboard';
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border bg-muted">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-border/50">
          <Skeleton className="h-4 w-4" />
          <div className="flex-1">
            <Skeleton className="h-4 w-64 mb-2" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between mb-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-48 mb-2" />
          <Skeleton className="h-3 w-36 mb-4" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-5 w-24 mb-4" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-5 w-32 mb-4" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-5 w-28 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32 mb-1" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-80" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <TableSkeleton rows={8} />
    </div>
  );
}

export function ListPageSkeleton() {
  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-6 w-32 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-80" />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <TableSkeleton rows={12} />
      </div>
    </div>
  );
}

export function ContactCardSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 flex items-center gap-4">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-32 mb-1" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function PipelineBoardSkeleton() {
  return (
    <div className="flex gap-4 p-6 overflow-x-auto">
      {Array.from({ length: 5 }).map((_, colIndex) => (
        <div key={colIndex} className="flex-shrink-0 w-72">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-8" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, cardIndex) => (
              <div key={cardIndex} className="rounded-lg border border-border bg-card p-3">
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-3 w-3/4 mb-3" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PageSkeleton({ variant = 'table' }: PageSkeletonProps) {
  switch (variant) {
    case 'cards':
      return <CardGridSkeleton />;
    case 'detail':
      return <DetailPageSkeleton />;
    case 'dashboard':
      return <DashboardSkeleton />;
    case 'table':
    default:
      return <ListPageSkeleton />;
  }
}
