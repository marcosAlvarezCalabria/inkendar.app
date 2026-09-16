param(
  [string]$ContainerName = "supabase_db_inkendar.app"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$dockerPath = (Get-Command docker -ErrorAction Stop).Source
$assetId = "63000000-0000-4000-8000-000000000091"
$handle = "93000000-0000-4000-8000-000000000091"
$studioId = "20000000-0000-0000-0000-000000000001"
$ownerId = "10000000-0000-0000-0000-000000000001"

function Invoke-Database {
  param([string]$Sql, [switch]$AllowFailure)
  $output = (& $script:dockerPath exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atq -c $Sql 2>&1 | Out-String)
  $exitCode = $LASTEXITCODE
  if (-not $AllowFailure -and $exitCode -ne 0) { throw "Database command failed with exit code $exitCode`n$output" }
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
  if ($null -eq $completed) { Stop-Job -Job $Job; Remove-Job -Job $Job -Force; throw "Concurrent publication exceeded 12 seconds" }
  $result = Receive-Job -Job $Job
  Remove-Job -Job $Job
  if ($result.ExitCode -ne 0) { throw "Concurrent publication failed with exit code $($result.ExitCode)`n$($result.Output)" }
  $result
}

function Remove-Fixture {
  Invoke-Database "delete from public.gallery_publication_binding where asset_id='$assetId'; delete from public.gallery_asset where id='$assetId';" | Out-Null
}

Remove-Fixture
try {
  Invoke-Database @"
insert into public.gallery_asset(id,public_id,studio_id,target,artist_profile_id,alt_text,position,status)
values('$assetId','$handle','$studioId','GALLERY',null,'Race fixture',991,'DRAFT');
insert into public.gallery_variant(asset_id,studio_id,kind,object_path,width,height,mime_type,byte_size) values
('$assetId','$studioId','MASTER','$studioId/$assetId/master.webp',10,10,'image/webp',3),
('$assetId','$studioId','DISPLAY','$studioId/$assetId/display.webp',10,10,'image/webp',2),
('$assetId','$studioId','THUMB','$studioId/$assetId/thumb.webp',10,10,'image/webp',1);
"@ | Out-Null

  $publish = Start-DatabaseJob "begin; set local lock_timeout='8s'; set local statement_timeout='9s'; set local role authenticated; select set_config('request.jwt.claim.sub','$ownerId',true); select outcome from public.begin_gallery_publish('$handle'); select pg_sleep(2); commit;"
  $lockObserved = $false
  for ($attempt = 0; $attempt -lt 40 -and -not $lockObserved; $attempt++) {
    $probe = Invoke-Database "select not pg_try_advisory_xact_lock(hashtextextended('gallery:$studioId',0));"
    $lockObserved = $probe.Output -match 't'
    if (-not $lockObserved) { Start-Sleep -Milliseconds 100 }
  }
  if (-not $lockObserved) { throw "Publish session never acquired the shared studio lock" }
  $discard = Invoke-Database "begin; set local lock_timeout='8s'; set local statement_timeout='9s'; set local role authenticated; select set_config('request.jwt.claim.sub','$ownerId',true); select public.discard_gallery_draft('$handle'); commit;" -AllowFailure
  $publishResult = Complete-DatabaseJob $publish
  if ($publishResult.Output -notmatch 'WORK') { throw "Publish session did not begin work: $($publishResult.Output)" }
  if ($discard.ExitCode -eq 0 -or $discard.Output -notmatch '42501') { throw "Concurrent discard did not wait then fail closed: $($discard.Output)" }
  $state = Invoke-Database "select status::text||':'||(select count(*) from public.gallery_publication_binding where asset_id='$assetId')::text from public.gallery_asset where id='$assetId';"
  if ($state.Output -notmatch 'PUBLISHING:1') { throw "Race did not preserve one PUBLISHING binding: $($state.Output)" }
  Write-Output "gallery publication race passed: publish serialized before discard; one PUBLISHING binding remains"
}
finally { Remove-Fixture }
