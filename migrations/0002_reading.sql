CREATE TABLE books (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
  total_pages INTEGER NOT NULL CHECK(total_pages BETWEEN 1 AND 1000000),
  revision INTEGER NOT NULL DEFAULT 0, current_page INTEGER NOT NULL DEFAULT 0,
  completed_on TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%FT%fZ','now')), deleted_at TEXT,
  request_id TEXT NOT NULL, input_digest TEXT NOT NULL, UNIQUE(owner_id, request_id)
);
CREATE INDEX books_owner ON books(owner_id, deleted_at, created_at);
CREATE TABLE check_ins (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id),
  reading_date TEXT NOT NULL, page INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%FT%fZ','now')),
  expected_revision INTEGER NOT NULL, sequence INTEGER NOT NULL,
  request_id TEXT NOT NULL, input_digest TEXT NOT NULL,
  UNIQUE(book_id, request_id), UNIQUE(book_id, sequence)
);
CREATE TABLE daily_progress (
  book_id TEXT NOT NULL REFERENCES books(id), reading_date TEXT NOT NULL,
  effective_check_in_id TEXT NOT NULL REFERENCES check_ins(id),
  PRIMARY KEY(book_id, reading_date)
);
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
    ), 0) AND total_pages
  );
END;
CREATE TRIGGER project_check_in AFTER INSERT ON check_ins BEGIN
  INSERT INTO daily_progress (book_id, reading_date, effective_check_in_id)
    VALUES (NEW.book_id, NEW.reading_date, NEW.id)
    ON CONFLICT(book_id, reading_date) DO UPDATE SET effective_check_in_id = excluded.effective_check_in_id;
  UPDATE books SET current_page = NEW.page, revision = NEW.sequence,
    completed_on = CASE WHEN NEW.page = total_pages THEN NEW.reading_date END
    WHERE id = NEW.book_id;
END;
CREATE TRIGGER validate_book_total BEFORE UPDATE OF total_pages ON books
WHEN NEW.total_pages <> OLD.total_pages BEGIN
  SELECT RAISE(ABORT, 'page_range') WHERE EXISTS (
    SELECT 1 FROM daily_progress d JOIN check_ins c ON c.id = d.effective_check_in_id
    WHERE d.book_id = OLD.id AND c.page > NEW.total_pages
  );
END;
CREATE TRIGGER project_book_total AFTER UPDATE OF total_pages ON books
WHEN NEW.total_pages <> OLD.total_pages BEGIN
  UPDATE books SET completed_on = CASE WHEN current_page = total_pages
    THEN coalesce(OLD.completed_on, date('now', '+8 hours')) END WHERE id = NEW.id;
END;
