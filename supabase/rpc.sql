-- FamilyFlow: SQL-Ausführung für die Edge Function über PostgREST (HTTPS statt Direktverbindung).
-- Nur mit dem service_role-Schlüssel aufrufbar (anon/authenticated haben keinen Zugriff).
-- Jede Anweisung kommt als feste SQL-Teile (aus dem App-Code) + Parameter; Werte werden
-- ausschließlich per quote_literal() eingesetzt. Alle Anweisungen eines Aufrufs laufen in
-- einer Transaktion (entspricht D1 batch()).
create or replace function public.familyflow_exec(statements jsonb)
returns jsonb
language plpgsql
security definer
set search_path = familyflow, pg_temp
as $fn$
declare
  st jsonb; parts jsonb; refs jsonb; params jsonb; q text; v jsonb; i int; head text;
  rows jsonb; n bigint; results jsonb := '[]'::jsonb;
begin
  for st in select value from jsonb_array_elements(statements) loop
    parts := st->'parts'; refs := coalesce(st->'refs', '[]'::jsonb); params := coalesce(st->'params', '[]'::jsonb);
    if jsonb_array_length(parts) <> jsonb_array_length(refs) + 1 then raise exception 'familyflow_exec: ungültige Anweisung'; end if;
    q := parts->>0;
    for i in 1..jsonb_array_length(refs) loop
      v := params -> ((refs->>(i - 1))::int);
      q := q || case when v is null or jsonb_typeof(v) = 'null' then 'NULL' else quote_literal(v #>> '{}') end || (parts->>i);
    end loop;
    head := lower(substring(regexp_replace(q, '^[\s(]+', '') from 1 for 6));
    if head like 'select%' or head like 'with%' or head like 'values%' then
      execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (' || q || ') t' into rows;
      n := jsonb_array_length(rows);
    elsif q ~* '\mreturning\M' then
      execute 'with t as (' || q || ') select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from t' into rows;
      n := jsonb_array_length(rows);
    else
      execute q;
      get diagnostics n = row_count;
      rows := '[]'::jsonb;
    end if;
    results := results || jsonb_build_array(jsonb_build_object('rows', rows, 'count', n));
  end loop;
  return results;
end
$fn$;
revoke all on function public.familyflow_exec(jsonb) from public;
revoke all on function public.familyflow_exec(jsonb) from anon, authenticated;
grant execute on function public.familyflow_exec(jsonb) to service_role;
