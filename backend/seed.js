// seed.js — inserts the same 12 demo hubs that seedDemoData() in script.js used to
// create in localStorage, so the participant/admin sites have real data immediately.
const db = require('./db');

function seed() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM hubs').get();
  if (count > 0) {
    console.log(`Skipping seed — hubs table already has ${count} row(s).`);
    return;
  }

  const names = [
    'Rajesh Kumar', 'Priya Sharma', 'Ankit Gupta', 'Meena Patel', 'Suresh Iyer',
    'Divya Nair', 'Amit Verma', 'Sunita Joshi', 'Vikram Singh', 'Pooja Mehta',
    'Rahul Desai', 'Kavita Reddy',
  ];
  const cities = [
    'Mumbai', 'Bangalore', 'Delhi', 'Pune', 'Chennai',
    'Hyderabad', 'Ahmedabad', 'Kolkata', 'Jaipur', 'Indore',
  ];
  const areas = [
    'Andheri West', 'Koramangala', 'Connaught Place', 'Baner', 'Anna Nagar',
    'Banjara Hills', 'Navrangpura', 'Park Street', 'C-Scheme', 'Vijay Nagar',
  ];
  const addresses = [
    'Office 12, Infinity IT Park, Andheri West',
    '45 Koramangala 4th Block, Near Forum Mall',
    'Suite 302, Statesman House, Connaught Place',
    'Plot 9, Baner Road, Near Balewadi Stadium',
    '22 Anna Nagar 2nd Avenue, Near CMBT',
    'Flat 5A, Jubilee Hills Road No. 36, Banjara Hills',
    'Office 201, Abhijeet Complex, Navrangpura',
    '14B Park Street, Near Park Hotel',
    'B-12 C-Scheme, Near SMS Hospital',
    '33 Vijay Nagar Square, AB Road',
  ];
  const memberships = ['QPFP Certificant', 'CFP Professional', 'ProMember', 'Both CFP & QPFP'];
  const venues = ['Home', 'Own Office', 'Co-working Space', 'AMC Office', 'Society Clubhouse'];
  const capacities = ['Up to 6 People', '6-10 People', '10-20 People', 'More than 20 People'];
  const statuses = ['Pending', 'Approved', 'Rejected', 'Pending', 'Approved', 'Approved'];
  const frequencies = ['One Time Only', 'Multiple Times', 'Open to Either'];

  const insert = db.prepare(`
    INSERT INTO hubs (
      id, submitted_at, last_updated, status, full_name, email, mobile, membership,
      city, area, address, pincode, venue_type, capacity, hosted_before, hosting_frequency, lat, lng
    ) VALUES (
      @id, @submitted_at, @last_updated, @status, @full_name, @email, @mobile, @membership,
      @city, @area, @address, @pincode, @venue_type, @capacity, @hosted_before, @hosting_frequency, @lat, @lng
    )
  `);

  const insertMany = db.transaction((hubs) => {
    for (const hub of hubs) insert.run(hub);
  });

  const demo = names.map((name, i) => {
    const id = `NFP-HUB-2024${String(11 - i).padStart(2, '0')}15-${1000 + i * 73}`;
    const submittedAt = new Date(Date.now() - i * 24 * 60 * 60 * 1000 * 2).toISOString();
    return {
      id,
      submitted_at: submittedAt,
      last_updated: null,
      status: statuses[i % statuses.length],
      full_name: name,
      email: name.toLowerCase().replace(' ', '.') + '@email.com',
      mobile: `9${String(800000000 + i * 1111111).slice(0, 9)}`,
      membership: memberships[i % memberships.length],
      city: cities[i % cities.length],
      area: areas[i % areas.length],
      address: addresses[i % addresses.length],
      pincode: String(400001 + i * 111),
      venue_type: venues[i % venues.length],
      capacity: capacities[i % capacities.length],
      hosted_before: i % 3 === 0 ? 'Yes' : 'No',
      hosting_frequency: frequencies[i % frequencies.length],
      lat: null,
      lng: null,
    };
  });

  insertMany(demo);
  const approvedCount = demo.filter((h) => h.status === 'Approved').length;
  console.log(`Seeded ${demo.length} demo hubs (${approvedCount} Approved).`);
}

seed();

module.exports = seed;
