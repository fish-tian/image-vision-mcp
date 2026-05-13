param(
  [string]$AnthropicAuthToken,
  [string]$AnthropicBaseUrl,
  [string]$QwenModel,
  [string]$ConfigPath = "$HOME\.image-vision-mcp\config.json",
  [string]$Scope = "user",
  [string]$Name = "image-vision"
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Required command '$CommandName' was not found in PATH."
  }
}

function Mask-Token {
  param([string]$Token)

  if (-not $Token) {
    return ""
  }

  if ($Token.Length -le 8) {
    return "********"
  }

  return "$($Token.Substring(0, 4))...$($Token.Substring($Token.Length - 4))"
}

function Confirm-DefaultYes {
  param([string]$Prompt)

  $answer = Read-Host "$Prompt [Y/n]"
  return -not ($answer -match '^(n|no)$')
}

function Read-Optional {
  param([string]$Prompt, [string]$DefaultValue)

  if ($DefaultValue) {
    $answer = Read-Host "$Prompt [$DefaultValue]"
    if ($answer) {
      return $answer
    }
    return $DefaultValue
  }

  return Read-Host $Prompt
}

Require-Command node
Require-Command claude

if (-not $AnthropicAuthToken -and $env:ANTHROPIC_AUTH_TOKEN) {
  $masked = Mask-Token $env:ANTHROPIC_AUTH_TOKEN
  if (Confirm-DefaultYes "Found ANTHROPIC_AUTH_TOKEN=$masked in environment. Use it for config?") {
    $AnthropicAuthToken = $env:ANTHROPIC_AUTH_TOKEN
  }
}

if (-not $AnthropicAuthToken) {
  $secureToken = Read-Host "ANTHROPIC_AUTH_TOKEN" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try {
    $AnthropicAuthToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if (-not $AnthropicAuthToken) {
  throw "ANTHROPIC_AUTH_TOKEN is required."
}

if (-not $AnthropicBaseUrl -and $env:ANTHROPIC_BASE_URL) {
  if (Confirm-DefaultYes "Found ANTHROPIC_BASE_URL=$env:ANTHROPIC_BASE_URL in environment. Use it for config?") {
    $AnthropicBaseUrl = $env:ANTHROPIC_BASE_URL
  }
}

if (-not $QwenModel -and $env:QWEN_MODEL) {
  if (Confirm-DefaultYes "Found QWEN_MODEL=$env:QWEN_MODEL in environment. Use it for config?") {
    $QwenModel = $env:QWEN_MODEL
  }
}

if (-not $AnthropicBaseUrl) {
  $AnthropicBaseUrl = Read-Optional "ANTHROPIC_BASE_URL (optional)" ""
}

if (-not $QwenModel) {
  $QwenModel = Read-Optional "QWEN_MODEL" "openai/qwen3.6-plus"
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Entrypoint = Join-Path $Root "dist\index.js"

if (-not (Test-Path $Entrypoint)) {
  throw "Cannot find bundled server at $Entrypoint. Make sure the release zip was extracted completely."
}

$ConfigDir = Split-Path -Parent $ConfigPath
New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

$config = [ordered]@{
  api = [ordered]@{
    authToken = $AnthropicAuthToken
    model = $QwenModel
    maxTokens = 64000
    defaultPrompt = "Please analyze the image content."
  }
  cache = [ordered]@{
    dir = "~/.image-vision-cache"
    ttlHours = 24
    maxMb = 500
    lockTimeoutMs = 5000
  }
  image = [ordered]@{
    fetchTimeoutMs = 30000
    maxBytes = 20971520
  }
  log = [ordered]@{
    level = "info"
  }
}

if ($AnthropicBaseUrl) {
  $config.api["baseUrl"] = $AnthropicBaseUrl
}

$config | ConvertTo-Json -Depth 8 | Set-Content -Path $ConfigPath -Encoding UTF8

Write-Host "Wrote config: $ConfigPath"
Write-Host "Registering Claude Code MCP server '$Name'..."
& claude mcp add -s $Scope $Name -- node $Entrypoint

Write-Host ""
Write-Host "Installed MCP server:"
& claude mcp get $Name
