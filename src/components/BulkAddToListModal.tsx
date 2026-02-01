'use client';

import { useState, useEffect } from 'react';
import { SignInButton } from '@clerk/nextjs';
import { useToast } from '@/hooks/use-toast';

interface List {
  id: string;
  listName: string;
  listType: string;
  itemCount: number;
}

interface BulkAddToListModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemIds: string[];
  itemType: 'properties' | 'contacts';
}

export default function BulkAddToListModal({
  isOpen,
  onClose,
  itemIds,
  itemType,
}: BulkAddToListModalProps) {
  const { toast } = useToast();
  const [lists, setLists] = useState<List[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchLists();
    }
  }, [isOpen, itemType]);

  const fetchLists = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/lists?type=${itemType}`);
      if (response.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      setIsAuthenticated(true);
      const data = await response.json();
      if (data.lists) {
        setLists(data.lists);
      }
    } catch (err) {
      setError('Failed to load lists');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddToList = async (listId: string) => {
    setIsAdding(listId);
    setError(null);
    setSuccessMessage(null);
    
    let successCount = 0;
    let alreadyExistsCount = 0;
    let errorCount = 0;
    
    for (const itemId of itemIds) {
      try {
        const response = await fetch(`/api/lists/${listId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId }),
        });

        if (response.status === 409) {
          alreadyExistsCount++;
        } else if (response.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }
    }

    setIsAdding(null);
    
    if (successCount > 0) {
      const listName = lists.find(l => l.id === listId)?.listName || 'list';
      toast({
        title: 'Added to List',
        description: `${successCount} ${itemType === 'properties' ? 'properties' : 'contacts'} added to "${listName}"${alreadyExistsCount > 0 ? ` (${alreadyExistsCount} already in list)` : ''}`,
      });
      fetchLists();
      onClose();
    } else if (alreadyExistsCount === itemIds.length) {
      setError('All items are already in this list');
    } else {
      setError('Failed to add items to list');
    }
  };

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;

    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listName: newListName.trim(),
          listType: itemType,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create list');
      }

      const data = await response.json();
      if (data.list) {
        setLists([...lists, data.list]);
        setNewListName('');
        setShowCreateForm(false);
        handleAddToList(data.list.id);
      }
    } catch (err) {
      setError('Failed to create list');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setSuccessMessage(null);
    setShowCreateForm(false);
    setNewListName('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={handleClose}
      />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Add {itemIds.length} {itemIds.length === 1 ? (itemType === 'properties' ? 'Property' : 'Contact') : (itemType === 'properties' ? 'Properties' : 'Contacts')} to List
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            data-testid="button-close-modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {isAuthenticated === false ? (
            <div className="text-center py-8">
              <svg
                className="w-12 h-12 mx-auto mb-3 text-gray-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="text-gray-600 mb-4">Sign in to save items to lists</p>
              <SignInButton mode="modal">
                <button
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                  data-testid="button-sign-in"
                >
                  Sign in
                </button>
              </SignInButton>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg">
                  {successMessage}
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                </div>
              ) : (
                <>
                  {lists.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {lists.map((list) => (
                        <button
                          key={list.id}
                          onClick={() => handleAddToList(list.id)}
                          disabled={isAdding === list.id}
                          className="w-full flex items-center justify-between p-3 text-left border border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors disabled:opacity-50"
                          data-testid={`button-list-${list.id}`}
                        >
                          <div>
                            <div className="font-medium text-gray-900">{list.listName}</div>
                            <div className="text-sm text-gray-500">{list.itemCount} items</div>
                          </div>
                          {isAdding === list.id ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
                          ) : (
                            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {showCreateForm ? (
                    <form onSubmit={handleCreateList} className="border-t border-gray-200 pt-4">
                      <input
                        type="text"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="New list name..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        autoFocus
                        data-testid="input-new-list-name"
                      />
                      <div className="flex items-center space-x-2 mt-3">
                        <button
                          type="submit"
                          disabled={!newListName.trim() || isCreating}
                          className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          data-testid="button-create-list"
                        >
                          {isCreating ? 'Creating...' : 'Create & Add'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateForm(false);
                            setNewListName('');
                          }}
                          className="px-4 py-2 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
                          data-testid="button-cancel-create"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => setShowCreateForm(true)}
                      className="w-full flex items-center justify-center space-x-2 p-3 text-green-600 border border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors"
                      data-testid="button-show-create-form"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="font-medium">Create new list</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
