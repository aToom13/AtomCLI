import { Database } from "bun:sqlite"

export function initialize(db: Database) {
  db.run("BEGIN IMMEDIATE")
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS execution (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        resumes_execution_id TEXT,
        budget_scope_id TEXT NOT NULL DEFAULT '',
        session_generation INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        fence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        deadline_at INTEGER,
        max_calls INTEGER,
        max_steps INTEGER,
        max_cost INTEGER,
        project_max_cost INTEGER,
        owner_id TEXT,
        lease_expires_at INTEGER,
        unknown_price_blocked INTEGER NOT NULL DEFAULT 0,
        mutation_revision INTEGER NOT NULL DEFAULT 0,
        plan_revision INTEGER NOT NULL DEFAULT 0,
        route_revision INTEGER NOT NULL DEFAULT 1,
        lifecycle TEXT NOT NULL DEFAULT 'active',
        phase TEXT NOT NULL DEFAULT 'preparing',
        outcome TEXT,
        reason_code TEXT,
        reason_message TEXT,
        reason_retryable INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL DEFAULT 0,
        terminal_at INTEGER,
        deleted_at INTEGER
      )
    `)
    const executionColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution)")
        .all()
        .map((column) => column.name),
    )
    if (!executionColumns.has("max_steps")) db.run("ALTER TABLE execution ADD COLUMN max_steps INTEGER")
    if (!executionColumns.has("resumes_execution_id")) {
      db.run("ALTER TABLE execution ADD COLUMN resumes_execution_id TEXT")
    }
    if (!executionColumns.has("budget_scope_id")) {
      db.run("ALTER TABLE execution ADD COLUMN budget_scope_id TEXT NOT NULL DEFAULT ''")
      db.run("UPDATE execution SET budget_scope_id = id WHERE budget_scope_id = ''")
    }
    // Keep existing grant columns for durable adaptive-slice accounting.
    // Explicit max_calls/max_steps remain hard admission ceilings.
    if (!executionColumns.has("granted_calls")) {
      db.run("ALTER TABLE execution ADD COLUMN granted_calls INTEGER NOT NULL DEFAULT 0")
    }
    if (!executionColumns.has("granted_steps")) {
      db.run("ALTER TABLE execution ADD COLUMN granted_steps INTEGER NOT NULL DEFAULT 0")
    }
    if (!executionColumns.has("session_generation")) {
      db.run("ALTER TABLE execution ADD COLUMN session_generation INTEGER NOT NULL DEFAULT 1")
    }
    if (!executionColumns.has("owner_id")) db.run("ALTER TABLE execution ADD COLUMN owner_id TEXT")
    if (!executionColumns.has("lease_expires_at")) db.run("ALTER TABLE execution ADD COLUMN lease_expires_at INTEGER")
    if (!executionColumns.has("unknown_price_blocked")) {
      db.run("ALTER TABLE execution ADD COLUMN unknown_price_blocked INTEGER NOT NULL DEFAULT 0")
    }
    if (!executionColumns.has("mutation_revision")) {
      db.run("ALTER TABLE execution ADD COLUMN mutation_revision INTEGER NOT NULL DEFAULT 0")
    }
    if (!executionColumns.has("plan_revision")) {
      db.run("ALTER TABLE execution ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0")
    }
    if (!executionColumns.has("route_revision")) {
      db.run("ALTER TABLE execution ADD COLUMN route_revision INTEGER NOT NULL DEFAULT 1")
    }
    if (!executionColumns.has("lifecycle")) {
      db.run("ALTER TABLE execution ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'")
    }
    if (!executionColumns.has("phase")) {
      db.run("ALTER TABLE execution ADD COLUMN phase TEXT NOT NULL DEFAULT 'preparing'")
    }
    if (!executionColumns.has("outcome")) db.run("ALTER TABLE execution ADD COLUMN outcome TEXT")
    if (!executionColumns.has("reason_code")) db.run("ALTER TABLE execution ADD COLUMN reason_code TEXT")
    if (!executionColumns.has("reason_message")) db.run("ALTER TABLE execution ADD COLUMN reason_message TEXT")
    if (!executionColumns.has("reason_retryable")) {
      db.run("ALTER TABLE execution ADD COLUMN reason_retryable INTEGER NOT NULL DEFAULT 0")
    }
    if (!executionColumns.has("version")) {
      db.run("ALTER TABLE execution ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    }
    if (!executionColumns.has("updated_at")) {
      db.run("ALTER TABLE execution ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
    }
    if (!executionColumns.has("terminal_at")) db.run("ALTER TABLE execution ADD COLUMN terminal_at INTEGER")
    if (!executionColumns.has("deleted_at")) db.run("ALTER TABLE execution ADD COLUMN deleted_at INTEGER")
    db.run(`
        UPDATE execution SET
          lifecycle = CASE WHEN status IN ('terminal', 'cancelled') THEN 'terminal' ELSE 'active' END,
          phase = CASE WHEN status IN ('terminal', 'cancelled') THEN 'idle'
                       WHEN status = 'finalizing' THEN 'finalizing' ELSE phase END,
          outcome = CASE WHEN outcome IS NOT NULL THEN outcome
                         WHEN status = 'terminal' THEN 'completed'
                         WHEN status = 'cancelled' THEN 'cancelled' ELSE NULL END,
          updated_at = CASE WHEN updated_at = 0 THEN created_at ELSE updated_at END,
          terminal_at = CASE WHEN status IN ('terminal', 'cancelled') AND terminal_at IS NULL
                             THEN created_at ELSE terminal_at END
      `)
    db.run(`
      CREATE TABLE IF NOT EXISTS attempt (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        run_id TEXT NOT NULL,
        fence INTEGER NOT NULL DEFAULT 1,
        purpose TEXT NOT NULL,
        state TEXT NOT NULL,
        estimate INTEGER NOT NULL,
        actual INTEGER,
        price_known INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        dispatched_at INTEGER,
        settled_at INTEGER
      )
    `)
    const attemptColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(attempt)")
        .all()
        .map((column) => column.name),
    )
    if (!attemptColumns.has("fence")) db.run("ALTER TABLE attempt ADD COLUMN fence INTEGER NOT NULL DEFAULT 1")
    if (!attemptColumns.has("session_id")) db.run("ALTER TABLE attempt ADD COLUMN session_id TEXT")
    if (!attemptColumns.has("review_id")) db.run("ALTER TABLE attempt ADD COLUMN review_id TEXT")
    if (!attemptColumns.has("invocation_id")) db.run("ALTER TABLE attempt ADD COLUMN invocation_id TEXT")
    if (!attemptColumns.has("price_known")) {
      db.run("ALTER TABLE attempt ADD COLUMN price_known INTEGER NOT NULL DEFAULT 1")
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS scope_total (
        scope_id TEXT PRIMARY KEY,
        calls INTEGER NOT NULL DEFAULT 0,
        pending_calls INTEGER NOT NULL DEFAULT 0,
        steps INTEGER NOT NULL DEFAULT 0,
        spent INTEGER NOT NULL DEFAULT 0,
        reserved INTEGER NOT NULL DEFAULT 0,
        uncertain INTEGER NOT NULL DEFAULT 0
      )
    `)
    const totalColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(scope_total)")
        .all()
        .map((column) => column.name),
    )
    if (!totalColumns.has("steps")) db.run("ALTER TABLE scope_total ADD COLUMN steps INTEGER NOT NULL DEFAULT 0")
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_step (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        created_at INTEGER NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS scope_policy (
        scope_id TEXT PRIMARY KEY,
        max_cost INTEGER
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_binding (
        invocation_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_invocation (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        session_id TEXT NOT NULL,
        parent_invocation_id TEXT,
        kind TEXT NOT NULL,
        accepted_message_id TEXT,
        state TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        cancellation_requested_at INTEGER,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      )
    `)
    const invocationRecoveryNow = Date.now()
    db.query<never, [number, number]>(
      `
        INSERT OR IGNORE INTO execution_invocation
          (id, execution_id, session_id, kind, state, owner_id, fence, created_at, finished_at)
        SELECT b.invocation_id, b.execution_id, b.session_id, 'auxiliary',
          CASE
            WHEN b.rowid = (SELECT MAX(latest.rowid) FROM execution_binding latest WHERE latest.session_id = b.session_id)
              AND e.status IN ('active', 'finalizing') AND e.lease_expires_at > ? THEN 'running'
            ELSE 'completed'
          END,
          b.owner_id, b.fence, b.created_at,
          CASE
            WHEN b.rowid = (SELECT MAX(latest.rowid) FROM execution_binding latest WHERE latest.session_id = b.session_id)
              AND e.status IN ('active', 'finalizing') AND e.lease_expires_at > ? THEN NULL
            ELSE b.created_at
          END
        FROM execution_binding b JOIN execution e ON e.id = b.execution_id
      `,
    ).run(invocationRecoveryNow, invocationRecoveryNow)
    db.run(
      "CREATE INDEX IF NOT EXISTS execution_invocation_execution_state ON execution_invocation(execution_id, state)",
    )
    db.run("CREATE INDEX IF NOT EXISTS execution_invocation_session_state ON execution_invocation(session_id, state)")
    db.run(`
      CREATE TABLE IF NOT EXISTS session_execution (
        session_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    const sessionExecutionColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(session_execution)")
        .all()
        .map((column) => column.name),
    )
    if (!sessionExecutionColumns.has("parent_invocation_id")) {
      db.run("ALTER TABLE session_execution ADD COLUMN parent_invocation_id TEXT")
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_completion (
        execution_id TEXT PRIMARY KEY REFERENCES execution(id),
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        parent_user_id TEXT,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        finish TEXT NOT NULL,
        payload TEXT NOT NULL,
        review_files TEXT NOT NULL DEFAULT '[]',
        digest TEXT NOT NULL,
        requires_review INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        plan_revision INTEGER NOT NULL DEFAULT 0,
        route_revision INTEGER NOT NULL DEFAULT 1,
        policy_version INTEGER NOT NULL DEFAULT 1,
        policy_digest TEXT NOT NULL DEFAULT '',
        review_requirement TEXT NOT NULL DEFAULT 'not_required',
        review_reason_code TEXT NOT NULL DEFAULT 'legacy',
        required_reviewers INTEGER NOT NULL DEFAULT 0,
        attempt_limit INTEGER NOT NULL DEFAULT 0,
        content_snapshot_digest TEXT NOT NULL DEFAULT '',
        delivery_payload TEXT,
        delivery_finish TEXT,
        terminal_outcome TEXT,
        reason_code TEXT,
        projection_state TEXT NOT NULL DEFAULT 'pending',
        projection_owner TEXT,
        projection_token TEXT,
        projection_lease_expires_at INTEGER,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        committed_at INTEGER
      )
    `)
    const completionColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution_completion)")
        .all()
        .map((column) => column.name),
    )
    if (!completionColumns.has("review_files")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN review_files TEXT NOT NULL DEFAULT '[]'")
    }
    if (!completionColumns.has("parent_user_id")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN parent_user_id TEXT")
    }
    if (!completionColumns.has("revision")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
    }
    if (!completionColumns.has("plan_revision")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0")
    }
    if (!completionColumns.has("route_revision")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN route_revision INTEGER NOT NULL DEFAULT 1")
    }
    if (!completionColumns.has("policy_version")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1")
    }
    if (!completionColumns.has("policy_digest")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN policy_digest TEXT NOT NULL DEFAULT ''")
    }
    if (!completionColumns.has("review_requirement")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN review_requirement TEXT NOT NULL DEFAULT 'not_required'")
    }
    if (!completionColumns.has("review_reason_code")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN review_reason_code TEXT NOT NULL DEFAULT 'legacy'")
    }
    if (!completionColumns.has("required_reviewers")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN required_reviewers INTEGER NOT NULL DEFAULT 0")
    }
    if (!completionColumns.has("attempt_limit")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN attempt_limit INTEGER NOT NULL DEFAULT 0")
    }
    if (!completionColumns.has("content_snapshot_digest")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN content_snapshot_digest TEXT NOT NULL DEFAULT ''")
    }
    if (!completionColumns.has("delivery_payload")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN delivery_payload TEXT")
    }
    if (!completionColumns.has("delivery_finish")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN delivery_finish TEXT")
    }
    if (!completionColumns.has("terminal_outcome")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN terminal_outcome TEXT")
    }
    if (!completionColumns.has("reason_code")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN reason_code TEXT")
    }
    if (!completionColumns.has("projected_at")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN projected_at INTEGER")
    }
    if (!completionColumns.has("projection_state")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN projection_state TEXT NOT NULL DEFAULT 'pending'")
      db.run(
        `UPDATE execution_completion SET projection_state = CASE
             WHEN projected_at = -1 THEN 'abandoned'
             WHEN projected_at IS NOT NULL THEN 'projected'
             ELSE 'pending' END`,
      )
    }
    db.run(
      "UPDATE execution_completion SET terminal_outcome = 'completed' WHERE state = 'committed' AND terminal_outcome IS NULL",
    )
    if (!completionColumns.has("projection_owner")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN projection_owner TEXT")
    }
    if (!completionColumns.has("projection_token")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN projection_token TEXT")
    }
    if (!completionColumns.has("projection_lease_expires_at")) {
      db.run("ALTER TABLE execution_completion ADD COLUMN projection_lease_expires_at INTEGER")
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_policy_state (
        execution_id TEXT PRIMARY KEY REFERENCES execution(id),
        contract_json TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        promotion_reasons_json TEXT NOT NULL,
        classifier_fallback INTEGER NOT NULL DEFAULT 0,
        extension_count INTEGER NOT NULL DEFAULT 0,
        slice_limit INTEGER,
        slice_start_calls INTEGER,
        slice_used_calls INTEGER NOT NULL DEFAULT 0,
        checkpoint_requested INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_checkpoint (
        execution_id TEXT NOT NULL REFERENCES execution(id),
        sequence INTEGER NOT NULL,
        checkpoint_id TEXT,
        decision TEXT NOT NULL,
        requested_calls INTEGER,
        granted_calls INTEGER,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (execution_id, sequence)
      )
    `)
    const checkpointColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution_checkpoint)")
        .all()
        .map((column) => column.name),
    )
    if (!checkpointColumns.has("checkpoint_id"))
      db.run("ALTER TABLE execution_checkpoint ADD COLUMN checkpoint_id TEXT")
    if (!checkpointColumns.has("granted_calls"))
      db.run("ALTER TABLE execution_checkpoint ADD COLUMN granted_calls INTEGER")
    db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS execution_checkpoint_identity ON execution_checkpoint(execution_id, checkpoint_id) WHERE checkpoint_id IS NOT NULL",
    )
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_objective (
        execution_id TEXT PRIMARY KEY REFERENCES execution(id),
        message_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    db.run("CREATE INDEX IF NOT EXISTS execution_checkpoint_created ON execution_checkpoint(execution_id, created_at)")
    db.run(`CREATE TABLE IF NOT EXISTS execution_taskflow_closed (
        execution_id TEXT NOT NULL REFERENCES execution(id),
        session_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        PRIMARY KEY (execution_id, session_id)
      )`)
    const policyStateColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution_policy_state)")
        .all()
        .map((column) => column.name),
    )
    if (!policyStateColumns.has("slice_limit"))
      db.run("ALTER TABLE execution_policy_state ADD COLUMN slice_limit INTEGER")
    if (!policyStateColumns.has("slice_start_calls")) {
      db.run("ALTER TABLE execution_policy_state ADD COLUMN slice_start_calls INTEGER")
    }
    if (!policyStateColumns.has("slice_used_calls")) {
      db.run("ALTER TABLE execution_policy_state ADD COLUMN slice_used_calls INTEGER NOT NULL DEFAULT 0")
    }
    if (!policyStateColumns.has("checkpoint_requested")) {
      db.run("ALTER TABLE execution_policy_state ADD COLUMN checkpoint_requested INTEGER NOT NULL DEFAULT 0")
    }
    if (!policyStateColumns.has("checkpoint_failures")) {
      db.run("ALTER TABLE execution_policy_state ADD COLUMN checkpoint_failures INTEGER NOT NULL DEFAULT 0")
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_continuation (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        session_id TEXT NOT NULL,
        invocation_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        projected_at INTEGER
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_work (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        invocation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        mutating INTEGER NOT NULL,
        state TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      )
    `)
    const workColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution_work)")
        .all()
        .map((column) => column.name),
    )
    if (!workColumns.has("version")) db.run("ALTER TABLE execution_work ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    if (!workColumns.has("began_at")) db.run("ALTER TABLE execution_work ADD COLUMN began_at INTEGER")
    if (!workColumns.has("evidence")) db.run("ALTER TABLE execution_work ADD COLUMN evidence TEXT")
    if (!workColumns.has("resolution_code")) db.run("ALTER TABLE execution_work ADD COLUMN resolution_code TEXT")
    db.query<never, [number, number]>(
      `
        UPDATE execution_invocation
        SET state = 'completed', revision = revision + 1, finished_at = ?
        WHERE kind = 'auxiliary'
          AND state IN ('accepted', 'running', 'waiting', 'draining', 'unknown')
          AND EXISTS (
            SELECT 1 FROM execution e
            WHERE e.id = execution_invocation.execution_id
              AND (e.status NOT IN ('active', 'finalizing') OR e.lease_expires_at IS NULL OR e.lease_expires_at <= ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM execution_work w
            WHERE w.invocation_id = execution_invocation.id
              AND w.state IN ('prepared', 'running', 'draining', 'unknown')
          )
      `,
    ).run(invocationRecoveryNow, invocationRecoveryNow)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_blocker (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        invocation_id TEXT NOT NULL,
        parent_blocker_id TEXT,
        kind TEXT NOT NULL,
        producer_id TEXT NOT NULL,
        resource_scope TEXT NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        plan_revision INTEGER,
        evidence TEXT,
        resolution_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        finished_at INTEGER,
        UNIQUE(execution_id, kind, producer_id)
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_review (
        execution_id TEXT PRIMARY KEY REFERENCES execution(id),
        id TEXT NOT NULL UNIQUE,
        digest TEXT NOT NULL,
        revision INTEGER NOT NULL,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_task (
        id TEXT NOT NULL,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        parent_task_id TEXT,
        revision INTEGER NOT NULL DEFAULT 0,
        goal TEXT NOT NULL,
        owner TEXT NOT NULL,
        agent TEXT NOT NULL,
        skill TEXT,
        session_id TEXT,
        source TEXT NOT NULL DEFAULT 'task',
        checks TEXT NOT NULL DEFAULT '[]',
        depends_on TEXT NOT NULL DEFAULT '[]',
        acceptance TEXT NOT NULL DEFAULT '[]',
        evidence TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        supersedes TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        submitted_at INTEGER,
        verified_at INTEGER,
        PRIMARY KEY (execution_id, id)
      )
    `)
    db.run(`CREATE TABLE IF NOT EXISTS execution_task_history (
      execution_id TEXT NOT NULL REFERENCES execution(id),
      task_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      PRIMARY KEY (execution_id, task_id, version)
    )`)
    const taskColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution_task)")
        .all()
        .map((column) => column.name),
    )
    if (!taskColumns.has("session_id")) db.run("ALTER TABLE execution_task ADD COLUMN session_id TEXT")
    if (!taskColumns.has("source")) db.run("ALTER TABLE execution_task ADD COLUMN source TEXT NOT NULL DEFAULT 'task'")
    if (!taskColumns.has("checks")) db.run("ALTER TABLE execution_task ADD COLUMN checks TEXT NOT NULL DEFAULT '[]'")
    if (!taskColumns.has("definition")) db.run("ALTER TABLE execution_task ADD COLUMN definition TEXT")
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_review_session (
        session_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        review_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_review_qa (
        execution_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        acceptance_verified INTEGER NOT NULL DEFAULT 0,
        acceptance_request_hash TEXT,
        reviewed_files TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (execution_id, revision)
      )
    `)
    const qaColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution_review_qa)")
        .all()
        .map((column) => column.name),
    )
    if (!qaColumns.has("acceptance_verified"))
      db.run("ALTER TABLE execution_review_qa ADD COLUMN acceptance_verified INTEGER NOT NULL DEFAULT 0")
    if (!qaColumns.has("acceptance_request_hash"))
      db.run("ALTER TABLE execution_review_qa ADD COLUMN acceptance_request_hash TEXT")
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    db.query("INSERT OR IGNORE INTO execution_meta (key, value) VALUES ('event_epoch', ?)").run(crypto.randomUUID())
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_event (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        epoch TEXT NOT NULL,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        session_generation INTEGER NOT NULL,
        execution_id TEXT,
        resource_version INTEGER NOT NULL,
        type TEXT NOT NULL,
        properties TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_scope_escalation (
        session_id TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        floor_scope TEXT NOT NULL DEFAULT 'direct'
      )
    `)
    const scopeEscalationColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution_scope_escalation)")
        .all()
        .map((column) => column.name),
    )
    if (!scopeEscalationColumns.has("floor_scope"))
      db.run("ALTER TABLE execution_scope_escalation ADD COLUMN floor_scope TEXT NOT NULL DEFAULT 'direct'")
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_request (
        request_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        kind TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        resulting_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS route_proposal (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        invocation_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        route_revision INTEGER NOT NULL,
        session_generation INTEGER NOT NULL,
        from_route TEXT NOT NULL,
        to_route TEXT NOT NULL,
        params_digest TEXT NOT NULL,
        scope TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        evidence_refs TEXT NOT NULL,
        estimated_usage TEXT NOT NULL,
        uncertainty INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        policy_version INTEGER NOT NULL,
        consent_version INTEGER NOT NULL,
        credential_revision TEXT NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        decision_id TEXT,
        actor_id TEXT,
        accept_scope TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER,
        applied_at INTEGER
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_route (
        execution_id TEXT PRIMARY KEY REFERENCES execution(id),
        route_revision INTEGER NOT NULL,
        current_route TEXT NOT NULL,
        base_route TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'base',
        active_episode_id TEXT,
        manual_model_pin INTEGER NOT NULL DEFAULT 0,
        manual_thinking_pin INTEGER NOT NULL DEFAULT 0,
        expert_start_calls INTEGER,
        expert_start_steps INTEGER,
        max_expert_episodes INTEGER,
        max_expert_calls INTEGER,
        max_expert_steps INTEGER
      )
    `)
    const routeColumns = new Set(
      db
        .query<{ name: string }, []>("PRAGMA table_info(execution_route)")
        .all()
        .map((column) => column.name),
    )
    for (const column of [
      "expert_start_calls",
      "expert_start_steps",
      "max_expert_episodes",
      "max_expert_calls",
      "max_expert_steps",
    ]) {
      if (!routeColumns.has(column)) db.run(`ALTER TABLE execution_route ADD COLUMN ${column} INTEGER`)
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS route_grant (
        execution_id TEXT NOT NULL REFERENCES execution(id),
        target_route TEXT NOT NULL,
        params_digest TEXT NOT NULL,
        scope TEXT NOT NULL,
        policy_version INTEGER NOT NULL,
        credential_revision TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (execution_id, target_route, params_digest, scope)
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_budget_warning (
        scope_id TEXT NOT NULL,
        threshold INTEGER NOT NULL,
        policy_version INTEGER NOT NULL,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (scope_id, threshold, policy_version)
      )
    `)
    db.query("INSERT OR IGNORE INTO execution_meta (key, value) VALUES ('event_retention_floor', '0')").run()
    db.run("CREATE INDEX IF NOT EXISTS execution_event_session_sequence ON execution_event(session_id, sequence)")
    db.run("CREATE INDEX IF NOT EXISTS execution_request_execution ON execution_request(execution_id, created_at)")
    db.run(
      "CREATE INDEX IF NOT EXISTS route_proposal_execution_state ON route_proposal(execution_id, state, created_at)",
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS execution_continuation_session_state ON execution_continuation(session_id, state, created_at)",
    )
    db.run("CREATE INDEX IF NOT EXISTS execution_work_execution_state ON execution_work(execution_id, state)")
    db.run("CREATE INDEX IF NOT EXISTS execution_blocker_execution_state ON execution_blocker(execution_id, state)")
    db.run("CREATE INDEX IF NOT EXISTS execution_task_execution_status ON execution_task(execution_id, status)")

    const schemaVersion = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0
    if (schemaVersion < 1) {
      db.run(`
          INSERT INTO scope_total (scope_id, calls, pending_calls, steps, spent, reserved, uncertain)
          SELECT 'execution:' || e.id,
            COALESCE(SUM(CASE WHEN a.state IN ('dispatched', 'settled', 'uncertain') THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'reserved' THEN 1 ELSE 0 END), 0),
            (SELECT COUNT(*) FROM execution_step s WHERE s.execution_id = e.id),
            COALESCE(SUM(CASE WHEN a.state = 'settled' THEN a.actual ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state IN ('reserved', 'dispatched') THEN a.estimate ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'uncertain' THEN a.estimate ELSE 0 END), 0)
          FROM execution e LEFT JOIN attempt a ON a.execution_id = e.id GROUP BY e.id
          ON CONFLICT(scope_id) DO UPDATE SET
            calls = excluded.calls, pending_calls = excluded.pending_calls, steps = excluded.steps,
            spent = excluded.spent, reserved = excluded.reserved, uncertain = excluded.uncertain
        `)
      db.run(`
          INSERT INTO scope_total (scope_id, calls, pending_calls, steps, spent, reserved, uncertain)
          SELECT 'root-session:' || e.root_session_id,
            COALESCE(SUM(CASE WHEN a.state IN ('dispatched', 'settled', 'uncertain') THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'reserved' THEN 1 ELSE 0 END), 0), 0,
            COALESCE(SUM(CASE WHEN a.state = 'settled' THEN a.actual ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state IN ('reserved', 'dispatched') THEN a.estimate ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'uncertain' THEN a.estimate ELSE 0 END), 0)
          FROM execution e LEFT JOIN attempt a ON a.execution_id = e.id GROUP BY e.root_session_id
          ON CONFLICT(scope_id) DO UPDATE SET
            calls = excluded.calls, pending_calls = excluded.pending_calls, steps = excluded.steps,
            spent = excluded.spent, reserved = excluded.reserved, uncertain = excluded.uncertain
        `)
      db.run(`
          INSERT INTO scope_total (scope_id, calls, pending_calls, steps, spent, reserved, uncertain)
          SELECT 'project:' || e.project_id,
            COALESCE(SUM(CASE WHEN a.state IN ('dispatched', 'settled', 'uncertain') THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'reserved' THEN 1 ELSE 0 END), 0), 0,
            COALESCE(SUM(CASE WHEN a.state = 'settled' THEN a.actual ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state IN ('reserved', 'dispatched') THEN a.estimate ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'uncertain' THEN a.estimate ELSE 0 END), 0)
          FROM execution e LEFT JOIN attempt a ON a.execution_id = e.id GROUP BY e.project_id
          ON CONFLICT(scope_id) DO UPDATE SET
            calls = excluded.calls, pending_calls = excluded.pending_calls, steps = excluded.steps,
            spent = excluded.spent, reserved = excluded.reserved, uncertain = excluded.uncertain
        `)
      db.run("PRAGMA user_version = 1")
    }
    if (schemaVersion < 2) {
      const columns = new Set(
        db
          .query<{ name: string }, []>("PRAGMA table_info(execution_policy_state)")
          .all()
          .map((column) => column.name),
      )
      if (!columns.has("extension_count")) {
        db.run("ALTER TABLE execution_policy_state ADD COLUMN extension_count INTEGER NOT NULL DEFAULT 0")
      }
      db.run("PRAGMA user_version = 2")
    }
    db.run("COMMIT")
  } catch (error) {
    try {
      db.run("ROLLBACK")
    } catch {}
    db.close()
    throw error
  }
}
