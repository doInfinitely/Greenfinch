'use client';

import { useState, useEffect } from 'react';
import { Search, Plus, User, Mail, Phone, Linkedin, Loader2, ArrowLeft, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { useToast } from '@/hooks/use-toast';
import { ROLE_LABELS } from '@/lib/constants';

interface AddContactModalProps {
  propertyId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface SearchResult {
  id: string;
  fullName: string;
  email: string | null;
  title: string | null;
  photoUrl: string | null;
}

interface EnrichedContact {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  title?: string;
  linkedinUrl?: string;
  photoUrl?: string;
}

type WizardStep = 'search' | 'associate' | 'seed' | 'details';

export default function AddContactModal({
  propertyId,
  isOpen,
  onClose,
  onSuccess,
}: AddContactModalProps) {
  const { toast } = useToast();
  
  const [step, setStep] = useState<WizardStep>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const [selectedContact, setSelectedContact] = useState<SearchResult | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('');
  
  const [seedEmail, setSeedEmail] = useState('');
  const [seedLinkedin, setSeedLinkedin] = useState('');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichedData, setEnrichedData] = useState<EnrichedContact | null>(null);
  const [wasEnriched, setWasEnriched] = useState(false);
  
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  useEffect(() => {
    if (debouncedSearch.length >= 2) {
      searchContacts(debouncedSearch);
    } else {
      setSearchResults([]);
      setShowDropdown(false);
    }
  }, [debouncedSearch]);

  const resetForm = () => {
    setStep('search');
    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
    setSelectedContact(null);
    setSelectedRole('');
    setSeedEmail('');
    setSeedLinkedin('');
    setSeedError(null);
    setEnrichedData(null);
    setWasEnriched(false);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setLinkedinUrl('');
    setIsSubmitting(false);
    setError(null);
  };

  const searchContacts = async (query: string) => {
    setIsSearching(true);
    try {
      const response = await fetch(`/api/contacts/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setSearchResults(data.contacts || []);
      setShowDropdown(true);
    } catch (err) {
      console.error('Contact search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectContact = (contact: SearchResult) => {
    setSelectedContact(contact);
    setShowDropdown(false);
    setSearchQuery('');
    setStep('associate');
  };

  const handleCreateNew = () => {
    setShowDropdown(false);
    setSearchQuery('');
    setStep('seed');
  };

  const validateSeedInput = (): boolean => {
    setSeedError(null);
    
    if (!seedEmail && !seedLinkedin) {
      setSeedError('Please enter an email address or LinkedIn URL');
      return false;
    }
    
    if (seedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(seedEmail)) {
        setSeedError('Please enter a valid email address');
        return false;
      }
    }
    
    if (seedLinkedin) {
      const linkedinRegex = /linkedin\.com\/in\/[\w-]+/i;
      if (!linkedinRegex.test(seedLinkedin)) {
        setSeedError('Please enter a valid LinkedIn URL (linkedin.com/in/...)');
        return false;
      }
    }
    
    return true;
  };

  const handleEnrich = async () => {
    if (!validateSeedInput()) return;
    
    setIsEnriching(true);
    setError(null);
    
    try {
      const response = await fetch('/api/contacts/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: seedEmail || undefined,
          linkedinUrl: seedLinkedin || undefined,
        }),
      });
      
      const data = await response.json();
      
      if (data.found) {
        setEnrichedData(data);
        setWasEnriched(true);
        setFirstName(data.firstName || '');
        setLastName(data.lastName || '');
        setEmail(data.email || seedEmail || '');
        setPhone(data.phone || '');
        setLinkedinUrl(data.linkedinUrl || seedLinkedin || '');
        toast({
          title: 'Contact Found',
          description: 'Contact information was enriched from our database.',
        });
      } else {
        setWasEnriched(false);
        setEmail(seedEmail);
        setLinkedinUrl(seedLinkedin);
        toast({
          title: 'No Match Found',
          description: 'Please fill in the contact details manually.',
          variant: 'default',
        });
      }
      
      setStep('details');
    } catch (err) {
      console.error('Enrichment failed:', err);
      setError('Failed to look up contact information');
    } finally {
      setIsEnriching(false);
    }
  };

  const handleAssociate = async () => {
    if (!selectedContact || !selectedRole) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const response = await fetch('/api/contacts/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          contactId: selectedContact.id,
          role: selectedRole,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        if (response.status === 409) {
          setError('This contact is already associated with this property');
        } else {
          setError(data.error || 'Failed to add contact');
        }
        return;
      }
      
      toast({
        title: 'Contact Added',
        description: `${selectedContact.fullName} has been added to this property.`,
      });
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Associate failed:', err);
      setError('Failed to add contact to property');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!firstName || !lastName || !selectedRole) {
      setError('Please fill in all required fields');
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const response = await fetch('/api/contacts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          firstName,
          lastName,
          email: email || undefined,
          phone: phone || undefined,
          linkedinUrl: linkedinUrl || undefined,
          role: selectedRole,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        if (response.status === 409) {
          setError(`${data.error}. ${data.suggestion || ''}`);
        } else {
          setError(data.error || 'Failed to create contact');
        }
        return;
      }
      
      toast({
        title: 'Contact Created',
        description: `${firstName} ${lastName} has been added to this property.`,
      });
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Create contact failed:', err);
      setError('Failed to create contact');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderSearchStep = () => (
    <div className="space-y-4">
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search contacts by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-contact"
            autoFocus
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
          )}
        </div>
        
        {showDropdown && (
          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-64 overflow-y-auto">
            {searchResults.length > 0 ? (
              <>
                {searchResults.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => handleSelectContact(contact)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors"
                    data-testid={`contact-result-${contact.id}`}
                  >
                    <div className="flex-shrink-0 w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      {contact.photoUrl ? (
                        <img src={contact.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <User className="w-4 h-4 text-green-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{contact.fullName}</p>
                      {contact.email && (
                        <p className="text-sm text-gray-500 truncate">{contact.email}</p>
                      )}
                    </div>
                  </button>
                ))}
              </>
            ) : (
              <div className="px-4 py-3 text-sm text-gray-500">
                No contacts found
              </div>
            )}
            
            <button
              onClick={handleCreateNew}
              className="w-full flex items-center gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700 hover:bg-green-50 dark:hover:bg-green-900/20 text-left transition-colors"
              data-testid="button-create-new-contact"
            >
              <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                <Plus className="w-4 h-4 text-white" />
              </div>
              <span className="font-medium text-green-600">Create new contact</span>
            </button>
          </div>
        )}
      </div>
      
      {!showDropdown && searchQuery.length === 0 && (
        <div className="text-center py-8">
          <User className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Search for an existing contact or create a new one
          </p>
          <Button
            variant="outline"
            onClick={handleCreateNew}
            data-testid="button-create-contact-empty"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create New Contact
          </Button>
        </div>
      )}
    </div>
  );

  const renderAssociateStep = () => (
    <div className="space-y-6">
      <button
        onClick={() => {
          setSelectedContact(null);
          setStep('search');
        }}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to search
      </button>
      
      {selectedContact && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              {selectedContact.photoUrl ? (
                <img src={selectedContact.photoUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <User className="w-6 h-6 text-green-600" />
              )}
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">{selectedContact.fullName}</p>
              {selectedContact.email && (
                <p className="text-sm text-gray-500">{selectedContact.email}</p>
              )}
              {selectedContact.title && (
                <p className="text-sm text-gray-500">{selectedContact.title}</p>
              )}
            </div>
          </div>
        </div>
      )}
      
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Relationship to Property *
        </label>
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger data-testid="select-role-associate">
            <SelectValue placeholder="Select relationship type" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg">
          {error}
        </div>
      )}
      
      <Button
        onClick={handleAssociate}
        disabled={!selectedRole || isSubmitting}
        className="w-full"
        data-testid="button-add-to-property"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <Check className="w-4 h-4 mr-2" />
            Add to Property
          </>
        )}
      </Button>
    </div>
  );

  const renderSeedStep = () => (
    <div className="space-y-6">
      <button
        onClick={() => setStep('search')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to search
      </button>
      
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          New Contact Information
        </h3>
        <p className="text-sm text-gray-500">
          Enter an email or LinkedIn URL to look up contact details
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email Address
          </label>
          <Input
            type="email"
            placeholder="john@example.com"
            value={seedEmail}
            onChange={(e) => setSeedEmail(e.target.value)}
            data-testid="input-seed-email"
          />
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          <span className="text-sm text-gray-500">or</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Linkedin className="w-4 h-4" />
            LinkedIn URL
          </label>
          <Input
            type="url"
            placeholder="https://linkedin.com/in/johndoe"
            value={seedLinkedin}
            onChange={(e) => setSeedLinkedin(e.target.value)}
            data-testid="input-seed-linkedin"
          />
        </div>
      </div>
      
      {seedError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg">
          {seedError}
        </div>
      )}
      
      <Button
        onClick={handleEnrich}
        disabled={isEnriching || (!seedEmail && !seedLinkedin)}
        className="w-full"
        data-testid="button-continue-enrich"
      >
        {isEnriching ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Looking up contact...
          </>
        ) : (
          'Continue'
        )}
      </Button>
      
      <button
        onClick={() => setStep('details')}
        className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
        data-testid="button-skip-enrich"
      >
        Skip lookup and enter manually
      </button>
    </div>
  );

  const renderDetailsStep = () => (
    <div className="space-y-6">
      <button
        onClick={() => setStep('seed')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>
      
      {wasEnriched && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded-lg flex items-center gap-2">
          <Check className="w-4 h-4" />
          Contact information enriched from database
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            First Name *
          </label>
          <Input
            placeholder="John"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            data-testid="input-first-name"
          />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Last Name *
          </label>
          <Input
            placeholder="Doe"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            data-testid="input-last-name"
          />
        </div>
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Email
        </label>
        <Input
          type="email"
          placeholder="john@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="input-email"
        />
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Phone className="w-4 h-4" />
          Phone
        </label>
        <Input
          type="tel"
          placeholder="(555) 123-4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          data-testid="input-phone"
        />
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Linkedin className="w-4 h-4" />
          LinkedIn URL
        </label>
        <Input
          type="url"
          placeholder="https://linkedin.com/in/johndoe"
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
          data-testid="input-linkedin-url"
        />
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Relationship to Property *
        </label>
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger data-testid="select-role-create">
            <SelectValue placeholder="Select relationship type" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg">
          {error}
        </div>
      )}
      
      <Button
        onClick={handleCreate}
        disabled={!firstName || !lastName || !selectedRole || isSubmitting}
        className="w-full"
        data-testid="button-create-contact"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          <>
            <Plus className="w-4 h-4 mr-2" />
            Create Contact
          </>
        )}
      </Button>
    </div>
  );

  const getStepTitle = () => {
    switch (step) {
      case 'search':
        return 'Add Contact';
      case 'associate':
        return 'Add Existing Contact';
      case 'seed':
        return 'New Contact';
      case 'details':
        return 'Contact Details';
      default:
        return 'Add Contact';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getStepTitle()}</DialogTitle>
        </DialogHeader>
        
        <div className="mt-4">
          {step === 'search' && renderSearchStep()}
          {step === 'associate' && renderAssociateStep()}
          {step === 'seed' && renderSeedStep()}
          {step === 'details' && renderDetailsStep()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
