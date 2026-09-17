begin;
select plan(13);

select has_function('private','lock_gallery_studio',array['uuid'],'shared gallery studio lock helper exists');
select is((
  select proc.proconfig from pg_proc proc join pg_namespace namespace on namespace.oid=proc.pronamespace
  where namespace.nspname='private' and proc.proname='lock_gallery_studio'
),array['search_path=""'],'studio lock helper fixes empty search path');
select ok(not has_function_privilege('authenticated','private.lock_gallery_studio(uuid)','execute'),'authenticated cannot acquire the internal lock directly');
select ok(not has_function_privilege('service_role','private.lock_gallery_studio(uuid)','execute'),'service role cannot acquire the internal lock directly');
select ok(position('pg_advisory_xact_lock' in coalesce((
  select pg_get_functiondef(proc.oid) from pg_proc proc join pg_namespace namespace on namespace.oid=proc.pronamespace
  where namespace.nspname='private' and proc.proname='lock_gallery_studio'
),''))>0,'helper uses a transaction-scoped advisory lock');
select ok(position('gallery:' in coalesce((
  select pg_get_functiondef(proc.oid) from pg_proc proc join pg_namespace namespace on namespace.oid=proc.pronamespace
  where namespace.nspname='private' and proc.proname='lock_gallery_studio'
),''))>0,'helper derives one namespaced lock from studio identity');
select ok(position('private.lock_gallery_studio' in pg_get_functiondef('public.create_gallery_draft(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0,'create joins the shared studio serialization contract');
select ok(position('private.lock_gallery_studio' in pg_get_functiondef('public.update_gallery_draft(uuid,text,text,uuid)'::regprocedure))>0
  and position('private.lock_gallery_studio' in pg_get_functiondef('public.update_gallery_draft(uuid,text,text,uuid)'::regprocedure))
    < position('for update' in lower(pg_get_functiondef('public.update_gallery_draft(uuid,text,text,uuid)'::regprocedure))),
  'update takes the studio lock before its row lock');
select ok(position('private.lock_gallery_studio' in pg_get_functiondef('public.move_gallery_draft(uuid,text)'::regprocedure))>0
  and position('private.lock_gallery_studio' in pg_get_functiondef('public.move_gallery_draft(uuid,text)'::regprocedure))
    < position('for update' in lower(pg_get_functiondef('public.move_gallery_draft(uuid,text)'::regprocedure))),
  'move takes the studio lock before its row lock');
select ok(position('private.lock_gallery_studio' in pg_get_functiondef('public.discard_gallery_draft(uuid)'::regprocedure))>0
  and position('private.lock_gallery_studio' in pg_get_functiondef('public.discard_gallery_draft(uuid)'::regprocedure))
    < position('for update' in lower(pg_get_functiondef('public.discard_gallery_draft(uuid)'::regprocedure))),
  'discard takes the studio lock before its row lock');
select ok(position('private.lock_gallery_studio' in pg_get_functiondef('public.restore_gallery_draft(uuid)'::regprocedure))>0
  and position('private.lock_gallery_studio' in pg_get_functiondef('public.restore_gallery_draft(uuid)'::regprocedure))
    < position('for update' in lower(pg_get_functiondef('public.restore_gallery_draft(uuid)'::regprocedure))),
  'restore takes the studio lock before its row lock');
select ok(pg_get_functiondef('public.update_gallery_draft(uuid,text,text,uuid)'::regprocedure) !~* '[[:space:]]loop[[:space:]]','update cannot retain obsolete locks across a retry loop');
select ok((
  pg_get_functiondef('public.create_gallery_draft(uuid,uuid,text,uuid,text,jsonb)'::regprocedure)
  ||pg_get_functiondef('public.update_gallery_draft(uuid,text,text,uuid)'::regprocedure)
  ||pg_get_functiondef('public.move_gallery_draft(uuid,text)'::regprocedure)
  ||pg_get_functiondef('public.discard_gallery_draft(uuid)'::regprocedure)
  ||pg_get_functiondef('public.restore_gallery_draft(uuid)'::regprocedure)
) !~ 'pg_advisory_xact_lock','position mutations use only the common studio lock helper');

select * from finish();
rollback;
