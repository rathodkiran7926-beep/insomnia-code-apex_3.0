import { randomBytes, scryptSync } from 'node:crypto';
// Explicit backend-only development seed. Never imported into the extension.
export function seedIdeDemo(db, { enabled, production } = {}) {
  if (!enabled || production || process.env.NODE_ENV === 'production') throw new Error('IDE demo seeding requires CODEBASE_MENTOR_IDE_DEMO=1 and is forbidden in production.');
  const workspaceId = 'f1600000-0000-4000-8000-000000000001';
  const users = [
    { id: 'f1600000-0000-4000-8000-000000000002', email: 'junior@demo.com', name: 'Junior Developer', role: 'developer' },
    { id: 'f1600000-0000-4000-8000-000000000003', email: 'senior@demo.com', name: 'Senior Developer', role: 'reviewer' },
  ];
  db.exec('BEGIN IMMEDIATE');
  try {
    const workspace = db.prepare('SELECT name FROM collaboration_workspaces WHERE id=?').get(workspaceId);
    if (workspace && workspace.name !== 'IDE Local Demo') throw new Error('Demo workspace ID is already in use.');
    for (const user of users) {
      const existing = db.prepare('SELECT id FROM collaboration_users WHERE email=?').get(user.email);
      if (existing && existing.id !== user.id) throw new Error('A demo email belongs to an existing account. No password or membership was changed.');
      const existingId = db.prepare('SELECT email FROM collaboration_users WHERE id=?').get(user.id);
      if (existingId && existingId.email !== user.email) throw new Error('Demo account ID is already in use.');
    }
    db.prepare('INSERT OR IGNORE INTO collaboration_workspaces VALUES (?,?,?)').run(workspaceId, 'IDE Local Demo', new Date().toISOString());
    for (const user of users) {
      if (!db.prepare('SELECT id FROM collaboration_users WHERE id=?').get(user.id)) {
        const salt = randomBytes(16).toString('hex');
        const hash = `${salt}:${scryptSync('Demo@12345Local', salt, 64).toString('hex')}`;
        db.prepare('INSERT INTO collaboration_users VALUES (?,?,?,?,?)').run(user.id, user.email, user.name, hash, new Date().toISOString());
      }
      db.prepare('INSERT OR IGNORE INTO collaboration_members VALUES (?,?,?)').run(workspaceId, user.id, user.role);
    }
    db.exec('COMMIT');
    return { workspaceId, users: users.map(({ id, email, role }) => ({ id, email, role })) };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
