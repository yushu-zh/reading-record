import { authorizedFriend } from './friendship';
import { body, decode, id, invalid, missing, router, type ApiContext } from './http';

const maxBytes = 120 * 1024;

function isAvatarJpeg(bytes:Uint8Array) {
  if (bytes.length<4 || bytes.length>maxBytes || bytes[0]!==0xff || bytes[1]!==0xd8 ||
      bytes.at(-2)!==0xff || bytes.at(-1)!==0xd9) return false;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for (let offset=2; offset+4<=bytes.length;) {
    if (bytes[offset++]!==0xff) return false;
    while (bytes[offset]===0xff) offset++;
    const marker=bytes[offset++];
    if (marker===0xda || offset+2>bytes.length) return false;
    const length=view.getUint16(offset);
    if (length<2 || offset+length>bytes.length) return false;
    if (marker===0xc0 || marker===0xc1 || marker===0xc2) {
      return length>=8 && view.getUint16(offset+3)===256 && view.getUint16(offset+5)===256;
    }
    offset+=length;
  }
  return false;
}

export async function updateAvatar(c:ApiContext) {
  const { jpeg } = await body(c);
  if (typeof jpeg !== 'string' || jpeg.length > Math.ceil(maxBytes * 4 / 3) || !/^[\w-]+$/.test(jpeg)) {
    invalid('头像图片无效或过大，请重新选择。');
  }
  let bytes:Uint8Array;
  try { bytes=decode(jpeg); }
  catch { invalid('头像图片无效，请重新选择。'); }
  if (!isAvatarJpeg(bytes)) invalid('头像图片无效，请重新选择。');
  const version=crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO profile_avatars (user_id,version,jpeg) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,jpeg=excluded.jpeg`)
    .bind(id(c),version,bytes).run();
  return c.json({avatarVersion:version});
}

export const avatars=router();
avatars.get('/:id',async c=>{
  const userId=id(c), target=c.req.param('id');
  const row=await c.env.DB.prepare(`WITH friend AS (${authorizedFriend})
    SELECT jpeg FROM profile_avatars WHERE user_id=? AND (user_id=? OR user_id=(SELECT id FROM friend))`)
    .bind(userId,target,userId).first<{jpeg:number[] | string}>();
  if (!row) missing();
  const bytes = typeof row.jpeg === 'string'
    ? Uint8Array.from(Buffer.from(row.jpeg.slice(2),'hex'))
    : Uint8Array.from(row.jpeg);
  return c.body(bytes,200,{
    'Content-Type':'image/jpeg','Cross-Origin-Resource-Policy':'same-origin',
  });
});
