'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MAX_DESCRIPTION_LENGTH = 2000;

interface DataIssueDialogProps {
  entityType: 'contact' | 'property';
  entityId: string;
  entityLabel: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export default function DataIssueDialog({ entityType, entityId, entityLabel, onClose, onSubmitted }: DataIssueDialogProps) {
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const safeClose = useCallback(() => {
    if (!isSubmitting) onClose();
  }, [isSubmitting, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') safeClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [safeClose]);

  const handleSubmit = async () => {
    const trimmed = description.trim();
    if (trimmed.length < 5) {
      setMessage({ type: 'error', text: 'Please describe the issue in at least a few words.' });
      return;
    }
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      setMessage({ type: 'error', text: `Description is too long (max ${MAX_DESCRIPTION_LENGTH} characters).` });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/data-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType,
          contactId: entityType === 'contact' ? entityId : undefined,
          propertyId: entityType === 'property' ? entityId : undefined,
          issueDescription: trimmed,
        }),
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Thank you! Your report has been submitted.' });
        setTimeout(() => {
          onSubmitted?.();
          onClose();
        }, 1500);
      } else {
        const data = await response.json().catch(() => ({}));
        setMessage({ type: 'error', text: data.error || 'Failed to submit. Please try again.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to submit. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={safeClose}>
      <div
        className="bg-white rounded-md shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Flag className="w-5 h-5 text-amber-600" />
            <h3 className="text-lg font-semibold text-gray-900">Report Data Issue</h3>
          </div>
          <button
            onClick={safeClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isSubmitting}
            data-testid="button-close-data-issue"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-1">
          {entityType === 'contact' ? 'Contact' : 'Property'}: <span className="font-medium text-gray-800">{entityLabel}</span>
        </p>
        <p className="text-sm text-gray-500 mb-4">
          Describe what's wrong — for example, incorrect email, phone number, employer, property manager, owner info, or anything else that looks off.
        </p>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
          placeholder="e.g. The email address is no longer valid, they left the company..."
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-green-500 focus:border-green-500 text-sm"
          data-testid="input-data-issue-description"
          autoFocus
        />
        {description.length > MAX_DESCRIPTION_LENGTH - 200 && (
          <p className="text-xs text-gray-400 mt-1 text-right" data-testid="text-char-count">
            {description.length}/{MAX_DESCRIPTION_LENGTH}
          </p>
        )}

        {message && (
          <div
            className={`mt-3 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
            data-testid="text-data-issue-message"
          >
            {message.text}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-4">
          <Button
            variant="outline"
            onClick={safeClose}
            disabled={isSubmitting}
            data-testid="button-cancel-data-issue"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || description.trim().length < 5}
            className="bg-amber-600 text-white"
            data-testid="button-submit-data-issue"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Report'}
          </Button>
        </div>
      </div>
    </div>
  );
}
