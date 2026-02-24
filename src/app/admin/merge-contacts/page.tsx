'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowRightLeft, Merge, User, Mail, Building2, Phone, Linkedin } from 'lucide-react';

interface ContactResult {
  id: string;
  fullName: string;
  email: string | null;
  title: string | null;
  location: string | null;
  photoUrl: string | null;
}

interface ContactDetails extends ContactResult {
  employerName?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
}

function useContactSearch() {
  const [results, setResults] = useState<ContactResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(q)}&limit=8`);
      const json = await res.json();
      setResults(json.contacts ?? []);
    } finally {
      setLoading(false);
    }
  };

  return { results, loading, search, setResults };
}

function ContactCard({ contact }: { contact: ContactDetails }) {
  return (
    <div className="border rounded-lg p-4 bg-white space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
          <User className="h-4 w-4 text-green-700" />
        </div>
        <div>
          <p className="font-semibold text-gray-900">{contact.fullName}</p>
          {contact.title && <p className="text-xs text-gray-500">{contact.title}</p>}
        </div>
      </div>
      {contact.email && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Mail className="h-3.5 w-3.5" />{contact.email}
        </div>
      )}
      {contact.employerName && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Building2 className="h-3.5 w-3.5" />{contact.employerName}
        </div>
      )}
      {contact.phone && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Phone className="h-3.5 w-3.5" />{contact.phone}
        </div>
      )}
      {contact.linkedinUrl && (
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <Linkedin className="h-3.5 w-3.5" />
          <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="hover:underline truncate max-w-xs">
            {contact.linkedinUrl.replace('https://www.linkedin.com/in/', '')}
          </a>
        </div>
      )}
    </div>
  );
}

function SearchPanel({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: ContactDetails | null;
  onSelect: (c: ContactDetails) => void;
}) {
  const { results, loading, search, setResults } = useContactSearch();
  const [query, setQuery] = useState('');

  return (
    <div className="flex-1 space-y-3">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <Input
        data-testid={`input-search-contact-${label.toLowerCase().replace(' ', '-')}`}
        placeholder="Search by name or email..."
        value={query}
        onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
      />
      {loading && <p className="text-xs text-gray-400">Searching...</p>}
      {results.length > 0 && !selected && (
        <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.id}
              data-testid={`contact-result-${c.id}`}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
              onClick={async () => {
                const res = await fetch(`/api/contacts/${c.id}`);
                const json = await res.json();
                const detail = json.data ?? json.contact ?? c;
                onSelect({ ...c, ...detail });
                setResults([]);
                setQuery(c.fullName);
              }}
            >
              <span className="font-medium">{c.fullName}</span>
              {c.email && <span className="text-gray-400 ml-2 text-xs">{c.email}</span>}
              {c.title && <span className="text-gray-400 ml-2 text-xs">· {c.title}</span>}
            </button>
          ))}
        </div>
      )}
      {selected && <ContactCard contact={selected} />}
    </div>
  );
}

export default function MergeContactsPage() {
  const { toast } = useToast();
  const [left, setLeft] = useState<ContactDetails | null>(null);
  const [right, setRight] = useState<ContactDetails | null>(null);
  const [swapped, setSwapped] = useState(false);

  const keep = swapped ? right : left;
  const merge = swapped ? left : right;

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!keep || !merge) throw new Error('Select two contacts first');
      const res = await fetch('/api/admin/merge-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepContactId: keep.id, mergeContactId: merge.id }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      return json;
    },
    onSuccess: () => {
      toast({ title: 'Contacts merged successfully' });
      setLeft(null);
      setRight(null);
      setSwapped(false);
    },
    onError: (err: Error) => {
      toast({ title: 'Merge failed', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Merge Contacts</h1>
        <p className="text-sm text-gray-500 mt-1">Search and select two contacts to merge. The kept contact retains all data; the merged contact is deleted.</p>
      </div>

      <div className="flex gap-6 items-start">
        <SearchPanel label="Left Contact" selected={left} onSelect={setLeft} />

        <div className="flex flex-col items-center gap-3 pt-8">
          <Button
            variant="outline"
            size="sm"
            data-testid="btn-swap-direction"
            onClick={() => setSwapped(s => !s)}
            title="Swap keep/merge direction"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
          {keep && merge && (
            <Button
              data-testid="btn-merge-contacts"
              className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 h-auto"
              onClick={() => mergeMutation.mutate()}
              disabled={mergeMutation.isPending}
            >
              <Merge className="h-3.5 w-3.5 mr-1" />Merge
            </Button>
          )}
        </div>

        <SearchPanel label="Right Contact" selected={right} onSelect={setRight} />
      </div>

      {keep && merge && (
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <span className="font-semibold text-amber-800">Keep:</span>{' '}
          <span className="text-amber-700">{keep.fullName}</span>
          <span className="mx-3 text-amber-400">—</span>
          <span className="font-semibold text-amber-800">Delete:</span>{' '}
          <span className="text-amber-700">{merge.fullName}</span>
          <Badge
            variant="outline"
            className="ml-3 text-xs cursor-pointer border-amber-300 text-amber-700"
            onClick={() => setSwapped(s => !s)}
          >
            Swap direction
          </Badge>
        </div>
      )}
    </div>
  );
}
