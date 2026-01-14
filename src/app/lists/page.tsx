'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';

interface List {
  id: string;
  listName: string;
  listType: string;
  createdAt: string;
  itemCount: number;
}

export default function ListsPage() {
  const [lists, setLists] = useState<List[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'properties' | 'contacts'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListType, setNewListType] = useState<'properties' | 'contacts'>('properties');
  const [isCreating, setIsCreating] = useState(false);
  const [editingList, setEditingList] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetchLists();
  }, []);

  const fetchLists = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/lists');
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

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listName: newListName.trim(),
          listType: newListType,
        }),
      });

      if (!response.ok) throw new Error('Failed to create list');

      await fetchLists();
      setNewListName('');
      setShowCreateModal(false);
    } catch (err) {
      setError('Failed to create list');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRenameList = async (listId: string) => {
    if (!editName.trim()) return;

    try {
      const response = await fetch(`/api/lists/${listId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listName: editName.trim() }),
      });

      if (!response.ok) throw new Error('Failed to rename list');

      await fetchLists();
      setEditingList(null);
      setEditName('');
    } catch (err) {
      setError('Failed to rename list');
    }
  };

  const handleDeleteList = async (listId: string) => {
    if (!confirm('Are you sure you want to delete this list? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/lists/${listId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete list');

      await fetchLists();
    } catch (err) {
      setError('Failed to delete list');
    }
  };

  const filteredLists = lists.filter((list) => {
    if (activeTab === 'all') return true;
    return list.listType === activeTab;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isAuthenticated === false) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-6xl mx-auto px-6 py-8">
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Sign in to view your lists</h2>
            <p className="text-gray-500 mb-6">Create and manage your property and contact lists.</p>
            <button
              onClick={() => window.location.href = '/api/login'}
              className="px-6 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Sign in with Replit
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">My Lists</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            + New List
          </button>
        </div>
        <div className="flex items-center space-x-4 mb-6">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'all'
                ? 'bg-green-100 text-green-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            All Lists
          </button>
          <button
            onClick={() => setActiveTab('properties')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'properties'
                ? 'bg-green-100 text-green-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Properties
          </button>
          <button
            onClick={() => setActiveTab('contacts')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'contacts'
                ? 'bg-green-100 text-green-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Contacts
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
          </div>
        ) : filteredLists.length === 0 ? (
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No lists yet</h3>
            <p className="text-gray-500 mb-4">Create your first list to start organizing your saved items.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Create List
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredLists.map((list) => (
              <div
                key={list.id}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                {editingList === list.id ? (
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-3 py-1 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameList(list.id);
                        if (e.key === 'Escape') {
                          setEditingList(null);
                          setEditName('');
                        }
                      }}
                    />
                    <button
                      onClick={() => handleRenameList(list.id)}
                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        setEditingList(null);
                        setEditName('');
                      }}
                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between mb-3">
                    <Link href={`/lists/${list.id}`} className="flex-1">
                      <h3 className="font-medium text-gray-900 hover:text-green-600 transition-colors">{list.listName}</h3>
                      <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded mt-1">
                        {list.listType}
                      </span>
                    </Link>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingList(list.id);
                          setEditName(list.listName);
                        }}
                        className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                        title="Rename"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteList(list.id);
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}

                <Link href={`/lists/${list.id}`} className="block">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">
                      {list.itemCount} item{list.itemCount !== 1 ? 's' : ''}
                    </span>
                    <span className="text-gray-400">
                      {formatDate(list.createdAt)}
                    </span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Create New List</h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewListName('');
                }}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateList} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  List Name
                </label>
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Enter list name..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  List Type
                </label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="listType"
                      value="properties"
                      checked={newListType === 'properties'}
                      onChange={(e) => setNewListType(e.target.value as 'properties' | 'contacts')}
                      className="mr-2 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-700">Properties</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="listType"
                      value="contacts"
                      checked={newListType === 'contacts'}
                      onChange={(e) => setNewListType(e.target.value as 'properties' | 'contacts')}
                      className="mr-2 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-700">Contacts</span>
                  </label>
                </div>
              </div>
              <div className="flex space-x-2 pt-2">
                <button
                  type="submit"
                  disabled={isCreating || !newListName.trim()}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isCreating ? 'Creating...' : 'Create List'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewListName('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
