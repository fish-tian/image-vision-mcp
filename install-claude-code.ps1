param(
  [string]$AnthropicAuthToken = $env:ANTHROPIC_AUTH_TOKEN,
  [string]$AnthropicBaseUrl = $env:ANTHROPIC_BASE_URL,
  [string]$QwenModel = $env:QWEN_MODEL,
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

Require-Command node
Require-Command claude

if (-not $AnthropicAuthToken) {
  $secureToken = Read-Host "ANTHROPIC_AUTH_TOKEN" -AsSecureString
  $AnthropicAuthToken = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  )
}

if (-not $AnthropicAuthToken) {
  throw "ANTHROPIC_AUTH_TOKEN is required."
}

if (-not $QwenModel) {
  $QwenModel = "openai/qwen3.6-plus"
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Entrypoint = Join-Path $Root "dist\index.js"

if (-not (Test-Path $Entrypoint)) {
  throw "Cannot find bundled server at $Entrypoint. Make sure the release zip was extracted completely."
}

$envArgs = @(
  "-e", "ANTHROPIC_AUTH_TOKEN=$AnthropicAuthToken",
  "-e", "QWEN_MODEL=$QwenModel"
)

if ($AnthropicBaseUrl) {
  $envArgs += @("-e", "ANTHROPIC_BASE_URL=$AnthropicBaseUrl")
}

Write-Host "Registering Claude Code MCP server '$Name'..."
& claude mcp add -s $Scope @envArgs $Name -- node $Entrypoint

Write-Host ""
Write-Host "Installed MCP server:"
& claude mcp get $Name
