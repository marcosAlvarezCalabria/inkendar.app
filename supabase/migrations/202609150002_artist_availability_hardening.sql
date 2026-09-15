create or replace function public.save_artist_availability_rules(
  p_studio_id uuid, p_owner_user_id uuid, p_artist_profile_id uuid, p_time_zone text,
  p_slot_increment_minutes integer, p_buffer_before_minutes integer, p_buffer_after_minutes integer, p_windows jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare w jsonb;
begin
  perform private.assert_studio_owner(p_studio_id, p_owner_user_id);
  if not exists(select 1 from public.artist_profile where id = p_artist_profile_id and studio_id = p_studio_id)
    or p_time_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name = p_time_zone)
    or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 28
  then raise exception 'invalid availability' using errcode = '22023'; end if;

  for w in select * from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(w) <> 'object'
      or (select count(*) from jsonb_object_keys(w)) <> 3
      or jsonb_typeof(w -> 'weekday') <> 'number' or (w ->> 'weekday') !~ '^[0-6]$'
      or jsonb_typeof(w -> 'start') <> 'string' or (w ->> 'start') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      or jsonb_typeof(w -> 'end') <> 'string' or (w ->> 'end') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    then raise exception 'invalid availability window' using errcode = '22023'; end if;
  end loop;

  insert into public.artist_availability_rule(artist_profile_id, studio_id, time_zone, slot_increment_minutes, buffer_before_minutes, buffer_after_minutes, updated_at)
  values(p_artist_profile_id, p_studio_id, p_time_zone, p_slot_increment_minutes, p_buffer_before_minutes, p_buffer_after_minutes, now())
  on conflict(artist_profile_id) do update set time_zone=excluded.time_zone, slot_increment_minutes=excluded.slot_increment_minutes,
    buffer_before_minutes=excluded.buffer_before_minutes, buffer_after_minutes=excluded.buffer_after_minutes, updated_at=now()
  where artist_availability_rule.studio_id=excluded.studio_id;
  delete from public.artist_availability_window where artist_profile_id=p_artist_profile_id and studio_id=p_studio_id;
  for w in select * from jsonb_array_elements(p_windows) loop
    insert into public.artist_availability_window(artist_profile_id,studio_id,weekday,start_time,end_time)
    values(p_artist_profile_id,p_studio_id,(w->>'weekday')::smallint,(w->>'start')::time,(w->>'end')::time);
  end loop;
  if exists(select 1 from public.artist_availability_window a join public.artist_availability_window b on a.artist_profile_id=b.artist_profile_id and a.weekday=b.weekday and a.id<>b.id and a.start_time<b.end_time and b.start_time<a.end_time where a.artist_profile_id=p_artist_profile_id)
  then raise exception 'overlapping windows' using errcode='22023'; end if;
end $$;

revoke all on function public.save_artist_availability_rules(uuid,uuid,uuid,text,integer,integer,integer,jsonb) from public, anon, authenticated;
grant execute on function public.save_artist_availability_rules(uuid,uuid,uuid,text,integer,integer,integer,jsonb) to service_role;
