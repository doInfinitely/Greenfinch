import { NextRequest, NextResponse } from 'next/server';
import { db, pool } from '@/lib/db';
import { adminAuditLog } from '@/lib/schema';
import { requireAdminAccess, getSession } from '@/lib/auth';
import { desc } from 'drizzle-orm';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CURRENT_ENVIRONMENT = IS_PRODUCTION ? 'production' : 'development';

const SAFE_TABLES = [
  'properties',
  'contacts',
  'organizations',
  'property_contacts',
  'property_organizations',
  'contact_organizations',
  'property_pipeline',
  'pipeline_stage_history',
  'property_notes',
  'property_activity',
  'property_actions',
  'property_views',
  'notifications',
  'lists',
  'list_items',
  'service_providers',
  'property_service_providers',
  'property_flags',
  'contact_linkedin_flags',
  'parcel_to_property',
  'waitlist_signups',
  'admin_audit_log',
];

const DELETION_ORDER = [
  'notifications',
  'property_actions',
  'property_notes',
  'property_activity',
  'property_views',
  'pipeline_stage_history',
  'property_pipeline',
  'list_items',
  'lists',
  'property_service_providers',
  'contact_linkedin_flags',
  'property_flags',
  'property_contacts',
  'property_organizations',
  'contact_organizations',
  'service_providers',
  'contacts',
  'organizations',
  'parcel_to_property',
  'properties',
  'waitlist_signups',
];

