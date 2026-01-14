'use client';

import { useRouter } from 'next/navigation';

interface PropertyFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    propertyKey: string;
    address: string;
    city: string;
    zip: string;
    totalParval: number;
    primaryOwner: string;
    commonName: string;
    category: string;
    subcategory: string;
    operationalStatus: string;
    enriched: boolean;
  };
}

interface PropertyListProps {
  properties: PropertyFeature[];
  isLoading?: boolean;
  viewMode?: 'panel' | 'full';
}

export default function PropertyList({
  properties,
  isLoading = false,
  viewMode = 'panel',
}: PropertyListProps) {
  const router = useRouter();

  const handlePropertyClick = (propertyKey: string) => {
    router.push(`/property/${propertyKey}`);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading properties...</p>
        </div>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-center p-8">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Properties Found</h3>
          <p className="text-sm text-gray-500">
            Try adjusting your filters or search criteria.
          </p>
        </div>
      </div>
    );
  }

  if (viewMode === 'full') {
    return (
      <div className="bg-white h-full flex flex-col">
        <div className="border-b border-gray-200 px-4 py-3 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            Properties{' '}
            <span className="text-green-600 font-normal">({properties.length})</span>
          </h2>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Address
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Common Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Subcategory
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  City
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ZIP
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Enriched
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {properties.map((feature) => {
                const p = feature.properties;
                return (
                  <tr
                    key={p.propertyKey}
                    onClick={() => handlePropertyClick(p.propertyKey)}
                    className="hover:bg-green-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                      {p.address}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {p.commonName || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {p.category || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {p.subcategory || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {p.city || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {p.zip || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {p.enriched ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          No
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white h-full flex flex-col border-l border-gray-200">
      <div className="border-b border-gray-200 px-4 py-3 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900">
          Properties{' '}
          <span className="text-green-600 font-normal">({properties.length})</span>
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {properties.map((feature) => {
          const p = feature.properties;
          return (
            <div
              key={p.propertyKey}
              onClick={() => handlePropertyClick(p.propertyKey)}
              className="border-b border-gray-100 px-4 py-3 hover:bg-green-50 cursor-pointer transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {p.commonName || p.address}
                  </p>
                  {p.commonName && (
                    <p className="text-xs text-gray-500 truncate">{p.address}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {p.category && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {p.category}
                      </span>
                    )}
                    {p.subcategory && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs text-gray-500">
                        {p.subcategory}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 ml-2">
                  {p.enriched ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Enriched
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                      Pending
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
