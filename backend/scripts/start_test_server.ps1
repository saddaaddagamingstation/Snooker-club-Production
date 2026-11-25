$ErrorActionPreference = 'Stop'

# Safety gate: the app's startup hook runs seed() and creates indexes/backfills.
# Only run it against a dedicated test database with test-only credentials.
$required = @('MONGO_URL', 'DB_NAME', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'STAFF_EMAIL', 'STAFF_PASSWORD')
foreach ($name in $required) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
        throw "Missing environment variable: $name. Set it to your TEST-only value before starting."
    }
}

$dbName = $env:DB_NAME
if ($dbName -notmatch '(?i)(^|[_-])test($|[_-])') {
    throw "Refusing to start: DB_NAME '$dbName' does not clearly identify a test database. Use a name such as cueops_test."
}
if ($env:JWT_SECRET.Length -lt 32) {
    throw 'Refusing to start: use a unique test JWT_SECRET of at least 32 characters.'
}
if ($env:ADMIN_PASSWORD -eq '0nv821bhx79qf' -or $env:STAFF_PASSWORD -eq 'staff123') {
    throw 'Refusing to start with the source-code default seed passwords. Set unique test-only passwords.'
}
if ($env:ADMIN_EMAIL -eq 'Saddaaddagamingstation@gmail.com' -or $env:STAFF_EMAIL -eq 'staff@snooker.com') {
    throw 'Refusing to start with the source-code default seed emails. Set unique test-only emails.'
}
if ($env:MONGO_URL -notmatch '^mongodb(\+srv)?://') {
    throw 'MONGO_URL does not look like a MongoDB connection string.'
}

# Keep all test API calls local; never inherit a deployed URL from frontend/.env.
$env:REACT_APP_BACKEND_URL = 'http://127.0.0.1:8000'
Write-Host "Starting CUE OPS against database '$dbName' on localhost only." -ForegroundColor Green
Write-Host 'Startup will seed/backfill this database. Confirm it is disposable test data.' -ForegroundColor Yellow
python -m uvicorn server:app --host 127.0.0.1 --port 8000
