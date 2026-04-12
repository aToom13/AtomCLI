import path from "path"
import { BunProc } from "@/bun"
import { Installation } from "@/installation"

export async function installDependencies(dir: string) {
    const pkg = path.join(dir, "package.json")

    if (!(await Bun.file(pkg).exists())) {
        await Bun.write(pkg, "{}")
    }

    const gitignore = path.join(dir, ".gitignore")
    const hasGitIgnore = await Bun.file(gitignore).exists()
    if (!hasGitIgnore) await Bun.write(gitignore, ["node_modules", "package.json", "bun.lock", ".gitignore"].join("\n"))

    await BunProc.run(
        ["add", "@atomcli/plugin@" + (Installation.isLocal() ? "latest" : Installation.VERSION), "--exact"],
        {
            cwd: dir,
        },
    ).catch(() => { })

    // Install any additional dependencies defined in the package.json
    // This allows local plugins and custom tools to use external packages
    await BunProc.run(["install"], { cwd: dir }).catch(() => { })
}
