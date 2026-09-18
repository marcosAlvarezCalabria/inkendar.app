param([string]$ContainerName = "supabase_db_inkendar.app")
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$dockerPath = (Get-Command docker -ErrorAction Stop).Source
$studioId="20000000-0000-0000-0000-000000000001";$ownerId="10000000-0000-0000-0000-000000000001";$artistId="50000000-0000-0000-0000-000000000001";$caseId="70000000-0000-0000-0000-000000000091";$customerId="60000000-0000-0000-0000-000000000091"
function Invoke-Db([string]$Sql,[switch]$AllowFailure){$output=(& $script:dockerPath exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atq -c $Sql 2>&1|Out-String);$code=$LASTEXITCODE;if(-not $AllowFailure-and $code-ne 0){throw "database failed $code`n$output"};[pscustomobject]@{ExitCode=$code;Output=$output.Trim()}}
function Start-Db([string]$Sql){Start-Job -ScriptBlock {param($docker,$container,$statement);$PSNativeCommandUseErrorActionPreference=$false;$output=(&$docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atq -c $statement 2>&1|Out-String);[pscustomobject]@{ExitCode=$LASTEXITCODE;Output=$output.Trim()}} -ArgumentList $script:dockerPath,$ContainerName,$Sql}
function Complete-Db($Job){$done=Wait-Job $Job -Timeout 12;if($null-eq $done){Stop-Job $Job;Remove-Job $Job -Force;throw 'race exceeded 12 seconds'};$result=Receive-Job $Job;Remove-Job $Job;if($result.ExitCode-ne 0){throw "job failed $($result.ExitCode)`n$($result.Output)"};$result}
function Assert([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Cleanup{Invoke-Db "delete from public.free_choice_approval_operation where request_id in(select id from public.free_choice_pending_request where tattoo_case_id='$caseId');delete from public.free_choice_pending_request where tattoo_case_id='$caseId';delete from public.free_choice_availability_access where tattoo_case_id='$caseId';delete from public.tattoo_case where id='$caseId';delete from public.customer where id='$customerId';delete from public.artist_availability_rule where artist_profile_id='$artistId';delete from public.artist_calendar_assignment where artist_profile_id='$artistId';delete from public.google_calendar_connection where studio_id='$studioId';"|Out-Null}
function Fixture([string]$Hash,[string]$Selector){Cleanup;Invoke-Db "insert into public.customer(id,studio_id,name,status)values('$customerId','$studioId','Race client','ACTIVE');insert into public.tattoo_case(id,studio_id,customer_id,summary,artist_profile_id,status)values('$caseId','$studioId','$customerId','Race case','$artistId','OPEN');select public.activate_google_calendar_connection('$studioId','$ownerId','v1.pending-choice-ciphertext.tag',array['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.events']);select public.assign_artist_calendar('$studioId','$ownerId','$artistId','artist@example.test','writer');select public.save_artist_availability_rules('$studioId','$ownerId','$artistId','Europe/Dublin',60,0,0,jsonb_build_array(jsonb_build_object('weekday',1,'start','09:00','end','18:00')));select public.rotate_free_choice_availability_access('$studioId','$ownerId','$caseId','$artistId','$Hash','2026-09-25T00:00:00Z','2026-09-27T00:00:00Z',60,'2026-09-24T12:00:00Z','2026-09-20T08:00:00Z');select public.select_public_free_choice_availability('$Hash','$Selector','2026-09-25T09:00:00Z','2026-09-25T10:00:00Z','2026-09-20T09:00:00Z');"|Out-Null;(Invoke-Db "select id from public.free_choice_pending_request where tattoo_case_id='$caseId'").Output}
try{
 $requestId=Fixture ('91'*32) ('a1'*32)
 $approve=Start-Db "begin;set local lock_timeout='8s';set local statement_timeout='9s';select public.claim_free_choice_owner_approval('$studioId','$ownerId','$requestId','inkendarraceapproveevent','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','2026-09-20T09:01:00Z');select pg_sleep(2);commit;"
 Start-Sleep -Milliseconds 1500
 $reject=Invoke-Db "begin;set local lock_timeout='8s';set local statement_timeout='9s';select public.reject_free_choice_owner_request('$studioId','$ownerId','$requestId','2026-09-20T09:01:01Z');commit;" -AllowFailure
 $approved=Complete-Db $approve
 Assert ($approved.Output-match 'CLAIMED') "approve-first did not claim: $($approved.Output)"
 Assert ($reject.ExitCode-ne 0-and $reject.Output-match 'P0002') 'approve-first reject did not fail closed'
 Assert ((Invoke-Db "select status::text from public.free_choice_pending_request where id='$requestId'").Output-eq 'APPROVING') 'approve-first state mismatch'
 $requestId=Fixture ('92'*32) ('a2'*32)
 $rejectJob=Start-Db "begin;set local lock_timeout='8s';set local statement_timeout='9s';select public.reject_free_choice_owner_request('$studioId','$ownerId','$requestId','2026-09-20T09:02:00Z');select pg_sleep(2);commit;"
 Start-Sleep -Milliseconds 1500
 $claim=Invoke-Db "begin;set local lock_timeout='8s';set local statement_timeout='9s';select public.claim_free_choice_owner_approval('$studioId','$ownerId','$requestId','inkendarraceapproveevent','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','2026-09-20T09:02:01Z');commit;"
 $rejected=Complete-Db $rejectJob
 Assert ($rejected.Output-match 'REJECTED') 'reject-first did not reject'
 Assert ($claim.Output-match 'UNAVAILABLE') 'reject-first claim did not fail closed'
 Assert ((Invoke-Db "select status::text from public.free_choice_pending_request where id='$requestId'").Output-eq 'REJECTED') 'reject-first state mismatch'
 Write-Output 'PASS: approve/reject races converged in both lock orders without deadlock'
}finally{Cleanup}