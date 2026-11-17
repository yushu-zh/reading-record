import { firstStatisticsYear, type BookHistory, type DailyTotal, type Statistics } from '../../../packages/contracts';
import { businessDay, type Database } from './database';
import { id, router } from './http';

async function getStatistics(db: Database, owner: string): Promise<Statistics> {
  const [books, dailyTotals] = await Promise.all([
    db.prepare(`
      SELECT b.id, b.title, b.total_pages AS "totalPages", b.revision,
        b.current_page AS "currentPage", b.completed_on AS "completedOn",
        CASE WHEN b.completed_on IS NOT NULL THEN coalesce((
          SELECT json_agg(json_build_object('date', d.reading_date, 'page', c.page) ORDER BY d.reading_date)
          FROM daily_progress d JOIN check_ins c ON c.id = d.effective_check_in_id
          WHERE d.book_id = b.id
        ), '[]'::json) ELSE '[]'::json END AS "checkIns"
      FROM books b
      WHERE b.owner_id = ? AND b.deleted_at IS NULL
      ORDER BY b.completed_on DESC NULLS FIRST,
        CASE WHEN b.completed_on IS NULL THEN b.created_at END, b.id
    `).bind(owner).all<BookHistory>(),
    db.prepare(`
      WITH increments AS (
        SELECT d.reading_date AS date,
          c.page - lag(c.page, 1, b.initial_page) OVER (
            PARTITION BY b.id ORDER BY d.reading_date
          ) AS pages
        FROM books b
        JOIN daily_progress d ON d.book_id = b.id
        JOIN check_ins c ON c.id = d.effective_check_in_id
        WHERE b.owner_id = ?
      )
      SELECT date, sum(pages)::double precision AS pages
      FROM increments
      WHERE date BETWEEN least(?::text, to_char(${businessDay}::date - 29, 'YYYY-MM-DD')) AND ${businessDay}
      GROUP BY date
      ORDER BY date
    `).bind(owner, `${firstStatisticsYear}-01-01`).all<DailyTotal>(),
  ]);

  return {
    reading: books.results.filter(book => book.completedOn === null).map(({ checkIns, ...book }) => book),
    completed: books.results.filter(book => book.completedOn !== null),
    dailyTotals: dailyTotals.results,
  };
}

export const statistics = router();
statistics.get('/', async c => c.json(await getStatistics(c.env.DB, id(c))));
