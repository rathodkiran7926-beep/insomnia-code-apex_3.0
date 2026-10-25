import { db } from '../src/handoffStorage.js';
import { seedIdeDemo } from '../src/ideDemoSeed.js';
const result = seedIdeDemo(db, { enabled: process.env.CODEBASE_MENTOR_IDE_DEMO === '1', production: process.env.NODE_ENV === 'production' });
console.log(`IDE local demo ready: ${result.users.map(u => u.email).join(', ')}. Existing accounts and passwords were not reset.`);
