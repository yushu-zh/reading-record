import type { Friend, Profile } from '../../../packages/contracts';
import { body, conflict, id, invalid, missing, router } from './http';
import { profileColumns, resolveFriendCode } from './identity';

export const authorizedFriend = `SELECT ${profileColumns},f.id AS relationshipId
  FROM active_friendship_members mine JOIN friendships f ON f.id=mine.friendship_id AND f.ended_at IS NULL
  JOIN active_friendship_members other ON other.friendship_id=f.id AND other.user_id<>mine.user_id
  JOIN users u ON u.id=other.user_id WHERE mine.user_id=?`;

export function friend(db: D1Database, userId: string) {
  return db.prepare(authorizedFriend).bind(userId).first<Friend>();
}
export const friendship = router();
friendship.post('/', async c => {
  const { code } = await body(c);
  if (typeof code !== 'string' || !/^[\w-]{22}$/.test(code.trim())) invalid('请输入有效的好友邀请码。');
  const db = c.env.DB, userId = id(c), other = await resolveFriendCode(db, code.trim());
  if (!other) invalid('好友邀请码无效。');
  if (other === userId) invalid('请输入对方的邀请码。');
  const relationship = crypto.randomUUID();
  try {
    const results = await db.batch<Profile>([
      db.prepare('INSERT INTO friendships(id,first_id,second_id) VALUES (?,?,?)').bind(relationship,userId,other),
      db.prepare('INSERT INTO active_friendship_members (user_id,friendship_id) VALUES (?,?),(?,?)')
        .bind(userId,relationship,other,relationship),
      db.prepare(`SELECT ${profileColumns} FROM users u WHERE u.id=?`).bind(other),
    ]);
    return c.json({ ...results[2].results[0], relationshipId:relationship });
  } catch (error) {
    if (!String(error).includes('active_friendship_members.user_id')) throw error;
    const current = await friend(db,userId);
    if (current?.id === other) return c.json(current);
    conflict('already_bound','你或对方已绑定好友。');
  }

});
friendship.delete('/:id', async c => {
  const relationship = c.req.param('id'), db = c.env.DB, userId = id(c);
  const results = await db.batch([
    db.prepare(`UPDATE friendships SET ended_at=strftime('%FT%fZ','now') WHERE id=? AND ended_at IS NULL
      AND EXISTS(SELECT 1 FROM active_friendship_members WHERE friendship_id=? AND user_id=?)`).bind(relationship,relationship,userId),
    db.prepare(`DELETE FROM active_friendship_members WHERE friendship_id=? AND EXISTS (
      SELECT 1 FROM friendships WHERE id=? AND ended_at IS NOT NULL AND (first_id=? OR second_id=?)
    )`).bind(relationship,relationship,userId,userId),
    db.prepare('SELECT id FROM friendships WHERE id=? AND (first_id=? OR second_id=?) AND ended_at IS NOT NULL')
      .bind(relationship,userId,userId),
  ]);
  if (!results[2].results.length) missing();
  return c.json({ ok:true });
});
