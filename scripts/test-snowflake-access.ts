import snowflake from 'snowflake-sdk';

snowflake.configure({ logLevel: 'ERROR' });

function formatPrivateKey(key: string): string {
  let formatted = key.trim();
  
  if (!formatted.includes('\n')) {
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

async function executeQuery<T>(sqlText: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
    if (!privateKey) {
      reject(new Error('SNOWFLAKE_PRIVATE_KEY not set'));
      return;
    }

    const formattedKey = formatPrivateKey(privateKey);
    
    const connection = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT_GF!,
      username: process.env.SNOWFLAKE_USER_GF!,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey: formattedKey,
      database: process.env.SNOWFLAKE_REGRID_DB!,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
    });
    
    connection.connect((err) => {
      if (err) {
        reject(err);
        return;
      }
      
      connection.execute({
        sqlText,
        complete: (err, stmt, rows) => {
          connection.destroy(() => {});
          if (err) {
            reject(err);
          } else {
            resolve((rows || []) as T[]);
          }
        }
      });
    });
  });
}

async function main() {
  console.log('=== SNOWFLAKE ACCESS TEST ===\n');
  
  console.log('Environment:');
  console.log(`  Account: ${process.env.SNOWFLAKE_ACCOUNT_GF}`);
  console.log(`  User: ${process.env.SNOWFLAKE_USER_GF}`);
  console.log(`  Database: ${process.env.SNOWFLAKE_REGRID_DB}`);
  console.log(`  Warehouse: ${process.env.SNOWFLAKE_WAREHOUSE}`);
  console.log('');
  
  try {
    console.log('1. Testing connection...');
    const currentDb = await executeQuery<any>('SELECT CURRENT_DATABASE() as DB, CURRENT_SCHEMA() as SCHEMA, CURRENT_USER() as USER');
    console.log('   Current context:', currentDb[0]);
    
    console.log('\n2. Listing available databases...');
    const databases = await executeQuery<any>('SHOW DATABASES');
    console.log('   Databases:');
    databases.slice(0, 15).forEach(db => {
      console.log(`     - ${db.name}`);
    });
    if (databases.length > 15) {
      console.log(`     ... and ${databases.length - 15} more`);
    }
    
    console.log('\n3. Checking for Regrid/DCAD tables...');
    const schemas = await executeQuery<any>('SHOW SCHEMAS IN DATABASE');
    console.log('   Schemas in current database:');
    schemas.forEach(s => {
      console.log(`     - ${s.name}`);
    });
    
    console.log('\n4. Tables in PREMIUM_PARCELS schema...');
    const tables = await executeQuery<any>('SHOW TABLES IN SCHEMA PREMIUM_PARCELS');
    console.log('   Tables:');
    tables.forEach(t => {
      console.log(`     - ${t.name}`);
    });
    
    console.log('\n5. Testing Regrid query...');
    const sample = await executeQuery<any>(`
      SELECT COUNT(*) as CNT 
      FROM PREMIUM_PARCELS.TX_DALLAS 
      WHERE "szip5" = '75225'
    `);
    console.log('   Properties in ZIP 75225:', sample[0]?.CNT);
    
    console.log('\n6. DCAD schemas...');
    const dcadSchemas = await executeQuery<any>('SHOW SCHEMAS IN DATABASE DCAD_LAND_2025');
    console.log('   Schemas:');
    dcadSchemas.forEach(s => {
      console.log(`     - ${s.name}`);
    });
    
    console.log('\n7. Sample property data...');
    const sampleProp = await executeQuery<any>(`
      SELECT "ll_uuid", "address", "scity", "szip5", "owner", "usedesc", "parcelnumb"
      FROM PREMIUM_PARCELS.TX_DALLAS 
      WHERE "szip5" = '75225'
      LIMIT 5
    `);
    sampleProp.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.address} - ${p.usedesc || 'no usedesc'}`);
    });
    
    console.log('\n8. Columns in Regrid table...');
    const cols = await executeQuery<any>('DESCRIBE TABLE PREMIUM_PARCELS.TX_DALLAS');
    const keyColumns = cols.slice(0, 30).map((c: any) => c.name);
    console.log('   First 30 columns:', keyColumns.join(', '));
    
    console.log('\n9. DCAD tables in PUBLIC schema...');
    const dcadTables = await executeQuery<any>('SHOW TABLES IN DCAD_LAND_2025.PUBLIC');
    console.log('   Tables:');
    dcadTables.forEach(t => {
      console.log(`     - ${t.name}`);
    });
    
    console.log('\n10. Testing DCAD join with Regrid...');
    const joinTest = await executeQuery<any>(`
      SELECT COUNT(*) as CNT
      FROM PREMIUM_PARCELS.TX_DALLAS r
      JOIN DCAD_LAND_2025.PUBLIC.ACCOUNT_INFO ai 
        ON r."parcelnumb" = ai.GIS_PARCEL_ID 
        AND ai.APPRAISAL_YR = 2025
      WHERE ai.PROPERTY_ZIPCODE LIKE '75225%'
        AND ai.DIVISION_CD = 'COM'
    `);
    console.log('   Commercial properties with DCAD match:', joinTest[0]?.CNT);
    
    console.log('\n11. Checking COMMERCIAL_PROPERTIES table...');
    const cpCols = await executeQuery<any>('DESCRIBE TABLE DCAD_LAND_2025.PUBLIC.COMMERCIAL_PROPERTIES');
    console.log('   Columns:', cpCols.map((c: any) => c.name).join(', '));
    
    const cpCount = await executeQuery<any>(`
      SELECT COUNT(*) as CNT 
      FROM DCAD_LAND_2025.PUBLIC.COMMERCIAL_PROPERTIES 
      WHERE ZIP LIKE '75225%'
    `);
    console.log('   Commercial properties in ZIP 75225:', cpCount[0]?.CNT);
    
    console.log('\n12. Sample COMMERCIAL_PROPERTIES data...');
    const cpSample = await executeQuery<any>(`
      SELECT PARCEL_ID, address, CITY, ZIP, BIZ_NAME, OWNER_NAME1, PROPERTY_NAME, GROSS_BLDG_AREA, DCAD_TOTAL_VAL
      FROM DCAD_LAND_2025.PUBLIC.COMMERCIAL_PROPERTIES 
      WHERE ZIP LIKE '75225%'
      LIMIT 5
    `);
    cpSample.forEach((p: any, i: number) => {
      console.log(`   ${i+1}. ${p.address || 'no addr'} - ${p.PROPERTY_NAME || p.BIZ_NAME || p.OWNER_NAME1 || 'no name'} - $${(p.DCAD_TOTAL_VAL || 0).toLocaleString()}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
