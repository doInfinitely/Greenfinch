'use client';

function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className || ''}`} />;
}

export default function ContactDetailSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50" data-testid="skeleton-contact-detail">
      <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
        <Bone className="h-5 w-12 mb-4" />

        <div className="flex flex-col gap-4 mb-6">
          <div className="flex items-start gap-4">
            <Bone className="h-20 w-20 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <Bone className="h-7 w-48" />
              <Bone className="h-5 w-36" />
              <Bone className="h-4 w-28" />
              <div className="flex items-center gap-2 mt-1">
                <Bone className="h-4 w-32" />
                <Bone className="h-4 w-24" />
              </div>
              <div className="flex gap-2 mt-2">
                <Bone className="h-5 w-5 rounded-full" />
                <Bone className="h-5 w-5 rounded-full" />
                <Bone className="h-5 w-5 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <Bone className="h-9 w-36 rounded-md" />
          <Bone className="h-9 w-32 rounded-md" />
          <Bone className="h-9 w-28 rounded-md" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
            <Bone className="h-5 w-36 mb-3" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Bone className="h-5 w-5 rounded" />
                <div className="flex-1 space-y-1">
                  <Bone className="h-3 w-16" />
                  <Bone className="h-4 w-44" />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <Bone className="h-5 w-40 mb-4" />
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-lg space-y-2">
                    <Bone className="h-4 w-48" />
                    <Bone className="h-3 w-32" />
                    <Bone className="h-6 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <Bone className="h-5 w-32 mb-4" />
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-lg space-y-2">
                    <Bone className="h-4 w-36" />
                    <Bone className="h-3 w-28" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
