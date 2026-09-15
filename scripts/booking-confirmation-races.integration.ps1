param(
  [string]$ContainerName = "supabase_db_inkendar.app"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$dockerPath = (Get-Command docker -ErrorAction Stop).Source

$studioId = "26000000-0000-0000-0000-000000000061"
$ownerId = "10000000-0000-0000-0000-000000000001"
$artistId = "56000000-0000-0000-0000-000000000061"
$caseId = "76000000-0000-0000-0000-000000000061"
$connectionId = "86000000-0000-0000-0000-000000000061"

function Invoke-Database {
  param([string]$Sql, [switch]$AllowFailure)
  $output = (& $script:dockerPath exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atq -c $Sql 2>&1 | Out-String)
  $exitCode = $LASTEXITCODE
  if (-not $AllowFailure -and $exitCode -ne 0) {
    throw "Database command failed with exit code $exitCode`n$output"
  }
  [pscustomobject]@{ ExitCode = $exitCode; Output = $output.Trim() }
}

function Start-DatabaseJob {
  param([string]$Sql)
  Start-Job -ScriptBlock {
    param($DockerPath, $Container, $Statement)
    $PSNativeCommandUseErrorActionPreference = $false
    $output = (& $DockerPath exec $Container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atq -c $Statement 2>&1 | Out-String)
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output.Trim() }
  } -ArgumentList $script:dockerPath, $ContainerName, $Sql
}

