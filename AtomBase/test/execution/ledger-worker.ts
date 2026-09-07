import { ExecutionLedger } from "../../src/core/execution/ledger"

const [, , filepath, attemptID, startAt, operation = "reserve"] = process.argv
while (Date.now() < Number(startAt)) await Bun.sleep(2)

const ledger = ExecutionLedger.open(filepath)
const result =
  operation === "claim-owner"
    ? ledger.claimOwner({ executionID: "exec-race", ownerID: attemptID, leaseMs: 10_000 })
    : ledger.reserve({
        attemptID,
        executionID: "exec-race",
        runID: attemptID,
        fence: 1,
        purpose: "race",
        estimateMicrousd: 60,
      })
process.stdout.write(JSON.stringify(result))
ledger.close()
