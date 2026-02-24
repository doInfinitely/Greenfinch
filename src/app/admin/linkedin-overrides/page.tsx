'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { ExternalLink, CheckCircle, X, Edit2 } from 'lucide-react';

interface Override {
  id: string;
  fullName: string;
  email: string | null;
  employerName: string | null;
  linkedinUrl: string | null;
  linkedinRejectedUrl: string;
  linkedinRejectedSource: string | null;
}

export default function LinkedInOverridesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [customUrls, setCustomUrls] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ success: boolean; data: Override[] }>({
    queryKey: ['/api/admin/linkedin-overrides'],
  });

  const overrides = data?.data ?? [];

  const action = useMutation({
    mutationFn: async ({ contactId, act, linkedinUrl }: { contactId: string; act: string; linkedinUrl?: string }) => {
      const res = await fetch('/api/admin/linkedin-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, action: act, linkedinUrl }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      return json;
    },
    onSuccess: (_, { act }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/linkedin-overrides'] });
      const labels: Record<string, string> = { approve: 'Approved', set: 'Set', dismiss: 'Dismissed' };
      toast({ title: labels[act] || 'Done' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const sourceLabel = (src: string | null) => {
    if (!src) return '—';
    const map: Record<string, string> = { pdl: 'PDL', findymail: 'Findymail', crustdata: 'Crustdata', historical_cleanup: 'Cleanup' };
    return map[src] ?? src;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">LinkedIn URL Overrides</h1>
        <p className="text-sm text-gray-500 mt-1">Review contacts where the LinkedIn slug validator rejected a URL. Approve, set a custom URL, or dismiss.</p>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : overrides.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle className="mx-auto h-10 w-10 mb-3 text-green-400" />
          <p className="font-medium">No rejected LinkedIn URLs pending review</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Rejected URL</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {overrides.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.fullName}</td>
                  <td className="px-4 py-3 text-gray-600">{row.email || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{row.employerName || '—'}</td>
                  <td className="px-4 py-3">
                    <a
                      href={row.linkedinRejectedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline flex items-center gap-1 max-w-xs truncate"
                    >
                      {row.linkedinRejectedUrl.replace('https://www.linkedin.com/in/', '')}
                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">{sourceLabel(row.linkedinRejectedSource)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {editingId === row.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            className="h-7 text-xs w-64"
                            placeholder="https://linkedin.com/in/..."
                            value={customUrls[row.id] ?? ''}
                            onChange={(e) => setCustomUrls(p => ({ ...p, [row.id]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              action.mutate({ contactId: row.id, act: 'set', linkedinUrl: customUrls[row.id] });
                              setEditingId(null);
                            }}
                          >Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            data-testid={`btn-approve-${row.id}`}
                            onClick={() => action.mutate({ contactId: row.id, act: 'approve' })}
                            disabled={action.isPending}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />Approve Anyway
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            data-testid={`btn-set-${row.id}`}
                            onClick={() => { setEditingId(row.id); setCustomUrls(p => ({ ...p, [row.id]: '' })); }}
                          >
                            <Edit2 className="h-3 w-3 mr-1" />Set Custom URL
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-gray-500"
                            data-testid={`btn-dismiss-${row.id}`}
                            onClick={() => action.mutate({ contactId: row.id, act: 'dismiss' })}
                            disabled={action.isPending}
                          >
                            <X className="h-3 w-3 mr-1" />Dismiss
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
