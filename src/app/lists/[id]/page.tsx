'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface ListDetail {
  id: string;
  userId: string | null;
  listName: string;
  listType: string;
  createdAt: string;
  itemCount: number;
}

interface ListItem {
  id: string;
  itemId: string;
  addedAt: string;
}

interface PropertyInfo {
  id: string;
  validatedAddress?: string;
  regridAddress?: string;
  city?: string;
  state?: string;
  assetCategory?: string;
}

interface ContactInfo {
  id: string;
  fullName?: string;
  email?: string;
  title?: string;
  employerName?: string;
}

export default function ListDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [list, setList] = useState<ListDetail | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [propertyDetails, setPropertyDetails] = useState<Record<string, PropertyInfo>>({});
  const [contactDetails, setContactDetails] = useState<Record<string, ContactInfo>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingItem, setRemovingItem] = useState<string | null>(null);

  useEffect(() => {
    fetchList();
  }, [id]);

  const fetchList = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/lists/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('List not found');
        } else {
          setError('Failed to load list');
        }
        return;
      }
      const data = await response.json();
      setList(data.list);
      setItems(data.items || []);
      
      if (data.items && data.items.length > 0) {
        if (data.list.listType === 'properties') {
          fetchPropertyDetails(data.items);
        } else if (data.list.listType === 'contacts') {
          fetchContactDetails(data.items);
        }
      }
    } catch (err) {
      setError('Failed to load list');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPropertyDetails = async (listItems: ListItem[]) => {
    const details: Record<string, PropertyInfo> = {};
    for (const item of listItems) {
      try {
        const res = await fetch(`/api/properties/${item.itemId}`);
        if (res.ok) {
          const data = await res.json();
          details[item.itemId] = data.property;
        }
      } catch {
        // Property might not exist
      }
    }
    setPropertyDetails(details);
  };

  const fetchContactDetails = async (listItems: ListItem[]) => {
    const details: Record<string, ContactInfo> = {};
    try {
      const res = await fetch('/api/contacts');
      if (res.ok) {
        const data = await res.json();
        const contactsById: Record<string, ContactInfo> = {};
        for (const contact of data.contacts || []) {
          contactsById[contact.id] = contact;
        }
        for (const item of listItems) {
          if (contactsById[item.itemId]) {
            details[item.itemId] = contactsById[item.itemId];
          }
        }
      }
    } catch {
      // Contacts might not load
    }
    setContactDetails(details);
  };

  const handleRemoveItem = async (itemId: string) => {
    setRemovingItem(itemId);
    try {
      const response = await fetch(`/api/lists/${id}/items?itemId=${itemId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to remove item');

      setItems(items.filter(item => item.itemId !== itemId));
      if (list) {
        setList({ ...list, itemCount: list.itemCount - 1 });
      }
    } catch (err) {
      setError('Failed to remove item');
    } finally {
      setRemovingItem(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (error || !list) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
          <div className="max-w-6xl mx-auto">
            <Link href="/lists" className="flex items-center space-x-2 text-gray-600 hover:text-gray-900">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Lists</span>
            </Link>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{error || 'List not found'}</h2>
          <p className="text-gray-500 mb-4">The list you're looking for doesn't exist or has been deleted.</p>
          <Link
            href="/lists"
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            Go to My Lists
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 max-w-6xl mx-auto">
          <div className="flex items-center space-x-2 sm:space-x-4 overflow-x-auto">
            <Link href="/lists" className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>My Lists</span>
            </Link>
            <span className="text-gray-300 hidden sm:inline">/</span>
            <span className="font-medium text-gray-900 truncate">{list.listName}</span>
          </div>
          <span className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-full w-fit">
            {list.listType}
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="bg-white rounded-lg border border-gray-200 mb-6 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{list.listName}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {list.itemCount} item{list.itemCount !== 1 ? 's' : ''} · Created {formatDate(list.createdAt)}
              </p>
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No items yet</h3>
            <p className="text-gray-500 mb-4">
              {list.listType === 'properties'
                ? 'Add properties to this list from the property detail page.'
                : 'Add contacts to this list from the contacts page.'}
            </p>
            <Link
              href={list.listType === 'properties' ? '/dashboard' : '/contacts'}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              {list.listType === 'properties' ? 'Browse Properties' : 'Browse Contacts'}
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {list.listType === 'properties' ? (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Address
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                        City
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                        Category
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                        Email
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                        Company
                      </th>
                    </>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                    Added
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.map((item) => {
                  const propDetail = propertyDetails[item.itemId];
                  const contactDetail = contactDetails[item.itemId];

                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      {list.listType === 'properties' ? (
                        <>
                          <td className="px-4 py-3">
                            {propDetail ? (
                              <Link
                                href={`/property/${item.itemId}`}
                                className="text-green-600 hover:underline font-medium"
                              >
                                {propDetail.validatedAddress || propDetail.regridAddress || 'Unknown Address'}
                              </Link>
                            ) : (
                              <span className="text-gray-400">Loading...</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                            {propDetail ? `${propDetail.city || ''}, ${propDetail.state || ''}` : '-'}
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                            {propDetail?.assetCategory || '-'}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {contactDetail?.fullName || item.itemId}
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                            {contactDetail?.email || '-'}
                          </td>
                          <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                            {contactDetail?.employerName || '-'}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-gray-500 text-sm hidden sm:table-cell">
                        {formatDate(item.addedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRemoveItem(item.itemId)}
                          disabled={removingItem === item.itemId}
                          className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                        >
                          {removingItem === item.itemId ? 'Removing...' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
