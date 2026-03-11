'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { MessageCircle, X, Minus, RotateCcw, Send, User, Bot, Loader2, LifeBuoy, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface TicketResult {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
}

function generateSessionId(): string {
  return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getStoredSessionId(): string {
  if (typeof window === 'undefined') return generateSessionId();
  const stored = localStorage.getItem('gf-support-session-id');
  if (stored) return stored;
  const id = generateSessionId();
  localStorage.setItem('gf-support-session-id', id);
  return id;
}

function setStoredSessionId(id: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('gf-support-session-id', id);
  }
}

export default function SupportChat() {
  const { isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [showEscalation, setShowEscalation] = useState(false);
  const [escalationSummary, setEscalationSummary] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [ticketCreated, setTicketCreated] = useState<TicketResult | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Initialize session
  useEffect(() => {
    if (!isSignedIn) return;
    const id = getStoredSessionId();
    setSessionId(id);
  }, [isSignedIn]);

  // Load existing session when panel opens
  useEffect(() => {
    if (!open || !sessionId || sessionLoaded) return;

    async function loadSession() {
      try {
        const res = await fetch(`/api/support-chat/session?sessionId=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.session?.messages?.length > 0) {
            setMessages(data.session.messages);
            if (data.session.escalated) {
              setTicketCreated({ id: '', subject: '', status: 'open', createdAt: '' });
            }
          }
        }
      } catch {
        // Ignore — will start fresh
      }
      setSessionLoaded(true);
    }

    loadSession();
  }, [open, sessionId, sessionLoaded]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);

    // Add placeholder for assistant
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
    setMessages((prev) => [...prev, assistantMsg]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch('/api/support-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to send message' }));
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: `Sorry, something went wrong: ${err.error || 'Unknown error'}`,
          };
          return updated;
        });
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'delta') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, content: last.content + event.text };
                return updated;
              });
            } else if (event.type === 'error') {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: `Sorry, an error occurred: ${event.error}`,
                };
                return updated;
              });
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: 'Sorry, I encountered a connection error. Please try again.',
          };
          return updated;
        });
      }
    }

    setStreaming(false);
    abortRef.current = null;
  }, [input, streaming, sessionId]);

  const handleNewChat = useCallback(async () => {
    if (streaming) {
      abortRef.current?.abort();
    }
    // Clear old session
    await fetch(`/api/support-chat/session?sessionId=${sessionId}`, { method: 'DELETE' }).catch(() => {});
    const newId = generateSessionId();
    setStoredSessionId(newId);
    setSessionId(newId);
    setMessages([]);
    setSessionLoaded(false);
    setShowEscalation(false);
    setEscalationSummary('');
    setEscalating(false);
    setTicketCreated(null);
    setStreaming(false);
  }, [sessionId, streaming]);

  const handleEscalate = useCallback(async () => {
    if (!escalationSummary.trim() || escalating) return;
    setEscalating(true);

    try {
      const res = await fetch('/api/support-chat/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userSummary: escalationSummary.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setTicketCreated(data.ticket);
        setShowEscalation(false);
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        alert(err.error || 'Failed to create ticket');
      }
    } catch {
      alert('Failed to create support ticket');
    }

    setEscalating(false);
  }, [escalationSummary, escalating, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isSignedIn) return null;

  // Determine if "Talk to a human" should be shown (after 2+ exchanges)
  const userMessageCount = messages.filter((m) => m.role === 'user').length;
  const showHumanLink = userMessageCount >= 2 && !ticketCreated;

  // Bubble only
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-green-600 hover:bg-green-700 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
        aria-label="Open support chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  // Minimized state
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-green-600 hover:bg-green-700 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
        aria-label="Expand support chat"
      >
        <MessageCircle className="w-6 h-6" />
        {messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">
            {messages.filter((m) => m.role === 'assistant').length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[400px] h-[520px] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-green-600 text-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <span className="font-semibold text-sm">Greenfinch Support</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            className="p-1.5 hover:bg-green-700 rounded transition-colors"
            title="New chat"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="p-1.5 hover:bg-green-700 rounded transition-colors"
            title="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 hover:bg-green-700 rounded transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <Bot className="w-10 h-10 mx-auto mb-3 text-green-600" />
            <p className="font-medium text-gray-700">Hi there! How can I help?</p>
            <p className="mt-1 text-xs">
              Ask me about features, navigation, enrichment, or your account.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-green-700" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.content || (streaming && i === messages.length - 1 ? (
                <span className="flex items-center gap-1 text-gray-400">
                  <span className="animate-pulse">...</span>
                </span>
              ) : null)}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-4 h-4 text-gray-600" />
              </div>
            )}
          </div>
        ))}

        {/* Ticket created confirmation */}
        {ticketCreated && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
            <div className="flex items-center gap-2 text-green-700 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Support ticket created
            </div>
            <p className="text-green-600 text-xs mt-1">
              Our team has been notified and will get back to you soon.
            </p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Escalation form */}
      {showEscalation && !ticketCreated && (
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <p className="text-xs font-medium text-gray-700 mb-2">Describe your issue for our team:</p>
          <textarea
            value={escalationSummary}
            onChange={(e) => setEscalationSummary(e.target.value)}
            placeholder="Brief description of what you need help with..."
            className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
            rows={2}
            maxLength={500}
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEscalation(false)}
              disabled={escalating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleEscalate}
              disabled={!escalationSummary.trim() || escalating}
              className="bg-green-600 hover:bg-green-700"
            >
              {escalating ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create ticket'
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Footer: input + human link */}
      <div className="border-t border-gray-200 flex-shrink-0">
        {showHumanLink && !showEscalation && (
          <button
            onClick={() => setShowEscalation(true)}
            className="w-full px-4 py-1.5 text-xs text-green-700 hover:bg-green-50 flex items-center justify-center gap-1 transition-colors"
          >
            <LifeBuoy className="w-3 h-3" />
            Talk to a human
          </button>
        )}
        <div className="flex items-end gap-2 px-3 py-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={ticketCreated ? 'Ticket created — start a new chat to continue' : 'Ask a question...'}
            disabled={streaming || !!ticketCreated}
            className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-green-500 max-h-[80px] disabled:opacity-50"
            rows={1}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!input.trim() || streaming || !!ticketCreated}
            className="bg-green-600 hover:bg-green-700 h-9 w-9 p-0"
          >
            {streaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
