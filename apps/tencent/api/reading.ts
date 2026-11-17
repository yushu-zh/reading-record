import type { Book } from '../../../packages/contracts';
import { businessDay, utcTimestamp, type Database } from './database';
import { body, conflict, digest, id, integer, invalid, missing, requestId, router } from './http';

const columns = 'id,title,total_pages AS "totalPages",revision,current_page AS "currentPage",completed_on AS "completedOn"';
const active = 'owner_id=? AND id=? AND deleted_at IS NULL';
const uuid = () => crypto.randomUUID();
function bookFields(input: Record<string, unknown>) {
  if (typeof input.title !== 'string') invalid('请输入书名。');
  const title = input.title.trim();
  if (title.length < 1 || title.length > 120) invalid('书名须为 1 至 120 个字。');
  return { title, totalPages: integer(input.totalPages, 1, 1000000) };
}
async function book(db: Database, owner: string, bookId: string) {
  const row = await db.prepare(`SELECT ${columns} FROM books WHERE ${active}`).bind(owner,bookId).first<Book>();
  if (!row) missing();
  return row;
}
function stale(): never { return conflict('revision_conflict', '书籍进度已更新，请刷新后确认。'); }
function checkDigest(expected: string, stored: string) {
  if (expected !== stored) conflict('request_conflict','该请求已用于其他输入，请刷新后重试。');
}

export const reading = router();
reading.get('/', async c => {
  const db=c.env.DB;
  const result = await db.prepare(`SELECT ${columns} FROM books WHERE owner_id=? AND deleted_at IS NULL ORDER BY created_at,id`)
    .bind(id(c)).all<Book>();
  return c.json(result.results);
});
reading.post('/', async c => {
  const input = await body(c), { title, totalPages } = bookFields(input);
  const initialPage = input.initialPage === undefined ? 0 : integer(input.initialPage,0,totalPages);
  const request = requestId(input.requestId);
  const hash = await digest(JSON.stringify(initialPage === 0 ? [title,totalPages] : [title,totalPages,initialPage]));
  const db = c.env.DB, owner = id(c);
  const results = await db.batch<Book & {input_digest:string}>([
    db.prepare(`INSERT INTO books (id,owner_id,title,total_pages,initial_page,current_page,completed_on,request_id,input_digest)
      VALUES (?,?,?,?,?,?,CASE WHEN CAST(? AS integer)=CAST(? AS integer) THEN ${businessDay} END,?,?)
      ON CONFLICT(owner_id,request_id) DO NOTHING`)
      .bind(uuid(),owner,title,totalPages,initialPage,initialPage,initialPage,totalPages,request,hash),
    db.prepare(`SELECT ${columns},input_digest FROM books WHERE owner_id=? AND request_id=?`).bind(owner,request),
  ]);
  const { input_digest, ...created } = results[1].results[0];
  checkDigest(hash, String(input_digest));
  return c.json(created);
});
reading.patch('/:id', async c => {
  const input = await body(c), { title, totalPages } = bookFields(input);
  const revision = integer(input.expectedRevision,0), bookId = c.req.param('id');
  const db = c.env.DB, owner = id(c);
  try {
    const results = await db.batch([
      db.prepare(`UPDATE books SET title=?,total_pages=?,revision=revision+1 WHERE ${active} AND revision=?`)
        .bind(title,totalPages,owner,bookId,revision),
      db.prepare(`SELECT ${columns} FROM books WHERE ${active}`).bind(owner,bookId),
    ]);
    if (!results[1].results.length) missing();
    if (!results[0].meta.changes) stale();
    return c.json(results[1].results[0]);
  } catch (error) {
    if (String(error).includes('page_range')) invalid('总页数不能低于已生效的累计页码。');
    throw error;
  }
});
reading.delete('/:id', async c => {
  const revision = integer((await body(c)).expectedRevision,0), bookId = c.req.param('id');
  const db = c.env.DB, owner = id(c);
  const result = await db.prepare(`UPDATE books SET deleted_at=${utcTimestamp},revision=revision+1
    WHERE ${active} AND revision=?`).bind(owner,bookId,revision).run();
  if (!result.meta.changes) {
    await book(db,owner,bookId);
    stale();
  }
  return c.json({ ok:true });
});
reading.post('/:id/check-ins', async c => {
  const input = await body(c), request = requestId(input.requestId), bookId = c.req.param('id');
  const page = integer(input.page,0,1000000), rev = integer(input.expectedRevision,0), date = input.expectedDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid();
  const hash = await digest(JSON.stringify([page,rev,date]));
  const db = c.env.DB, owner = id(c);
  // PostgreSQL waits for an in-flight edit, then rechecks the selected book's revision.
  const lookup = db.prepare(`SELECT c.id,c.page,c.reading_date AS date,c.input_digest,b.id AS book_id
    FROM check_ins c JOIN books b ON b.id=c.book_id WHERE c.book_id=? AND c.request_id=? AND b.owner_id=?`).bind(bookId,request,owner);
  try {
    const [, records, books] = await db.batch<Book & {deleted_at:string|null;input_digest:string;page:number;date:string}>([
      db.prepare(`INSERT INTO check_ins (id,book_id,reading_date,page,expected_revision,sequence,request_id,input_digest)
        SELECT ?,id,?,?,revision,revision+1,?,? FROM books
        WHERE ${active} AND revision=? AND NOT EXISTS (SELECT 1 FROM check_ins WHERE book_id=? AND request_id=?)
        FOR UPDATE OF books`)
        .bind(uuid(),date,page,request,hash,owner,bookId,rev,bookId,request),
      lookup,
      db.prepare(`SELECT ${columns},deleted_at FROM books WHERE owner_id=? AND id=?`).bind(owner,bookId),
    ]);
    const current = books.results[0];
    if (!current) missing();
    const record = records.results[0];
    if (!record) {
      if (current.deleted_at) missing();
      stale();
    }
    checkDigest(hash,String(record.input_digest));
    const { deleted_at: _deleted, ...book } = current;
    return c.json({ record: { id:record.id, page:record.page, date:record.date }, book });
  } catch (error) {
    if (String(error).includes('date_conflict')) conflict('date_conflict','日期已切换，请刷新并确认新的打卡日期。');
    if (String(error).includes('page_range')) invalid('页码超出可打卡范围，或该书已完成。');
    throw error;
  }
});

