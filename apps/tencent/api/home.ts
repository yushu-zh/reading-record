import type { Home } from '../../../packages/contracts';
import { authorizedFriend } from './friendship';
import { avatarVersionSql } from './identity';
import { id, missing, router } from './http';
import { businessDateColumns, progressSql } from './reading';

export const home = router();
home.get('/', async c => {
  const db=c.env.DB;
  const result = await db.prepare(`WITH clock AS (SELECT ${businessDateColumns}),
    friend AS (${authorizedFriend})
    SELECT clock.*, friend."relationshipId",
      CAST(json_build_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar,'avatarVersion',${avatarVersionSql('u.id')},
        'books',${progressSql('u.id')}) AS text) AS self,
      CASE WHEN friend.id IS NOT NULL THEN CAST(json_build_object(
        'id',friend.id,'nickname',friend.nickname,'avatar',friend.avatar,'avatarVersion',friend."avatarVersion",
        'books',${progressSql('friend.id')}
      ) AS text) END AS friend
    FROM users u CROSS JOIN clock LEFT JOIN friend ON 1=1 WHERE u.id=?`)
    .bind(id(c),id(c)).first<Omit<Home,'self'|'friend'|'timeZone'> & {self:string; friend:string|null}>();
  if (!result) missing();
  return c.json({
    ...result, timeZone:'Asia/Shanghai',
    self:JSON.parse(result.self), friend:result.friend ? JSON.parse(result.friend) : null,
  } satisfies Home);
});
