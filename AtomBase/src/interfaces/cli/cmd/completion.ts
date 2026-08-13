import type { Argv } from "yargs"
import { cmd } from "./cmd"

export namespace ShellCompletion {
  export type Shell = "bash" | "zsh" | "fish" | "powershell"

  export function detect(env: { shell?: string; platform?: NodeJS.Platform } = {}): Shell {
    const shell = env.shell ?? process.env.SHELL ?? ""
    const platform = env.platform ?? process.platform
    if (platform === "win32" || /(?:^|\/)(?:pwsh|powershell)(?:\.exe)?$/i.test(shell)) return "powershell"
    if (shell.endsWith("/zsh")) return "zsh"
    if (shell.endsWith("/fish")) return "fish"
    return "bash"
  }

  export function script(shell: Shell) {
    if (shell === "bash") {
      return `# AtomCLI completion for Bash
_atomcli_completion() {
  local current suggestion
  current="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=()
  while IFS= read -r suggestion; do
    COMPREPLY+=("$suggestion")
  done < <(compgen -W "$(atomcli --get-yargs-completions "\${COMP_WORDS[@]}")" -- "$current")
}
complete -o bashdefault -o default -F _atomcli_completion atomcli
`
    }

    if (shell === "zsh") {
      return `#compdef atomcli
# AtomCLI completion for Zsh
autoload -Uz compinit
(( $+functions[compdef] )) || compinit
_atomcli_completion() {
  local -a suggestions
  suggestions=("\${(@f)$(atomcli --get-yargs-completions "\${words[@]}")}")
  _describe 'atomcli command' suggestions
}
compdef _atomcli_completion atomcli
`
    }

    if (shell === "fish") {
      return `# AtomCLI completion for Fish
function __atomcli_completion
  set -l words (commandline -opc)
  set -a words (commandline -ct)
  atomcli --get-yargs-completions $words
end
complete -c atomcli -f -a '(__atomcli_completion)'
`
    }

    return `# AtomCLI completion for PowerShell
function Invoke-AtomCLICompletion {
  param($wordToComplete, $commandAst)
  $words = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  atomcli --get-yargs-completions @words |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}

if ((Get-Command Register-ArgumentCompleter).Parameters.ContainsKey('Native')) {
  Register-ArgumentCompleter -Native -CommandName atomcli -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    Invoke-AtomCLICompletion $wordToComplete $commandAst
  }
} else {
  Register-ArgumentCompleter -CommandName atomcli -ScriptBlock {
    param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
    Invoke-AtomCLICompletion $wordToComplete $commandAst
  }
}
`
  }

  export function clean(suggestions: string[] | undefined) {
    return [...new Set((suggestions ?? []).filter((item) => item !== "$0" && item !== "__completion"))]
  }
}

export const CompletionCommand = cmd({
  command: "completion [shell]",
  describe: "print a shell tab-completion script",
  builder: (yargs: Argv) =>
    yargs.positional("shell", {
      type: "string",
      choices: ["bash", "zsh", "fish", "powershell"] as const,
      describe: "shell type (auto-detected when omitted)",
    }),
  handler: async (args) => {
    const shell = (args.shell as ShellCompletion.Shell | undefined) ?? ShellCompletion.detect()
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(ShellCompletion.script(shell), (error) => (error ? reject(error) : resolve()))
    })
  },
})
