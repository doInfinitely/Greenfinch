import { NextRequest, NextResponse } from 'next/server';
import { db, pool } from '@/lib/db';
import { adminAuditLog } from '@/lib/schema';
import { requireAdminAccess, getSession } from '@/lib/auth';

const SAFE_TABLES = [
  'properties',
  'contacts',
  'organizations',
  'property_contacts',
  'property_organizations',
  'contact_organizations',
  'property_pipeline',
  'property_notes',
  'property_activity',
  'property_actions',
  'notifications',
  'lists',
  'list_items',
  'service_providers',
  'property_service_providers',
  'property_flags',
  'contact_linkedin_flags',
  'waitlist_signups',
  'admin_audit_log',
];

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const table = searchParams.get('table');
  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

  if (!table) {
    return NextResponse.json({ error: 'Table name required' }, { status: 400 });
  }

  if (!SAFE_TABLES.includes(table)) {
    return NextResponse.json({ error: 'Table not allowed for export' }, { status: 403 });
  }

  try {
    const result = await pool.query(`SELECT * FROM "${table}"`);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'No data to export' }, { status: 404 });
    }

    const headers = result.fields.map(f => f.name);
    const csvRows = [headers.join(',')];

    for (const row of result.rows) {
      const values = headers.map(h => escapeCSV(row[h]));
      csvRows.push(values.join(','));
    }

    const csv = csvRows.join('\n');

    await db.insert(adminAuditLog).values({
      userId: currentUser?.id || null,
      userEmail: currentUser?.email || null,
      action: 'export',
      targetTable: table,
      queryText: `SELECT * FROM "${table}"`,
      rowsAffected: result.rows.length,
      environment: 'development',
      success: true,
      errorMessage: null,
      metadata: null,
      ipAddress,
    });

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${table}_export_${timestamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[AdminDB Export] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}
