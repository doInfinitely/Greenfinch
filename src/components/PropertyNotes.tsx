'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, Calendar, CalendarDays, CalendarPlus, Clock, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { format, addDays, setHours, setMinutes } from 'date-fns';

interface Note {
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
  };
}

interface TeamMember {
  id: string;
  clerkId: string;
  email: string;
  firstName: string;
  lastName: string;
  profileImageUrl: string;
  displayName: string;
  handle: string;
}

interface PropertyAction {
  id: string;
  actionType: string;
  description: string | null;
  dueAt: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
  assignedToUserId: string;
  createdBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
  };
}

interface PropertyNotesProps {
  propertyId: string;
}

export default function PropertyNotes({ propertyId }: PropertyNotesProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [actions, setActions] = useState<PropertyAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchNotes();
    fetchActions();
    fetchTeam();
  }, [propertyId]);

  async function fetchNotes() {
    try {
      const res = await fetch(`/api/properties/${propertyId}/notes`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchActions() {
    try {
      const res = await fetch(`/api/properties/${propertyId}/actions`);
      if (res.ok) {
        const data = await res.json();
        setActions(data.actions || []);
      }
    } catch (error) {
      console.error('Error fetching actions:', error);
    }
  }

  async function fetchTeam() {
    try {
      const res = await fetch('/api/org/team');
      if (res.ok) {
        const data = await res.json();
        setTeam(data.team || []);
      }
    } catch (error) {
      console.error('Error fetching team:', error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newNote.trim()) return;

    setSubmitting(true);
    try {
      const mentionedUserIds = extractMentions(newNote);
      
      const res = await fetch(`/api/properties/${propertyId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNote, mentionedUserIds }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add note');
      }

      const data = await res.json();
      setNotes([data.note, ...notes]);
      setNewNote('');
      toast({
        title: 'Note added',
        description: mentionedUserIds.length > 0 
          ? `Your note has been saved and ${mentionedUserIds.length} team member(s) notified.`
          : 'Your note has been saved.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add note',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  function extractMentions(text: string): string[] {
    const mentionRegex = /@(\w+(?:\.\w+)*)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      const handle = match[1].toLowerCase();
      const member = team.find(m => m.handle === handle);
      if (member?.id) {
        mentions.push(member.id);
      }
    }
    return [...new Set(mentions)];
  }

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const pos = e.target.selectionStart;
    setNewNote(value);
    setCursorPosition(pos);

    const textBeforeCursor = value.slice(0, pos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ') && textAfterAt.length <= 20) {
        setMentionFilter(textAfterAt.toLowerCase());
        setShowMentionList(true);
        setMentionIndex(0);
        return;
      }
    }
    
    setShowMentionList(false);
    setMentionFilter('');
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentionList) return;

    const filteredTeam = team.filter(m => 
      m.displayName.toLowerCase().includes(mentionFilter) ||
      m.handle.includes(mentionFilter)
    );

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex(prev => Math.min(prev + 1, filteredTeam.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filteredTeam.length > 0) {
      e.preventDefault();
      insertMention(filteredTeam[mentionIndex]);
    } else if (e.key === 'Escape') {
      setShowMentionList(false);
    }
  };

  const insertMention = (member: TeamMember) => {
    const textBeforeCursor = newNote.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = newNote.slice(cursorPosition);
    
    const newText = textBeforeCursor.slice(0, lastAtIndex) + 
      `@${member.handle} ` + 
      textAfterCursor;
    
    setNewNote(newText);
    setShowMentionList(false);
    
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = lastAtIndex + member.handle.length + 2;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  async function createAction(dueAt: Date, description?: string) {
    try {
      const res = await fetch(`/api/properties/${propertyId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType: 'follow_up',
          dueAt: dueAt.toISOString(),
          description,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create follow-up');
      }

      const data = await res.json();
      setActions([data.action, ...actions]);
      setShowActionPicker(false);
      toast({
        title: 'Follow-up scheduled',
        description: `Reminder set for ${format(dueAt, 'MMM d, yyyy h:mm a')}`,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create follow-up',
        variant: 'destructive',
      });
    }
  }

  async function completeAction(actionId: string) {
    try {
      const res = await fetch(`/api/properties/${propertyId}/actions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, status: 'completed' }),
      });

      if (!res.ok) throw new Error('Failed to complete action');
      
      setActions(prev => prev.map(a => 
        a.id === actionId ? { ...a, status: 'completed', completedAt: new Date().toISOString() } : a
      ));
      toast({ title: 'Follow-up completed' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to complete follow-up', variant: 'destructive' });
    }
  }

  function handleQuickAction(type: 'tomorrow' | 'nextWeek') {
    const now = new Date();
    let dueAt: Date;
    
    if (type === 'tomorrow') {
      dueAt = setMinutes(setHours(addDays(now, 1), 9), 0);
    } else {
      dueAt = setMinutes(setHours(addDays(now, 7), 9), 0);
    }
    
    createAction(dueAt);
  }

  function handleCustomDate() {
    if (selectedDate) {
      const dueAt = setMinutes(setHours(selectedDate, 9), 0);
      createAction(dueAt);
      setCustomDateOpen(false);
      setSelectedDate(undefined);
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  function getUserInitials(firstName: string | null, lastName: string | null): string {
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  }

  function renderNoteContent(content: string) {
    const parts = content.split(/(@\w+(?:\.\w+)*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="text-blue-600 font-medium">
            {part}
          </span>
        );
      }
      return part;
    });
  }

  const filteredTeam = team.filter(m => 
    m.displayName.toLowerCase().includes(mentionFilter) ||
    m.handle.includes(mentionFilter)
  );

  const pendingActions = actions.filter(a => a.status === 'pending');

  return (
    <Card>
      <CardHeader className="pb-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-4 h-4 text-green-600" />
          </div>
          Notes
        </CardTitle>
        <Popover open={showActionPicker} onOpenChange={setShowActionPicker}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-schedule-followup">
              <Clock className="w-4 h-4 mr-1" />
              Follow-up
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2 bg-white border shadow-lg" align="end" data-testid="popover-followup-options">
            <div className="space-y-1">
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-start"
                onClick={() => handleQuickAction('tomorrow')}
                data-testid="button-followup-tomorrow"
              >
                <Calendar className="w-4 h-4 mr-2" />
                Tomorrow at 9am
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-start"
                onClick={() => handleQuickAction('nextWeek')}
                data-testid="button-followup-next-week"
              >
                <CalendarDays className="w-4 h-4 mr-2" />
                Next week at 9am
              </Button>
              <Popover open={customDateOpen} onOpenChange={setCustomDateOpen}>
                <PopoverTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start"
                    data-testid="button-followup-custom"
                  >
                    <CalendarPlus className="w-4 h-4 mr-2" />
                    Custom date...
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3 bg-white border shadow-lg" align="start">
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Select date</label>
                    <Input
                      type="date"
                      min={format(new Date(), 'yyyy-MM-dd')}
                      value={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''}
                      onChange={(e) => setSelectedDate(e.target.value ? new Date(e.target.value) : undefined)}
                      data-testid="input-custom-date"
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setCustomDateOpen(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleCustomDate} disabled={!selectedDate}>
                        Set reminder
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </PopoverContent>
        </Popover>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="card-notes">
        {pendingActions.length > 0 && (
          <div className="space-y-2 pb-3 border-b border-gray-100">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending Follow-ups</p>
            {pendingActions.map(action => (
              <div 
                key={action.id} 
                className="flex items-center justify-between gap-2 p-2 bg-yellow-50 rounded-md"
                data-testid={`action-item-${action.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                  <span className="text-sm truncate">
                    {format(new Date(action.dueAt), 'MMM d, yyyy')}
                  </span>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="flex-shrink-0 px-2"
                  onClick={() => completeAction(action.id)}
                  data-testid={`button-complete-action-${action.id}`}
                >
                  <Check className="w-4 h-4 text-green-600" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 relative">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              placeholder="Add a note... Use @ to mention team members"
              value={newNote}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              rows={3}
              data-testid="textarea-new-note"
            />
            {showMentionList && filteredTeam.length > 0 && (
              <div 
                className="absolute z-50 left-0 mt-1 w-64 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto"
                data-testid="mention-list"
              >
                {filteredTeam.slice(0, 5).map((member, idx) => (
                  <div
                    key={member.id}
                    className={`flex items-center gap-2 p-2 cursor-pointer ${idx === mentionIndex ? 'bg-accent' : 'hover-elevate'}`}
                    onClick={() => insertMention(member)}
                    data-testid={`mention-option-${member.id}`}
                  >
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={member.profileImageUrl} />
                      <AvatarFallback className="text-xs">
                        {member.displayName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{member.displayName}</p>
                      <p className="text-xs text-muted-foreground truncate">@{member.handle}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={!newNote.trim() || submitting}
            data-testid="button-add-note"
          >
            <Send className="w-4 h-4 mr-2" />
            {submitting ? 'Saving...' : 'Add Note'}
          </Button>
        </form>

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="animate-pulse flex gap-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No notes yet. Add a note to track your progress.
          </p>
        ) : (
          <div className="space-y-4 max-h-64 overflow-y-auto">
            {notes.map((note) => (
              <div key={note.id} className="flex gap-3 pb-3 border-b border-gray-100 last:border-b-0 last:pb-0">
                <Avatar className="w-8 h-8 flex-shrink-0">
                  <AvatarImage src={note.user.profileImage || undefined} />
                  <AvatarFallback className="text-xs bg-green-100 text-green-700">
                    {getUserInitials(note.user.firstName, note.user.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">
                      {note.user.firstName || 'Unknown'} {note.user.lastName || ''}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(note.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {renderNoteContent(note.content)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
