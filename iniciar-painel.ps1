# Inicia o painel no Windows. Na primeira vez pede a senha do administrador.
# Uso: clique duas vezes em "iniciar-painel.bat" (ou rode este arquivo no PowerShell).
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Fail($msg) { Write-Host "`nERRO: $msg" -ForegroundColor Red; Read-Host "Pressione Enter para fechar"; exit 1 }

try { $v = (node -v) -replace '^v','' } catch { Fail "Node.js não encontrado. Instale a versão LTS em https://nodejs.org e abra este arquivo de novo." }
$parts = $v.Split('.')
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 13)) { Fail "Node.js $v é antigo. Instale o Node.js 22.13 ou mais novo (https://nodejs.org)." }

if (-not (Test-Path 'node_modules')) { Write-Host 'Instalando dependências (só na primeira vez)...'; npm install; if ($LASTEXITCODE -ne 0) { Fail 'npm install falhou.' } }
if (-not (Test-Path 'web\dist\index.html')) { Write-Host 'Preparando o painel (só na primeira vez)...'; npm run build; if ($LASTEXITCODE -ne 0) { Fail 'npm run build falhou.' } }

$bd = Join-Path $PSScriptRoot 'data\dashboard.sqlite'
if (-not (Test-Path $bd)) {
  Write-Host "`nPrimeira execução: vamos criar o administrador."
  $u = Read-Host 'Nome do administrador (ex.: admin)'
  if ([string]::IsNullOrWhiteSpace($u)) { $u = 'admin' }
  do {
    $s1 = Read-Host 'Senha (mínimo 10 caracteres)' -AsSecureString
    $p1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
    if ($p1.Length -lt 10) { Write-Host 'A senha precisa ter pelo menos 10 caracteres.' -ForegroundColor Yellow }
  } while ($p1.Length -lt 10)
  $env:ADMIN_USER = $u
  $env:ADMIN_PASSWORD = $p1
}

if (-not $env:PORT) { $env:PORT = '3000' }
Write-Host "`nPainel em http://127.0.0.1:$($env:PORT)  (feche esta janela ou use Ctrl+C para parar)`n"
Start-Process "http://127.0.0.1:$($env:PORT)"
npm start
