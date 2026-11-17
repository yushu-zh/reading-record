CREATE FUNCTION public.reading_record_batch(commands jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = reading_record, pg_catalog AS $$
DECLARE
  command jsonb;
  query text;
  fragments text[];
  rows jsonb;
  changes integer;
  position integer;
  result jsonb := '[]'::jsonb;
BEGIN
  IF current_user <> 'service_role' AND
     coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Reading record server access required';
  END IF;
  FOR command IN SELECT value FROM jsonb_array_elements(commands) LOOP
    fragments := string_to_array(command->>'sql', '__rr_bind__');
    IF cardinality(fragments) <> jsonb_array_length(command->'values') + 1 THEN
      RAISE EXCEPTION 'Invalid reading record parameters';
    END IF;
    query := fragments[1];
    -- Use only the original SQL fragments so parameter text is never reparsed as a placeholder.
    FOR position IN 2..cardinality(fragments) LOOP
      query := query || quote_nullable(command->'values'->(position - 2) #>> '{}') || fragments[position];
    END LOOP;

    rows := '[]'::jsonb;
    IF query ~* '^(SELECT|WITH)[[:space:]]' THEN
      EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) FROM (' || query || ') q' INTO rows;
      changes := 0;
    ELSIF query ~* '^(INSERT|UPDATE|DELETE)[[:space:]]' THEN
      IF query ~* '[[:space:]]RETURNING[[:space:]]' THEN
        EXECUTE 'WITH changed AS (' || query || ') SELECT coalesce(jsonb_agg(to_jsonb(changed)), ''[]''::jsonb) FROM changed'
          INTO rows;
        changes := jsonb_array_length(rows);
      ELSE
        EXECUTE query;
        GET DIAGNOSTICS changes = ROW_COUNT;
      END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported reading record statement';
    END IF;
    result := result || jsonb_build_array(jsonb_build_object('results', rows, 'meta', jsonb_build_object('changes', changes)));
  END LOOP;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.reading_record_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reading_record_batch(jsonb) TO service_role;
GRANT USAGE ON SCHEMA reading_record TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA reading_record TO service_role;
NOTIFY pgrst, 'reload schema';
