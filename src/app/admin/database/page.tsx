'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Database, Play, Download, Trash2, RefreshCw, History, Eye, AlertTriangle, Settings, Plus, X } from 'lucide-react';

interface TableInfo {
  name: string;
  columnCount: number;
  rowCount: number;
  isSafe: boolean;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface AuditLog {
  id: string;
  userEmail: string | null;
  action: string;
  targetTable: string | null;
  queryText: string | null;
  rowsAffected: number | null;
  environment: string;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: { name: string; dataTypeID: number }[];
  duration: number;
}

export default function DatabaseAdminPage() {
  const { toast } = useToast();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableSchema, setTableSchema] = useState<ColumnInfo[]>([]);
  const [tablePreview, setTablePreview] = useState<{ rows: Record<string, unknown>[]; total: number } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const [query, setQuery] = useState('SELECT * FROM properties LIMIT 10;');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isRunningQuery, setIsRunningQuery] = useState(false);

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [tableToClear, setTableToClear] = useState<{ name: string; rowCount: number } | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [clearAllPreview, setClearAllPreview] = useState<{ tableCounts: { table: string; count: number }[]; totalRows: number } | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);

  const [ingestionZipCodes, setIngestionZipCodes] = useState<string[]>(['75225']);
  const [ingestionLimit, setIngestionLimit] = useState<number>(500);
  const [newZipCode, setNewZipCode] = useState('');
  const [isLoadingIngestionSettings, setIsLoadingIngestionSettings] = useState(false);
  const [isSavingIngestionSettings, setIsSavingIngestionSettings] = useState(false);

  const fetchTables = useCallback(async () => {
    setIsLoadingTables(true);
    try {
      const response = await fetch('/api/admin/database?action=tables', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch tables');
      const data = await response.json();
      setTables(data.tables || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch tables',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingTables(false);
    }
  }, [toast]);

  const fetchTableDetails = useCallback(async (tableName: string) => {
    setIsLoadingPreview(true);
    setSelectedTable(tableName);
    try {
      const [schemaRes, previewRes] = await Promise.all([
        fetch(`/api/admin/database?action=schema&table=${encodeURIComponent(tableName)}`, { credentials: 'include' }),
        fetch(`/api/admin/database?action=preview&table=${encodeURIComponent(tableName)}&limit=20`, { credentials: 'include' }),
      ]);

      if (schemaRes.ok) {
        const schemaData = await schemaRes.json();
        setTableSchema(schemaData.columns || []);
      }

      if (previewRes.ok) {
        const previewData = await previewRes.json();
        setTablePreview({ rows: previewData.rows || [], total: previewData.total || 0 });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load table details',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingPreview(false);
    }
  }, [toast]);

  const fetchAuditLogs = useCallback(async () => {
    setIsLoadingAudit(true);
    try {
      const response = await fetch('/api/admin/database?action=audit&limit=100', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch audit logs');
      const data = await response.json();
      setAuditLogs(data.logs || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch audit logs',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingAudit(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  const runQuery = async () => {
    if (!query.trim()) return;

    setIsRunningQuery(true);
    setQueryResult(null);

    try {
      const queryLower = query.toLowerCase().trim();
      const isReadOnly = queryLower.startsWith('select') || queryLower.startsWith('explain');

      const response = await fetch('/api/admin/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'query',
          query,
          confirm: !isReadOnly,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.requiresConfirmation) {
          toast({
            title: 'Confirmation Required',
            description: 'This query modifies data. Confirmation has been added.',
            variant: 'default',
          });
        } else {
          throw new Error(data.error || 'Query failed');
        }
        return;
      }

      setQueryResult(data);
      toast({
        title: 'Query Executed',
        description: `${data.rowCount} rows affected in ${data.duration}ms`,
      });

      if (!isReadOnly) {
        fetchTables();
      }
    } catch (error) {
      toast({
        title: 'Query Error',
        description: error instanceof Error ? error.message : 'Query execution failed',
        variant: 'destructive',
      });
    } finally {
      setIsRunningQuery(false);
    }
  };

  const handleClearTable = async () => {
    if (!tableToClear) return;

    setIsClearing(true);
    try {
      const response = await fetch('/api/admin/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'clear',
          table: tableToClear.name,
          confirm: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Clear failed');
      }

      toast({
        title: 'Table Cleared',
        description: `${data.rowsDeleted} rows deleted from ${tableToClear.name}`,
      });

      fetchTables();
      if (selectedTable === tableToClear.name) {
        fetchTableDetails(tableToClear.name);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to clear table',
        variant: 'destructive',
      });
    } finally {
      setIsClearing(false);
      setClearConfirmOpen(false);
      setTableToClear(null);
    }
  };

  const fetchIngestionSettings = useCallback(async () => {
    setIsLoadingIngestionSettings(true);
    try {
      const response = await fetch('/api/admin/ingestion-settings', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch ingestion settings');
      const data = await response.json();
      setIngestionZipCodes(data.zipCodes || ['75225']);
      setIngestionLimit(data.defaultLimit || 500);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch ingestion settings',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingIngestionSettings(false);
    }
  }, [toast]);

  const saveIngestionSettings = async () => {
    setIsSavingIngestionSettings(true);
    try {
      const response = await fetch('/api/admin/ingestion-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          zipCodes: ingestionZipCodes,
          defaultLimit: ingestionLimit,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save settings');

      toast({
        title: 'Settings Saved',
        description: `Ingestion will use ${data.zipCodes.length} ZIP code(s) with limit ${data.defaultLimit}`,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setIsSavingIngestionSettings(false);
    }
  };

  const addZipCode = () => {
    const trimmed = newZipCode.trim();
    if (!/^\d{5}$/.test(trimmed)) {
      toast({
        title: 'Invalid ZIP Code',
        description: 'Please enter a valid 5-digit ZIP code',
        variant: 'destructive',
      });
      return;
    }
    if (ingestionZipCodes.includes(trimmed)) {
      toast({
        title: 'Duplicate',
        description: 'This ZIP code is already in the list',
        variant: 'destructive',
      });
      return;
    }
    setIngestionZipCodes([...ingestionZipCodes, trimmed]);
    setNewZipCode('');
  };

  const removeZipCode = (zip: string) => {
    if (ingestionZipCodes.length === 1) {
      toast({
        title: 'Cannot Remove',
        description: 'At least one ZIP code is required',
        variant: 'destructive',
      });
      return;
    }
    setIngestionZipCodes(ingestionZipCodes.filter(z => z !== zip));
  };

  const handlePrepareClearAll = async () => {
    try {
      const response = await fetch('/api/admin/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'clearAll', confirm: false }),
      });

      const data = await response.json();

      if (data.requiresConfirmation) {
        setClearAllPreview({ tableCounts: data.tableCounts, totalRows: data.totalRows });
        setClearAllConfirmOpen(true);
      } else if (!response.ok) {
        throw new Error(data.error || 'Failed to prepare clear all');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to prepare clear all',
        variant: 'destructive',
      });
    }
  };

  const handleClearAllTables = async () => {
    setIsClearingAll(true);
    try {
      const response = await fetch('/api/admin/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'clearAll', confirm: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Clear all failed');
      }

      toast({
        title: 'All Tables Cleared',
        description: `${data.totalDeleted} rows deleted across ${data.results.filter((r: { success: boolean }) => r.success).length} tables`,
      });

      fetchTables();
      setSelectedTable(null);
      setTablePreview(null);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to clear all tables',
        variant: 'destructive',
      });
    } finally {
      setIsClearingAll(false);
      setClearAllConfirmOpen(false);
      setClearAllPreview(null);
    }
  };

  const handleExport = async (tableName: string) => {
    try {
      const response = await fetch(`/api/admin/database/export?table=${encodeURIComponent(tableName)}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tableName}_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: 'Export Complete',
        description: `${tableName} exported successfully`,
      });
    } catch (error) {
      toast({
        title: 'Export Error',
        description: error instanceof Error ? error.message : 'Export failed',
        variant: 'destructive',
      });
    }
  };

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') return JSON.stringify(value).substring(0, 100);
    const str = String(value);
    return str.length > 100 ? str.substring(0, 100) + '...' : str;
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center gap-3 mb-6">
        <Database className="h-8 w-8 text-green-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Database Management</h1>
          <p className="text-gray-500">View, query, and manage database tables</p>
        </div>
      </div>

      <Tabs defaultValue="explorer" className="space-y-4">
        <TabsList>
          <TabsTrigger value="explorer" data-testid="tab-explorer">
            <Eye className="h-4 w-4 mr-2" />
            Table Explorer
          </TabsTrigger>
          <TabsTrigger value="query" data-testid="tab-query">
            <Play className="h-4 w-4 mr-2" />
            Query Runner
          </TabsTrigger>
          <TabsTrigger value="audit" onClick={() => fetchAuditLogs()} data-testid="tab-audit">
            <History className="h-4 w-4 mr-2" />
            Audit Log
          </TabsTrigger>
          <TabsTrigger value="ingestion" onClick={() => fetchIngestionSettings()} data-testid="tab-ingestion">
            <Settings className="h-4 w-4 mr-2" />
            Ingestion Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="explorer" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Tables</CardTitle>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={fetchTables}
                      disabled={isLoadingTables}
                      data-testid="button-refresh-tables"
                    >
                      <RefreshCw className={`h-4 w-4 ${isLoadingTables ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handlePrepareClearAll}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      title="Clear all tables (respects FK constraints)"
                      data-testid="button-clear-all-tables"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 max-h-[600px] overflow-y-auto">
                {isLoadingTables ? (
                  <div className="p-4 text-center text-gray-500">Loading tables...</div>
                ) : (
                  <div className="divide-y">
                    {tables.map((table) => (
                      <button
                        key={table.name}
                        onClick={() => fetchTableDetails(table.name)}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center justify-between ${
                          selectedTable === table.name ? 'bg-green-50 border-l-2 border-green-600' : ''
                        }`}
                        data-testid={`button-table-${table.name}`}
                      >
                        <div>
                          <span className="font-medium text-gray-900">{table.name}</span>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="text-xs">
                              {table.rowCount.toLocaleString()} rows
                            </Badge>
                            <span className="text-xs text-gray-500">{table.columnCount} cols</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {table.isSafe && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExport(table.name);
                                }}
                                title="Export CSV"
                                data-testid={`button-export-${table.name}`}
                              >
                                <Download className="h-3.5 w-3.5 text-gray-500" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTableToClear({ name: table.name, rowCount: table.rowCount });
                                  setClearConfirmOpen(true);
                                }}
                                title="Clear table"
                                data-testid={`button-clear-${table.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                              </Button>
                            </>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  {selectedTable ? `Table: ${selectedTable}` : 'Select a table'}
                </CardTitle>
                {tablePreview && (
                  <CardDescription>
                    Showing first 20 of {tablePreview.total.toLocaleString()} rows
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {isLoadingPreview ? (
                  <div className="text-center py-8 text-gray-500">Loading table data...</div>
                ) : selectedTable && tablePreview ? (
                  <div className="space-y-4">
                    <div className="border rounded-md overflow-hidden">
                      <div className="max-h-[400px] overflow-auto">
                        <Table>
                          <TableHeader className="sticky top-0 bg-gray-50">
                            <TableRow>
                              {tableSchema.map((col) => (
                                <TableHead key={col.column_name} className="whitespace-nowrap">
                                  <div>
                                    <span className="font-medium">{col.column_name}</span>
                                    <span className="text-xs text-gray-400 ml-1">({col.data_type})</span>
                                  </div>
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tablePreview.rows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={tableSchema.length} className="text-center text-gray-500 py-8">
                                  No data in table
                                </TableCell>
                              </TableRow>
                            ) : (
                              tablePreview.rows.map((row, i) => (
                                <TableRow key={i}>
                                  {tableSchema.map((col) => (
                                    <TableCell key={col.column_name} className="max-w-[200px] truncate">
                                      {formatCellValue(row[col.column_name])}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>Select a table from the list to view its data</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="query" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>SQL Query Runner</CardTitle>
              <CardDescription>
                Execute SQL queries against the development database. Write operations require confirmation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter SQL query..."
                  className="font-mono text-sm min-h-[120px]"
                  data-testid="input-query"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={runQuery}
                  disabled={isRunningQuery || !query.trim()}
                  data-testid="button-run-query"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {isRunningQuery ? 'Running...' : 'Run Query'}
                </Button>
                <span className="text-sm text-gray-500">
                  Tip: Use SELECT queries for read-only operations
                </span>
              </div>

              {queryResult && (
                <div className="border rounded-md overflow-hidden mt-4">
                  <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Results: {queryResult.rowCount} rows ({queryResult.duration}ms)
                    </span>
                  </div>
                  <div className="max-h-[400px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white">
                        <TableRow>
                          {queryResult.fields.map((field, i) => (
                            <TableHead key={i} className="whitespace-nowrap">
                              {field.name}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {queryResult.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={queryResult.fields.length} className="text-center text-gray-500 py-8">
                              No results
                            </TableCell>
                          </TableRow>
                        ) : (
                          queryResult.rows.map((row, i) => (
                            <TableRow key={i}>
                              {queryResult.fields.map((field, j) => (
                                <TableCell key={j} className="max-w-[200px] truncate font-mono text-xs">
                                  {formatCellValue(row[field.name])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Audit Log</CardTitle>
                  <CardDescription>Recent database operations by admin users</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchAuditLogs}
                  disabled={isLoadingAudit}
                  data-testid="button-refresh-audit"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingAudit ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingAudit ? (
                <div className="text-center py-8 text-gray-500">Loading audit logs...</div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <History className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>No audit logs yet</p>
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-gray-50">
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Table</TableHead>
                          <TableHead>Rows</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                              {new Date(log.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-sm">
                              {log.userEmail || 'Unknown'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  log.action === 'clear_table' || log.action === 'query_write'
                                    ? 'destructive'
                                    : 'secondary'
                                }
                              >
                                {log.action}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm font-mono">
                              {log.targetTable || '—'}
                            </TableCell>
                            <TableCell className="text-sm">
                              {log.rowsAffected ?? '—'}
                            </TableCell>
                            <TableCell>
                              {log.success ? (
                                <Badge variant="outline" className="text-green-600 border-green-200">
                                  Success
                                </Badge>
                              ) : (
                                <Badge variant="destructive">Failed</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ingestion" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Ingestion Settings</CardTitle>
                  <CardDescription>Configure ZIP codes and limits for property data ingestion</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchIngestionSettings}
                  disabled={isLoadingIngestionSettings}
                  data-testid="button-refresh-ingestion-settings"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingIngestionSettings ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoadingIngestionSettings ? (
                <div className="text-center py-8 text-gray-500">Loading settings...</div>
              ) : (
                <>
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-700">ZIP Codes for Ingestion</label>
                    <p className="text-sm text-gray-500">
                      Add the ZIP codes you want to include when running property data ingestion from Snowflake.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ingestionZipCodes.map((zip) => (
                        <div key={zip} className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground rounded-md px-2.5 py-0.5 text-sm font-medium">
                          <span data-testid={`text-zip-${zip}`}>{zip}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeZipCode(zip)}
                            data-testid={`button-remove-zip-${zip}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter ZIP code (e.g., 75225)"
                        value={newZipCode}
                        onChange={(e) => setNewZipCode(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addZipCode()}
                        className="max-w-[200px]"
                        maxLength={5}
                        data-testid="input-new-zip"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={addZipCode}
                        data-testid="button-add-zip"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-700">Default Row Limit</label>
                    <p className="text-sm text-gray-500">
                      Maximum number of properties to ingest per ZIP code (1-10000).
                    </p>
                    <Input
                      type="number"
                      min={1}
                      max={10000}
                      value={ingestionLimit}
                      onChange={(e) => setIngestionLimit(parseInt(e.target.value) || 500)}
                      className="max-w-[200px]"
                      data-testid="input-ingestion-limit"
                    />
                  </div>

                  <div className="pt-4 border-t">
                    <Button
                      onClick={saveIngestionSettings}
                      disabled={isSavingIngestionSettings || ingestionZipCodes.length === 0}
                      data-testid="button-save-ingestion-settings"
                    >
                      {isSavingIngestionSettings ? 'Saving...' : 'Save Settings'}
                    </Button>
                  </div>

                  <div className="pt-4 border-t">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Current Configuration</h4>
                    <div className="bg-gray-50 rounded-md p-3 text-sm text-gray-600">
                      <p>
                        <strong>ZIP Codes:</strong> {ingestionZipCodes.join(', ') || 'None configured'}
                      </p>
                      <p>
                        <strong>Limit per ZIP:</strong> {ingestionLimit} properties
                      </p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Clear Table Data
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {tableToClear?.rowCount.toLocaleString()} rows from the{' '}
              <strong>{tableToClear?.name}</strong> table. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearTable}
              disabled={isClearing}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-clear"
            >
              {isClearing ? 'Clearing...' : 'Clear Table'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearAllConfirmOpen} onOpenChange={setClearAllConfirmOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Clear All Tables
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will permanently delete <strong>{clearAllPreview?.totalRows?.toLocaleString() || 0} rows</strong> across{' '}
                  <strong>{clearAllPreview?.tableCounts?.length || 0} tables</strong> in the correct order to respect foreign key constraints.
                </p>
                {clearAllPreview?.tableCounts && clearAllPreview.tableCounts.length > 0 && (
                  <div className="max-h-40 overflow-y-auto bg-gray-50 rounded-md p-2 text-sm">
                    <p className="font-medium text-gray-700 mb-1">Tables to be cleared:</p>
                    <ul className="space-y-0.5">
                      {clearAllPreview.tableCounts.map(({ table, count }) => (
                        <li key={table} className="flex justify-between text-gray-600">
                          <span>{table}</span>
                          <span className="text-gray-500">{count.toLocaleString()} rows</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-red-600 font-medium">This action cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAllTables}
              disabled={isClearingAll}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-clear-all"
            >
              {isClearingAll ? 'Clearing...' : 'Clear All Tables'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
