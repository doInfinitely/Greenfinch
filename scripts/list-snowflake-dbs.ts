import snowflakePkg from 'snowflake-sdk';
const snowflake = (snowflakePkg as any).default || snowflakePkg;
snowflake.configure({ logLevel: 'ERROR' });

function formatPrivateKey(key: string): string {
  let formatted = key.trim();
  if (formatted.indexOf('\n') === -1) {
    formatted = formatted
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
      .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
    const header = '-----BEGIN PRIVATE KEY-----\n';
    const footer = '\n-----END PRIVATE KEY-----';
    const body = formatted.slice(header.length - 1, formatted.length - footer.length + 1).trim();
    const bodyWithNewlines = body.match(/.{1,64}/g)?.join('\n') || body;
    formatted = `-----BEGIN PRIVATE KEY-----\n${bodyWithNewlines}\n-----END PRIVATE KEY-----`;
  }
  return formatted;
}

const conn = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT_GF!,
  username: process.env.SNOWFLAKE_USER_GF!,
  authenticator: 'SNOWFLAKE_JWT',
  privateKey: formatPrivateKey(process.env.SNOWFLAKE_PRIVATE_KEY!),
  warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
});

conn.connect((err: any) => {
  if (err) { console.error('Connect error:', err.message); process.exit(1); }
  conn.execute({
    sqlText: 'SHOW SCHEMAS IN DATABASE NATIONWIDE_PARCEL_DATA__PREMIUM_SCHEMA__FREE_SAMPLE',
    complete: (err: any, _stmt: any, rows: any[]) => {
      if (err) { console.error(err.message); }
      else {
        console.log('Schemas:');
        rows.forEach((r: any) => console.log(`  ${r.name}`));
      }
      conn.execute({
        sqlText: 'SHOW TABLES IN DATABASE NATIONWIDE_PARCEL_DATA__PREMIUM_SCHEMA__FREE_SAMPLE',
        complete: (err: any, _stmt: any, rows: any[]) => {
          conn.destroy(() => {});
          if (err) { console.error(err.message); process.exit(1); }
          console.log('\nTables:');
          rows.forEach((r: any) => console.log(`  ${r.schema_name}.${r.name} (${r.rows} rows)`));
        },
      });
    },
  });
});
