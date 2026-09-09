import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking for duplicate attendance records...');

  const records = await prisma.attendance.findMany();
  console.log(`Total attendance records: ${records.length}`);

  const groups: Record<string, typeof records> = {};
  
  for (const record of records) {
    const d = record.date;
    const dateStr = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    const key = `${record.studentId}-${record.batchId}-${record.session}-${dateStr}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  }

  const duplicates = Object.entries(groups).filter(([_, group]) => group.length > 1);

  if (duplicates.length === 0) {
    console.log('No duplicates found.');
  } else {
    console.log(`Found ${duplicates.length} groups of duplicates:`);
    for (const [key, group] of duplicates) {
      console.log(`\nDuplicate Key: ${key}`);
      console.log(`Records (${group.length}):`);
      for (const record of group) {
        console.log(`  - ID: ${record.id} | Status: ${record.status} | Date: ${record.date.toISOString()} | Remarks: ${record.remarks}`);
      }
    }
  }

  console.log('\nChecking migrations...');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
