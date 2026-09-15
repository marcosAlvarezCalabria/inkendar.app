create table public.artist_availability_rule (
  artist_profile_id uuid primary key,
  studio_id uuid not null references public.studio(id) on delete restrict,
  time_zone text not null check (char_length(time_zone) between 1 and 128),
  slot_increment_minutes integer not null check (slot_increment_minutes between 5 and 240),
  buffer_before_minutes integer not null check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null check (buffer_after_minutes between 0 and 240),
  updated_at timestamptz not null default now(),
  unique (artist_profile_id, studio_id),
  foreign key (artist_profile_id, studio_id) references public.artist_profile(id, studio_id) on delete cascade
);
create table public.artist_availability_window (
  id uuid primary key default gen_random_uuid(), artist_profile_id uuid not null, studio_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6), start_time time not null, end_time time not null,
  check (start_time < end_time),
  foreign key (artist_profile_id, studio_id) references public.artist_availability_rule(artist_profile_id, studio_id) on delete cascade,
  unique (artist_profile_id, weekday, start_time, end_time)
);
alter table public.artist_availability_rule enable row level security;
alter table public.artist_availability_window enable row level security;
revoke all on table public.artist_availability_rule, public.artist_availability_window from public, anon, authenticated, service_role;

create or replace function public.save_artist_availability_rules(p_studio_id uuid,p_owner_user_id uuid,p_artist_profile_id uuid,p_time_zone text,p_slot_increment_minutes integer,p_buffer_before_minutes integer,p_buffer_after_minutes integer,p_windows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare w jsonb;
begin
 perform private.assert_studio_owner(p_studio_id,p_owner_user_id);
 if not exists(select 1 from public.artist_profile where id=p_artist_profile_id and studio_id=p_studio_id) or jsonb_typeof(p_windows)<>'array' or jsonb_array_length(p_windows)>28 then raise exception 'invalid availability' using errcode='22023'; end if;
 insert into public.artist_availability_rule values(p_artist_profile_id,p_studio_id,p_time_zone,p_slot_increment_minutes,p_buffer_before_minutes,p_buffer_after_minutes,now())
 on conflict(artist_profile_id) do update set time_zone=excluded.time_zone,slot_increment_minutes=excluded.slot_increment_minutes,buffer_before_minutes=excluded.buffer_before_minutes,buffer_after_minutes=excluded.buffer_after_minutes,updated_at=now()
 where artist_availability_rule.studio_id=excluded.studio_id;
 delete from public.artist_availability_window where artist_profile_id=p_artist_profile_id and studio_id=p_studio_id;
 for w in select * from jsonb_array_elements(p_windows) loop
  insert into public.artist_availability_window(artist_profile_id,studio_id,weekday,start_time,end_time) values(p_artist_profile_id,p_studio_id,(w->>'weekday')::smallint,(w->>'start')::time,(w->>'end')::time);
 end loop;
 if exists(select 1 from public.artist_availability_window a join public.artist_availability_window b on a.artist_profile_id=b.artist_profile_id and a.weekday=b.weekday and a.id<>b.id and a.start_time<b.end_time and b.start_time<a.end_time where a.artist_profile_id=p_artist_profile_id) then raise exception 'overlapping windows' using errcode='22023'; end if;
end $$;

create or replace function public.get_artist_availability_configuration(p_studio_id uuid,p_owner_user_id uuid,p_artist_profile_id uuid)
returns table(calendar_id text,time_zone text,slot_increment_minutes integer,buffer_before_minutes integer,buffer_after_minutes integer,windows jsonb,connection_id uuid,connection_status public.google_calendar_connection_status,refresh_token_ciphertext text,granted_scopes text[])
language plpgsql stable security definer set search_path='' as $$ begin
 perform private.assert_studio_owner(p_studio_id,p_owner_user_id);
 if not exists(select 1 from public.artist_profile where id=p_artist_profile_id and studio_id=p_studio_id) then raise exception 'artist not found' using errcode='P0002'; end if;
 return query select a.calendar_id,r.time_zone,r.slot_increment_minutes,r.buffer_before_minutes,r.buffer_after_minutes,
 coalesce((select jsonb_agg(jsonb_build_object('weekday',w.weekday,'start_time',to_char(w.start_time,'HH24:MI'),'end_time',to_char(w.end_time,'HH24:MI')) order by w.weekday,w.start_time) from public.artist_availability_window w where w.artist_profile_id=p_artist_profile_id),'[]'::jsonb),
 c.id,c.status,c.refresh_token_ciphertext,c.granted_scopes
 from (select 1) seed left join public.artist_calendar_assignment a on a.artist_profile_id=p_artist_profile_id and a.studio_id=p_studio_id left join public.artist_availability_rule r on r.artist_profile_id=p_artist_profile_id and r.studio_id=p_studio_id left join public.google_calendar_connection c on c.id=a.connection_id and c.studio_id=p_studio_id;
end $$;
revoke all on function public.save_artist_availability_rules(uuid,uuid,uuid,text,integer,integer,integer,jsonb), public.get_artist_availability_configuration(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_artist_availability_rules(uuid,uuid,uuid,text,integer,integer,integer,jsonb), public.get_artist_availability_configuration(uuid,uuid,uuid) to service_role;