function Complete-DatabaseJob {
  param([System.Management.Automation.Job]$Job)
  $completed = Wait-Job -Job $Job -Timeout 12
  if ($null -eq $completed) {
    Stop-Job -Job $Job
    Remove-Job -Job $Job -Force
    throw "Concurrent database command exceeded 12 seconds"
  }
  $result = Receive-Job -Job $Job
  Remove-Job -Job $Job
  if ($result.ExitCode -ne 0) {
    throw "Concurrent database command failed with exit code $($result.ExitCode)`n$($result.Output)"
  }
  $result
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Test-DatabaseValue {
  param([string]$Output, [string]$Value)
  ($Output -split '\s+') -contains $Value
}

function Reset-BookingRows {
  Invoke-Database @"
begin;
delete from public.booking_confirmation_operation where studio_id = '$studioId';
delete from public.booking_offer_public_access where studio_id = '$studioId';
delete from public.booking_option where studio_id = '$studioId';
delete from public.booking_offer where studio_id = '$studioId';
commit;
"@ | Out-Null
}

function New-ReadyFixture {
  param(
    [string]$TokenHash,
    [string]$LeaseId,
    [string]$EventId,
    [string]$Correlation,
    [string]$IntervalStart,
    [string]$IntervalEnd
  )
  Reset-BookingRows
  Invoke-Database @"
do `$fixture`$
declare
  v_offer jsonb;
  v_offer_id uuid;
  v_selector text;
  v_option_id uuid;
begin
  v_offer := public.create_booking_offer(
    '$studioId','$ownerId','$caseId','$artistId',
    jsonb_build_array(jsonb_build_object('startUtc','$IntervalStart','endUtc','$IntervalEnd')),
    '2026-09-15T08:00:00Z'
  );
  v_offer_id := (v_offer->>'id')::uuid;
  perform public.rotate_booking_offer_public_access('$studioId','$ownerId',v_offer_id,'$TokenHash','2026-09-15T08:00:10Z');
  v_selector := public.get_public_booking_offer('$TokenHash','2026-09-15T08:00:20Z')->'options'->0->>'selector';
  perform public.select_public_booking_offer('$TokenHash',v_selector,'2026-09-15T08:00:30Z');
  select id into strict v_option_id from public.booking_option where offer_id = v_offer_id and status = 'SELECTED';
  insert into public.booking_confirmation_operation(
    booking_offer_id,studio_id,artist_profile_id,booking_option_id,connection_id,calendar_id,
    event_id,correlation,state,lease_id,lease_expires_at,created_at,updated_at
  ) values (
    v_offer_id,'$studioId','$artistId',v_option_id,'$connectionId','synthetic-race@example.test',
    '$EventId','$Correlation','READY','$LeaseId','2026-09-15T09:02:00Z','2026-09-15T08:00:40Z','2026-09-15T08:00:40Z'
  );
end
`$fixture`$;
"@ | Out-Null
}

function Assert-State {
  param([string]$Expected)
  $state = Invoke-Database @"
select offer.status::text || '|' || option.status::text || '|' || operation.state::text
from public.booking_offer offer
join public.booking_option option on option.offer_id = offer.id and option.studio_id = offer.studio_id
join public.booking_confirmation_operation operation on operation.booking_offer_id = offer.id
where offer.studio_id = '$studioId';
"@
  Assert-True ($state.Output -eq $Expected) "Expected state $Expected, got $($state.Output)"
}

$cleanupSql = @"
begin;
delete from public.appointment_google_event where studio_id = '$studioId';
delete from public.appointment where studio_id = '$studioId';
delete from public.booking_confirmation_operation where studio_id = '$studioId';
delete from public.booking_offer_public_access where studio_id = '$studioId';
delete from public.booking_option where studio_id = '$studioId';
delete from public.booking_offer where studio_id = '$studioId';
delete from public.artist_calendar_assignment where studio_id = '$studioId';
delete from public.google_calendar_connection where studio_id = '$studioId';
delete from public.tattoo_case where studio_id = '$studioId';
delete from public.customer where studio_id = '$studioId';
delete from public.artist_profile where studio_id = '$studioId';
delete from public.membership where studio_id = '$studioId';
delete from public.user_profile where studio_id = '$studioId';
delete from public.studio where id = '$studioId';
commit;
"@

try {
  Invoke-Database $cleanupSql | Out-Null
  Invoke-Database @"
begin;
insert into public.studio(id,name,booking_offer_expiry_hours) values('$studioId','Synthetic race studio',1);
insert into public.user_profile(id,studio_id,user_id,display_name) values
  ('36000000-0000-0000-0000-000000000061','$studioId','$ownerId','Synthetic owner'),
  ('36000000-0000-0000-0000-000000000062','$studioId','10000000-0000-0000-0000-000000000002','Synthetic artist');
insert into public.membership(id,studio_id,user_id,user_profile_id,role) values
  ('46000000-0000-0000-0000-000000000061','$studioId','$ownerId','36000000-0000-0000-0000-000000000061','OWNER'),
  ('46000000-0000-0000-0000-000000000062','$studioId','10000000-0000-0000-0000-000000000002','36000000-0000-0000-0000-000000000062','ARTIST');
insert into public.artist_profile(id,studio_id,membership_id,user_id,display_name)
  values('$artistId','$studioId','46000000-0000-0000-0000-000000000062','10000000-0000-0000-0000-000000000002','Synthetic artist');
insert into public.customer(id,studio_id,name,status)
  values('66000000-0000-0000-0000-000000000061','$studioId','Synthetic client','ACTIVE');
insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status)
  values('$caseId','$studioId','66000000-0000-0000-0000-000000000061','Synthetic race case','$artistId','OPEN');
insert into public.google_calendar_connection(id,studio_id,status) values('$connectionId','$studioId','DISCONNECTED');
commit;
"@ | Out-Null

  $correlation = "A" * 43

  # beginInsert wins: create waits on the offer, observes INSERTING, and rejects overlap.
  New-ReadyFixture ("a" * 64) "96000000-0000-4000-8000-000000000061" "inkendar0123456789eaa" $correlation "2026-09-28T09:00:00Z" "2026-09-28T10:00:00Z"
  $beginJob = Start-DatabaseJob @"
begin;
set local lock_timeout = '8s'; set local statement_timeout = '9s';
select public.begin_public_booking_confirmation_insert('$('a' * 64)','96000000-0000-4000-8000-000000000061','2026-09-15T08:59:00Z');
select pg_sleep(2);
commit;
"@
  Start-Sleep -Milliseconds 750
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $createResult = Invoke-Database @"
begin;
set local lock_timeout = '8s'; set local statement_timeout = '9s';
select public.create_booking_offer('$studioId','$ownerId','$caseId','$artistId','[{"startUtc":"2026-09-28T09:30:00Z","endUtc":"2026-09-28T10:30:00Z"}]','2026-09-15T09:01:00Z');
commit;
"@ -AllowFailure
  $watch.Stop()
  $beginResult = Complete-DatabaseJob $beginJob
  Assert-True (Test-DatabaseValue $beginResult.Output 't') "begin-first did not acquire INSERTING: $($beginResult.Output)"
  Assert-True ($createResult.ExitCode -ne 0 -and $createResult.Output -match '23P01') "begin-first create did not fail with 23P01"
  Assert-True ($watch.Elapsed.TotalSeconds -lt 10) "begin-first/create exceeded 10 seconds"
  Assert-State "SELECTED_PENDING_CONFIRMATION|SELECTED|INSERTING"

  # create wins: it expires READY before inserting; stale begin waits and returns false.
  New-ReadyFixture ("b" * 64) "96000000-0000-4000-8000-000000000062" "inkendar0123456789eab" $correlation "2026-09-29T09:00:00Z" "2026-09-29T10:00:00Z"
  $createJob = Start-DatabaseJob @"
begin;
set local lock_timeout = '8s'; set local statement_timeout = '9s';
select public.create_booking_offer('$studioId','$ownerId','$caseId','$artistId','[{"startUtc":"2026-09-29T09:30:00Z","endUtc":"2026-09-29T10:30:00Z"}]','2026-09-15T09:01:00Z');
select pg_sleep(2);
commit;
"@
  Start-Sleep -Milliseconds 750
  $watch.Restart()
  $beginResult = Invoke-Database "begin; set local lock_timeout='8s'; set local statement_timeout='9s'; select public.begin_public_booking_confirmation_insert('$('b' * 64)','96000000-0000-4000-8000-000000000062','2026-09-15T08:59:00Z'); commit;"
  $watch.Stop()
  $createResult = Complete-DatabaseJob $createJob
  Assert-True ($createResult.ExitCode -eq 0) "create-first failed"
  Assert-True (Test-DatabaseValue $beginResult.Output 'f') "create-first stale begin did not return false: $($beginResult.Output)"
  Assert-True ($watch.Elapsed.TotalSeconds -lt 10) "create-first/begin exceeded 10 seconds"
  $createFirst = Invoke-Database "select count(*) filter(where offer.status='EXPIRED' and option.status='RELEASED') || '|' || count(*) filter(where offer.status='OPEN' and option.status='HELD') from public.booking_offer offer join public.booking_option option on option.offer_id=offer.id where offer.studio_id='$studioId';"
  Assert-True ($createFirst.Output -eq "1|1") "create-first did not converge to one released and one active option: $($createFirst.Output)"

  # beginInsert wins against explicit expiry.
  New-ReadyFixture ("c" * 64) "96000000-0000-4000-8000-000000000063" "inkendar0123456789eac" $correlation "2026-09-30T09:00:00Z" "2026-09-30T10:00:00Z"
  $beginJob = Start-DatabaseJob "begin; set local lock_timeout='8s'; set local statement_timeout='9s'; select public.begin_public_booking_confirmation_insert('$('c' * 64)','96000000-0000-4000-8000-000000000063','2026-09-15T08:59:00Z'); select pg_sleep(2); commit;"
  Start-Sleep -Milliseconds 750
  $watch.Restart()
  $expiryResult = Invoke-Database "begin; set local lock_timeout='8s'; set local statement_timeout='9s'; select public.expire_booking_offers('$studioId','$ownerId','2026-09-15T09:01:00Z'); commit;"
  $watch.Stop()
  $beginResult = Complete-DatabaseJob $beginJob
  Assert-True ((Test-DatabaseValue $beginResult.Output 't') -and (Test-DatabaseValue $expiryResult.Output '0')) "begin-first/expiry did not preserve INSERTING"
  Assert-True ($watch.Elapsed.TotalSeconds -lt 10) "begin-first/expiry exceeded 10 seconds"
  Assert-State "SELECTED_PENDING_CONFIRMATION|SELECTED|INSERTING"

  # expiry wins: stale begin waits and returns false.
  New-ReadyFixture ("d" * 64) "96000000-0000-4000-8000-000000000064" "inkendar0123456789ead" $correlation "2026-10-01T09:00:00Z" "2026-10-01T10:00:00Z"
  $expiryJob = Start-DatabaseJob "begin; set local lock_timeout='8s'; set local statement_timeout='9s'; select public.expire_booking_offers('$studioId','$ownerId','2026-09-15T09:01:00Z'); select pg_sleep(2); commit;"
  Start-Sleep -Milliseconds 750
  $watch.Restart()
  $beginResult = Invoke-Database "begin; set local lock_timeout='8s'; set local statement_timeout='9s'; select public.begin_public_booking_confirmation_insert('$('d' * 64)','96000000-0000-4000-8000-000000000064','2026-09-15T08:59:00Z'); commit;"
  $watch.Stop()
  $expiryResult = Complete-DatabaseJob $expiryJob
  Assert-True ((Test-DatabaseValue $expiryResult.Output '1') -and (Test-DatabaseValue $beginResult.Output 'f')) "expiry-first/begin did not expire and fence stale begin"
  Assert-True ($watch.Elapsed.TotalSeconds -lt 10) "expiry-first/begin exceeded 10 seconds"
  Assert-State "EXPIRED|RELEASED|READY"

  Write-Output "PASS: begin/create and begin/expiry races converged under 10 seconds without deadlock"
}
finally {
  Invoke-Database $cleanupSql | Out-Null
}
