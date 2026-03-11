'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RefreshCw, ChevronDown, ChevronUp, Clock, User, MessageCircle } from 'lucide-react';
import Link from 'next/link';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface Ticket {
  id: string;
  clerkOrgId: string;
  userId: string;
  subject: string;
  transcript: ChatMessage[];
  userSummary: string | null;
  aiSummary: string | null;
  status: string;
  priority: string | null;
  assignedTo: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  userName: string;
  userEmail: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved: 'bg-green-100 text-green-800',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-orange-100 text-orange-700',
  high: 'bg-red-100 text-red-700',
};

export default function SupportTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingResolution, setEditingResolution] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/support-tickets');
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const updateTicket = async (ticketId: string, updates: Record<string, unknown>) => {
    setSaving(ticketId);
    try {
      const res = await fetch('/api/admin/support-tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, ...updates }),
      });
      if (res.ok) {
        const data = await res.json();
        setTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? { ...t, ...data.ticket } : t)),
        );
      }
    } catch {
      // ignore
    }
    setSaving(null);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Support Tickets</h1>
          <Badge variant="secondary">{tickets.length}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTickets} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && tickets.length === 0 ? (
        <div className="text-center text-gray-500 py-12">Loading tickets...</div>
      ) : tickets.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          <MessageCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p>No support tickets yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const isExpanded = expandedId === ticket.id;
            return (
              <div key={ticket.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                {/* Ticket header row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : ticket.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{ticket.subject}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <User className="w-3 h-3" />
                        <span>{ticket.userName?.trim() || ticket.userEmail || 'Unknown'}</span>
                        <Clock className="w-3 h-3 ml-2" />
                        <span>{formatDate(ticket.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={PRIORITY_COLORS[ticket.priority || 'medium']}>
                        {ticket.priority || 'medium'}
                      </Badge>
                      <Badge className={STATUS_COLORS[ticket.status]}>
                        {ticket.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400 ml-2" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400 ml-2" />
                  )}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-200 px-4 py-4 space-y-4">
                    {/* AI Summary */}
                    {ticket.aiSummary && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">AI Summary</p>
                        <p className="text-sm text-gray-700 bg-gray-50 rounded p-2">{ticket.aiSummary}</p>
                      </div>
                    )}

                    {/* User Summary */}
                    {ticket.userSummary && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">User Description</p>
                        <p className="text-sm text-gray-700">{ticket.userSummary}</p>
                      </div>
                    )}

                    {/* Transcript */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Chat Transcript</p>
                      <div className="max-h-60 overflow-y-auto space-y-2 bg-gray-50 rounded-lg p-3">
                        {Array.isArray(ticket.transcript) &&
                          ticket.transcript.map((msg: ChatMessage, i: number) => (
                            <div
                              key={i}
                              className={`text-sm ${
                                msg.role === 'user' ? 'text-blue-800' : 'text-gray-600'
                              }`}
                            >
                              <span className="font-medium">
                                {msg.role === 'user' ? 'User' : 'AI'}:
                              </span>{' '}
                              {msg.content}
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-4 items-start pt-2 border-t border-gray-100">
                      {/* Status */}
                      <div>
                        <label className="text-xs font-semibold text-gray-500 block mb-1">Status</label>
                        <select
                          value={ticket.status}
                          onChange={(e) => updateTicket(ticket.id, { status: e.target.value })}
                          disabled={saving === ticket.id}
                          className="text-sm border border-gray-300 rounded px-2 py-1"
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </div>

                      {/* Priority */}
                      <div>
                        <label className="text-xs font-semibold text-gray-500 block mb-1">Priority</label>
                        <select
                          value={ticket.priority || 'medium'}
                          onChange={(e) => updateTicket(ticket.id, { priority: e.target.value })}
                          disabled={saving === ticket.id}
                          className="text-sm border border-gray-300 rounded px-2 py-1"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>

                      {/* Resolution */}
                      <div className="flex-1 min-w-[200px]">
                        <label className="text-xs font-semibold text-gray-500 block mb-1">Resolution Notes</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editingResolution[ticket.id] ?? ticket.resolution ?? ''}
                            onChange={(e) =>
                              setEditingResolution((prev) => ({
                                ...prev,
                                [ticket.id]: e.target.value,
                              }))
                            }
                            placeholder="Add resolution notes..."
                            className="flex-1 text-sm border border-gray-300 rounded px-2 py-1"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saving === ticket.id}
                            onClick={() =>
                              updateTicket(ticket.id, {
                                resolution: editingResolution[ticket.id] ?? ticket.resolution,
                              })
                            }
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
