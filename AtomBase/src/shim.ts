// Shim to override process.cwd() if ATOMCLI_CWD is set
// This allows the app to run in its own directory (for dependency resolution)
// but act as if it is running in the user's directory.

if (process.env.ATOMCLI_CWD) {
    const virtualCwd = process.env.ATOMCLI_CWD
    // console.log("[AtomCLI] Shim: Swapping CWD to", virtualCwd)
    process.cwd = () => virtualCwd
}
