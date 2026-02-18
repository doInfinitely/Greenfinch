'use client';

function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className || ''}`} />;
}

export default function PropertyDetailSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50" data-testid="skeleton-property-detail">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <Bone className="h-5 w-16" />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <Bone className="h-7 w-64" />
                  <Bone className="h-5 w-48" />
                  <Bone className="h-4 w-32" />
                  <div className="flex gap-2 mt-3">
                    <Bone className="h-6 w-20 rounded-full" />
                    <Bone className="h-6 w-24 rounded-full" />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Bone className="h-9 w-24 rounded-md" />
                  <Bone className="h-9 w-9 rounded-md" />
                  <Bone className="h-9 w-9 rounded-md" />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-6">
                <Bone className="h-9 w-28 rounded-md" />
                <Bone className="h-9 w-28 rounded-md" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <Bone className="h-4 w-16" />
                    <Bone className="h-6 w-24" />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <Bone className="h-5 w-48 mb-4" />
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <Bone className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Bone className="h-4 w-40" />
                      <Bone className="h-3 w-28" />
                    </div>
                    <Bone className="h-6 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <Bone className="h-5 w-32 mb-4" />
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <Bone className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Bone className="h-4 w-36" />
                      <Bone className="h-3 w-24" />
                    </div>
                    <div className="flex gap-1">
                      <Bone className="h-5 w-5 rounded-full" />
                      <Bone className="h-5 w-5 rounded-full" />
                      <Bone className="h-5 w-5 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <Bone className="h-64 w-full rounded-none" />
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-3">
              <Bone className="h-5 w-36 mb-3" />
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex justify-between">
                  <Bone className="h-4 w-28" />
                  <Bone className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
