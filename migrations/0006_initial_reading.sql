ALTER TABLE books ADD COLUMN initial_page INTEGER NOT NULL DEFAULT 0 CHECK(initial_page BETWEEN 0 AND total_pages);

DROP TRIGGER validate_check_in;
CREATE TRIGGER validate_check_in BEFORE INSERT ON check_ins BEGIN
  SELECT RAISE(ABORT, 'date_conflict') WHERE NEW.reading_date <> date('now', '+8 hours');
  SELECT RAISE(ABORT, 'page_range') WHERE NOT EXISTS (
    SELECT 1 FROM books WHERE id = NEW.book_id AND deleted_at IS NULL
    AND revision = NEW.expected_revision AND NEW.sequence = revision + 1
    AND (completed_on IS NULL OR completed_on = NEW.reading_date)
    AND NEW.page BETWEEN COALESCE((
      SELECT c.page FROM daily_progress d JOIN check_ins c ON c.id = d.effective_check_in_id
      WHERE d.book_id = NEW.book_id AND d.reading_date < NEW.reading_date
      ORDER BY d.reading_date DESC LIMIT 1
    ), initial_page) AND total_pages
  );
END;

DROP TRIGGER validate_book_total;
CREATE TRIGGER validate_book_total BEFORE UPDATE OF total_pages ON books
WHEN NEW.total_pages <> OLD.total_pages BEGIN
  SELECT RAISE(ABORT, 'page_range') WHERE OLD.initial_page > NEW.total_pages OR EXISTS (
    SELECT 1 FROM daily_progress d JOIN check_ins c ON c.id = d.effective_check_in_id
    WHERE d.book_id = OLD.id AND c.page > NEW.total_pages
  );
END;