async function logAuditAction(
  userId: string | null,
  userEmail: string | null,
  action: string,
  targetTable: string | null,
  queryText: string | null,
  rowsAffected: number | null,
  environment: string,
  success: boolean,
  errorMessage: string | null,
  metadata: Record<string, unknown> | null,
  ipAddress: string | null
) {
  try {
    await db.insert(adminAuditLog).values({
      userId,
      userEmail,
      action,
      targetTable,
      queryText,
      rowsAffected,
      environment,
      success,
      errorMessage,
      metadata,
      ipAddress,
    });
  } catch (err) {
    console.error('[AdminDB] Failed to log audit action:', err);
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminAccess();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'tables';

  try {
    if (action === 'tables') {
      const result = await pool.query(`
        SELECT 
          table_name,
          (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
        FROM information_schema.tables t
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const tablesWithCounts = await Promise.all(
        result.rows.map(async (row: { table_name: string; column_count: string }) => {
          try {
            const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${row.table_name}"`);
            return {
              name: row.table_name,
              columnCount: parseInt(row.column_count),
              rowCount: parseInt(countResult.rows[0].count),
              isSafe: SAFE_TABLES.includes(row.table_name),
            };
          } catch {
            return {
              name: row.table_name,
              columnCount: parseInt(row.column_count),
              rowCount: 0,
              isSafe: SAFE_TABLES.includes(row.table_name),
            };
          }
        })
      );

      return NextResponse.json({ tables: tablesWithCounts });
    }

    if (action === 'schema') {
      const tableName = searchParams.get('table');
      if (!tableName) {
        return NextResponse.json({ error: 'Table name required' }, { status: 400 });
      }

      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      return NextResponse.json({ columns: result.rows });
    }

    if (action === 'preview') {
      const tableName = searchParams.get('table');
      if (!tableName) {
        return NextResponse.json({ error: 'Table name required' }, { status: 400 });
      }

      if (!SAFE_TABLES.includes(tableName)) {
        return NextResponse.json({ error: 'Table not allowed for preview' }, { status: 403 });
      }

      const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
      const offset = parseInt(searchParams.get('offset') || '0');

      const result = await pool.query(`SELECT * FROM "${tableName}" LIMIT $1 OFFSET $2`, [limit, offset]);
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${tableName}"`);

      return NextResponse.json({
        rows: result.rows,
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      });
    }

    if (action === 'audit') {
      const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

      const logs = await db
        .select()
        .from(adminAuditLog)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit);

      return NextResponse.json({ logs });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[AdminDB] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Database operation failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let currentUser: { id: string; email: string | null } | null = null;

  try {
    await requireAdminAccess();
    const session = await getSession();
    if (session?.user) {
      currentUser = { id: session.user.id, email: session.user.email };
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

  try {
    const body = await request.json();
    const { action, table, query, environment = 'development', confirm } = body;

    if (action === 'query') {
      if (!query || typeof query !== 'string') {
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'query_rejected', null, query, null, CURRENT_ENVIRONMENT, false, 'Invalid query', null, ipAddress);
        return NextResponse.json({ error: 'Query string required' }, { status: 400 });
      }

      const queryLower = query.toLowerCase().trim();
      const isReadOnly = queryLower.startsWith('select') || queryLower.startsWith('explain');

      // SECURITY: Block ALL writes in production (server-side check, not client-supplied)
      if (!isReadOnly && IS_PRODUCTION) {
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'query_blocked', null, query, null, CURRENT_ENVIRONMENT, false, 'Write operations blocked in production', null, ipAddress);
        return NextResponse.json({
          error: 'Write operations are permanently blocked in production',
        }, { status: 403 });
      }

      if (!isReadOnly && !confirm) {
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'query_unconfirmed', null, query, null, CURRENT_ENVIRONMENT, false, 'Confirmation required', null, ipAddress);
        return NextResponse.json({
          error: 'Confirmation required for non-SELECT queries',
          requiresConfirmation: true,
        }, { status: 400 });
      }

      // SECURITY: Validate query only accesses safe tables
      // Extract potential table names from query (simple pattern matching for FROM/JOIN/INTO/UPDATE/DELETE FROM clauses)
      const tableNamePattern = /(?:from|join|into|update|delete\s+from)\s+["']?(\w+)["']?/gi;
      const matches = [...queryLower.matchAll(tableNamePattern)];
      const referencedTables = matches.map(m => m[1]);
      
      // Also check for direct table references in simple SELECT queries
      const simpleFromPattern = /from\s+["']?(\w+)["']?/gi;
      const simpleMatches = [...queryLower.matchAll(simpleFromPattern)];
      referencedTables.push(...simpleMatches.map(m => m[1]));
      
      // Unique table names
      const uniqueTables = [...new Set(referencedTables)];
      
      // Check if any referenced table is not in SAFE_TABLES
      const unsafeTables = uniqueTables.filter(t => !SAFE_TABLES.includes(t) && t !== 'information_schema');
      if (unsafeTables.length > 0) {
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'query_blocked', null, query, null, CURRENT_ENVIRONMENT, false, `Access to tables blocked: ${unsafeTables.join(', ')}`, null, ipAddress);
        return NextResponse.json({
          error: `Access to table(s) "${unsafeTables.join(', ')}" is not allowed. Only safe tables can be queried.`,
        }, { status: 403 });
      }

      const startTime = Date.now();
      const result = await pool.query(query);
      const duration = Date.now() - startTime;

      await logAuditAction(
        currentUser?.id || null,
        currentUser?.email || null,
        isReadOnly ? 'query_read' : 'query_write',
        null,
        query,
        result.rowCount,
        CURRENT_ENVIRONMENT,
        true,
        null,
        { duration },
        ipAddress
      );

      return NextResponse.json({
        rows: result.rows,
        rowCount: result.rowCount,
        fields: result.fields?.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })),
        duration,
      });
    }

    if (action === 'clear') {
      if (!table || typeof table !== 'string') {
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'clear_rejected', null, null, null, CURRENT_ENVIRONMENT, false, 'Invalid table name', null, ipAddress);
        return NextResponse.json({ error: 'Table name required' }, { status: 400 });
      }

      if (!SAFE_TABLES.includes(table)) {
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'clear_blocked', table, null, null, CURRENT_ENVIRONMENT, false, 'Table not in safe list', null, ipAddress);
        return NextResponse.json({ error: 'Table not allowed for clearing' }, { status: 403 });
      }

      // SECURITY: Block ALL clears in production (server-side check)
      if (IS_PRODUCTION) {
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'clear_blocked', table, null, null, CURRENT_ENVIRONMENT, false, 'Clear operations blocked in production', null, ipAddress);
        return NextResponse.json({
          error: 'Clear operations are permanently blocked in production',
        }, { status: 403 });
      }

      const dependentTablesQuery = await pool.query(`
        SELECT DISTINCT tc.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = $1
      `, [table]);
      const dependentTables = dependentTablesQuery.rows
        .map((r: any) => r.table_name as string)
        .filter((t: string) => SAFE_TABLES.includes(t));

      if (!confirm) {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${table}"`);
        const depInfo = dependentTables.length > 0
          ? ` Dependent tables that will also be cleared first: ${dependentTables.join(', ')}.`
          : '';
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'clear_unconfirmed', table, null, null, CURRENT_ENVIRONMENT, false, 'Confirmation required', null, ipAddress);
        return NextResponse.json({
          error: 'Confirmation required',
          requiresConfirmation: true,
          rowCount: parseInt(countResult.rows[0].count),
          dependentTables,
          message: `This will delete ${countResult.rows[0].count} rows from ${table}.${depInfo} Set confirm: true to proceed.`,
        }, { status: 400 });
      }

      const clearResults: { table: string; rowsDeleted: number }[] = [];

      if (dependentTables.length > 0) {
        const orderedDeps = DELETION_ORDER.filter(t => dependentTables.includes(t));
        for (const depTable of orderedDeps) {
          try {
            const depResult = await pool.query(`DELETE FROM "${depTable}"`);
            clearResults.push({ table: depTable, rowsDeleted: depResult.rowCount || 0 });
          } catch (err) {
            console.error(`[Admin] Failed to clear dependent table ${depTable}:`, err);
          }
        }
      }

      const result = await pool.query(`DELETE FROM "${table}"`);
      clearResults.push({ table, rowsDeleted: result.rowCount || 0 });

      await logAuditAction(
        currentUser?.id || null,
        currentUser?.email || null,
        'clear_table',
        table,
        `DELETE FROM "${table}" (+ ${dependentTables.length} dependent tables)`,
        result.rowCount,
        CURRENT_ENVIRONMENT,
        true,
        null,
        { clearResults },
        ipAddress
      );

      return NextResponse.json({
        success: true,
        rowsDeleted: result.rowCount,
        clearResults,
        message: `Cleared ${result.rowCount} rows from ${table}` + 
          (clearResults.length > 1 ? ` (also cleared ${clearResults.length - 1} dependent tables)` : ''),
      });
    }

    if (action === 'clearAll') {
      if (IS_PRODUCTION) {
        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'clear_all_blocked', null, null, null, CURRENT_ENVIRONMENT, false, 'Clear all blocked in production', null, ipAddress);
        return NextResponse.json({
          error: 'Clear all operations are permanently blocked in production',
        }, { status: 403 });
      }

      if (!confirm) {
        const tableCounts: { table: string; count: number }[] = [];
        let totalRows = 0;

        for (const tableName of DELETION_ORDER) {
          try {
            const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
            const count = parseInt(countResult.rows[0].count);
            if (count > 0) {
              tableCounts.push({ table: tableName, count });
              totalRows += count;
            }
          } catch {
            // Table might not exist, skip
          }
        }

        await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'clear_all_unconfirmed', null, null, null, CURRENT_ENVIRONMENT, false, 'Confirmation required', { tableCounts }, ipAddress);
        return NextResponse.json({
          error: 'Confirmation required',
          requiresConfirmation: true,
          tableCounts,
          totalRows,
          deletionOrder: DELETION_ORDER,
          message: `This will delete ${totalRows} rows across ${tableCounts.length} tables in the correct order to respect foreign key constraints. Set confirm: true to proceed.`,
        }, { status: 400 });
      }

      const results: { table: string; rowsDeleted: number; success: boolean; error?: string }[] = [];
      let totalDeleted = 0;

      for (const tableName of DELETION_ORDER) {
        try {
          const deleteResult = await pool.query(`DELETE FROM "${tableName}"`);
          const rowsDeleted = deleteResult.rowCount || 0;
          results.push({ table: tableName, rowsDeleted, success: true });
          totalDeleted += rowsDeleted;
        } catch (err) {
          results.push({ 
            table: tableName, 
            rowsDeleted: 0, 
            success: false, 
            error: err instanceof Error ? err.message : 'Unknown error' 
          });
        }
      }

      await logAuditAction(
        currentUser?.id || null,
        currentUser?.email || null,
        'clear_all_tables',
        null,
        `Cleared ${DELETION_ORDER.length} tables in order`,
        totalDeleted,
        CURRENT_ENVIRONMENT,
        true,
        null,
        { results },
        ipAddress
      );

      return NextResponse.json({
        success: true,
        totalDeleted,
        results,
        message: `Cleared ${totalDeleted} rows across ${results.filter(r => r.success).length} tables`,
      });
    }

    await logAuditAction(currentUser?.id || null, currentUser?.email || null, 'unknown_action', null, null, null, CURRENT_ENVIRONMENT, false, `Unknown action: ${action}`, null, ipAddress);
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[AdminDB] Error:', error);

    await logAuditAction(
      currentUser?.id || null,
      currentUser?.email || null,
      'error',
      null,
      null,
      null,
      CURRENT_ENVIRONMENT,
      false,
      error instanceof Error ? error.message : 'Unknown error',
      null,
      ipAddress
    );

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Database operation failed' },
      { status: 500 }
    );
  }
}
