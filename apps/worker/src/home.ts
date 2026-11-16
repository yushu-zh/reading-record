import type { Home } from '../../../packages/contracts';
import { authorizedFriend } from './friendship';
import { avatarVersionSql } from './identity';
import { id, missing, router } from './http';
import { businessDateColumns, progressSql } from './reading';

export const home = router();
home.get('/', async c => {
  const result = await c.env.DB.prepare(`WITH clock AS (SELECT ${businessDateColumns}),
    friend AS (${authorizedFriend})
    SELECT clock.*, friend.relationshipId,
      json_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar,'avatarVersion',${avatarVersionSql('u.id')},'books',json(${progressSql('u.id')})) AS self,
      CASE WHEN friend.id IS NOT NULL THEN json_object(
        'id',friend.id,'nickname',friend.nickname,'avatar',friend.avatar,'avatarVersion',friend.avatarVersion,'books',json(${progressSql('friend.id')})
      ) END AS friend
    FROM users u CROSS JOIN clock LEFT JOIN friend ON 1=1 WHERE u.id=?`)
    .bind(id(c),id(c)).first<Omit<Home,'self'|'friend'|'timeZone'> & {self:string; friend:string|null}>();
  if (!result) missing();
  return c.json({
    ...result, timeZone:'Asia/Shanghai',
    self:JSON.parse(result.self), friend:result.friend ? JSON.parse(result.friend) : null,
  } satisfies Home);
});