const weekStart = "to_char(date_trunc('week', statement_timestamp() AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD')";
export const businessDateColumns = `${utcTimestamp} AS "serverNow", ${businessDay} AS date, ${weekStart} AS "weekStart"`;

export function progressSql(owner: string) {
  const days = `COALESCE((SELECT json_agg(json_build_object('date',d.reading_date,'page',c.page))
    FROM daily_progress d JOIN check_ins c ON c.id=d.effective_check_in_id
    WHERE d.book_id=b.id AND d.reading_date BETWEEN clock."weekStart" AND clock.date),'[]')`;
  return `COALESCE((SELECT json_agg(item) FROM (
    SELECT json_build_object(
      'id',b.id,'title',b.title,'totalPages',b.total_pages,'revision',b.revision,
      'currentPage',b.current_page,'completedOn',b.completed_on,
      'weekOpeningPage',COALESCE((SELECT c.page FROM daily_progress d JOIN check_ins c ON c.id=d.effective_check_in_id
        WHERE d.book_id=b.id AND d.reading_date < clock."weekStart" ORDER BY d.reading_date DESC LIMIT 1),b.initial_page),
      'beforeToday',COALESCE((SELECT c.page FROM daily_progress d JOIN check_ins c ON c.id=d.effective_check_in_id
        WHERE d.book_id=b.id AND d.reading_date < clock.date ORDER BY d.reading_date DESC LIMIT 1),b.initial_page),
      'days',${days}
    ) AS item FROM books b
    WHERE b.owner_id=${owner} AND b.deleted_at IS NULL AND (b.completed_on IS NULL OR b.completed_on >= clock."weekStart")
    ORDER BY b.created_at,b.id
  ) progress),'[]')`;
}
