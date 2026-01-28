'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, User, Mail, Building2, CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react';

interface ProviderResult {
  provider: string;
  success: boolean;
  data?: any;
  error?: string;
  latency: number;
  raw?: any;
}

function ResultCard({ result, showRaw }: { result: ProviderResult; showRaw: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={result.success ? 'border-green-500/30' : 'border-red-500/30'}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            {result.success ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            {result.provider}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              {result.latency}ms
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {result.success && result.data ? (
          <div className="space-y-2 text-sm">
            {Object.entries(result.data).map(([key, value]) => {
              if (value === null || value === undefined) return null;
              return (
                <div key={key} className="flex justify-between gap-4">
                  <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                  <span className="font-medium text-right truncate max-w-[200px]" title={String(value)}>
                    {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-red-500">{result.error || 'No data returned'}</p>
        )}
        
        {showRaw && result.raw && (
          <div className="mt-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setExpanded(!expanded)}
              data-testid={`btn-toggle-raw-${result.provider.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {expanded ? 'Hide' : 'Show'} Raw Response
            </Button>
            {expanded && (
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-60">
                {JSON.stringify(result.raw, null, 2)}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PersonEnrichment() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [domain, setDomain] = useState('');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, ProviderResult> | null>(null);
  const [totalLatency, setTotalLatency] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResults(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/compare/person', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, domain, title, location }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || `Request failed with status ${response.status}`);
        return;
      }
      setResults(data.results);
      setTotalLatency(data.totalLatency);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Person Enrichment Comparison</CardTitle>
          <CardDescription>
            Compare person enrichment results from PDL, EnrichLayer, and Hunter.io
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  required
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Smith"
                  data-testid="input-last-name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Company Domain</Label>
                <Input
                  id="domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="company.com"
                  data-testid="input-domain"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="CEO"
                  data-testid="input-title"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Dallas, TX"
                data-testid="input-location"
              />
            </div>
            <Button type="submit" disabled={loading || !firstName} data-testid="btn-enrich-person">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <User className="h-4 w-4 mr-2" />}
              Compare Providers
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500/30">
          <CardContent className="pt-6">
            <p className="text-sm text-red-500 flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              {error}
            </p>
          </CardContent>
        </Card>
      )}

      {results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Results</h3>
            <Badge variant="secondary">
              <Clock className="h-3 w-3 mr-1" />
              Total: {totalLatency}ms
            </Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.values(results).map((result) => (
              <ResultCard key={result.provider} result={result} showRaw={true} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmailValidation() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, ProviderResult> | null>(null);
  const [consensus, setConsensus] = useState<{ status: string; confidence: number } | null>(null);
  const [totalLatency, setTotalLatency] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResults(null);
    setConsensus(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/compare/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || `Request failed with status ${response.status}`);
        return;
      }
      setResults(data.results);
      setConsensus(data.consensus);
      setTotalLatency(data.totalLatency);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'valid':
        return <Badge className="bg-green-500">Valid</Badge>;
      case 'catch-all':
        return <Badge className="bg-yellow-500">Catch-All</Badge>;
      case 'invalid':
        return <Badge className="bg-red-500">Invalid</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email Validation Comparison</CardTitle>
          <CardDescription>
            Compare email validation results from NeverBounce and Hunter.io
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@company.com"
                required
                data-testid="input-email"
              />
            </div>
            <Button type="submit" disabled={loading || !email} data-testid="btn-validate-email">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
              Validate Email
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500/30">
          <CardContent className="pt-6">
            <p className="text-sm text-red-500 flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              {error}
            </p>
          </CardContent>
        </Card>
      )}

      {consensus && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Consensus
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {getStatusBadge(consensus.status)}
              <span className="text-sm text-muted-foreground">
                Confidence: {Math.round(consensus.confidence * 100)}%
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Provider Results</h3>
            <Badge variant="secondary">
              <Clock className="h-3 w-3 mr-1" />
              Total: {totalLatency}ms
            </Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.values(results).map((result) => (
              <ResultCard key={result.provider} result={result} showRaw={true} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyValidation() {
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, ProviderResult> | null>(null);
  const [totalLatency, setTotalLatency] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResults(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/compare/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || `Request failed with status ${response.status}`);
        return;
      }
      setResults(data.results);
      setTotalLatency(data.totalLatency);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Company Validation Comparison</CardTitle>
          <CardDescription>
            Compare company enrichment results from PDL, EnrichLayer, and Hunter.io
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="companyDomain">Company Domain *</Label>
              <Input
                id="companyDomain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="company.com"
                required
                data-testid="input-company-domain"
              />
            </div>
            <Button type="submit" disabled={loading || !domain} data-testid="btn-validate-company">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Building2 className="h-4 w-4 mr-2" />}
              Compare Providers
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500/30">
          <CardContent className="pt-6">
            <p className="text-sm text-red-500 flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              {error}
            </p>
          </CardContent>
        </Card>
      )}

      {results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Results</h3>
            <Badge variant="secondary">
              <Clock className="h-3 w-3 mr-1" />
              Total: {totalLatency}ms
            </Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.values(results).map((result) => (
              <ResultCard key={result.provider} result={result} showRaw={true} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  const { isLoaded, user } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Please sign in to access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Enrichment Provider Comparison</h1>
        <p className="text-muted-foreground">
          Compare results from different enrichment providers side-by-side
        </p>
      </div>

      <Tabs defaultValue="person" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="person" data-testid="tab-person">
            <User className="h-4 w-4 mr-2" />
            Person Enrichment
          </TabsTrigger>
          <TabsTrigger value="email" data-testid="tab-email">
            <Mail className="h-4 w-4 mr-2" />
            Email Validation
          </TabsTrigger>
          <TabsTrigger value="company" data-testid="tab-company">
            <Building2 className="h-4 w-4 mr-2" />
            Company Validation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="person">
          <PersonEnrichment />
        </TabsContent>

        <TabsContent value="email">
          <EmailValidation />
        </TabsContent>

        <TabsContent value="company">
          <CompanyValidation />
        </TabsContent>
      </Tabs>
    </div>
  );
}
