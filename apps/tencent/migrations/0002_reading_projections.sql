SET LOCAL search_path = reading_record, pg_catalog;

CREATE FUNCTION validate_check_in() RETURNS trigger
LANGUAGE plpgsql SET search_path = reading_record, pg_catalog AS $$
DECLARE
  target books%ROWTYPE;
  previous_page integer;
BEGIN
  IF NEW.reading_date <> business_date() THEN
    RAISE EXCEPTION 'date_conflict';
  END IF;

  SELECT * INTO target FROM books WHERE id = NEW.book_id FOR UPDATE;
  IF NOT FOUND OR target.deleted_at IS NOT NULL
     OR target.revision <> NEW.expected_revision OR NEW.sequence <> target.revision + 1
     OR (target.completed_on IS NOT NULL AND target.completed_on <> NEW.reading_date) THEN
    RAISE EXCEPTION 'page_range';
  END IF;

  SELECT c.page INTO previous_page
  FROM daily_progress d JOIN check_ins c ON c.id = d.effective_check_in_id
  WHERE d.book_id = NEW.book_id AND d.reading_date < NEW.reading_date
  ORDER BY d.reading_date DESC LIMIT 1;

  IF NEW.page NOT BETWEEN coalesce(previous_page, target.initial_page) AND target.total_pages THEN
    RAISE EXCEPTION 'page_range';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER validate_check_in BEFORE INSERT ON check_ins
FOR EACH ROW EXECUTE FUNCTION validate_check_in();

CREATE FUNCTION project_check_in() RETURNS trigger
LANGUAGE plpgsql SET search_path = reading_record, pg_catalog AS $$
BEGIN
  INSERT INTO daily_progress (book_id, reading_date, effective_check_in_id)
  VALUES (NEW.book_id, NEW.reading_date, NEW.id)
  ON CONFLICT (book_id, reading_date) DO UPDATE
  SET effective_check_in_id = excluded.effective_check_in_id;

  UPDATE books SET current_page = NEW.page, revision = NEW.sequence,
    completed_on = CASE WHEN NEW.page = total_pages THEN NEW.reading_date END
  WHERE id = NEW.book_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER project_check_in AFTER INSERT ON check_ins
FOR EACH ROW EXECUTE FUNCTION project_check_in();

CREATE FUNCTION change_book_total() RETURNS trigger
LANGUAGE plpgsql SET search_path = reading_record, pg_catalog AS $$
BEGIN
  IF NEW.total_pages < OLD.initial_page OR EXISTS (
    SELECT 1
    FROM daily_progress d JOIN check_ins c ON c.id = d.effective_check_in_id
    WHERE d.book_id = OLD.id AND c.page > NEW.total_pages
  ) THEN
    RAISE EXCEPTION 'page_range';
  END IF;

  NEW.completed_on = CASE WHEN NEW.current_page = NEW.total_pages
    THEN coalesce(OLD.completed_on, business_date()) END;
  RETURN NEW;
END
$$;

CREATE TRIGGER change_book_total BEFORE UPDATE OF total_pages ON books
FOR EACH ROW WHEN (OLD.total_pages IS DISTINCT FROM NEW.total_pages)
EXECUTE FUNCTION change_book_total();

