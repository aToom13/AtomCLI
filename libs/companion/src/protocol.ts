import z from "zod"

/** Single source of truth for the AtomCLI <-> Companion wire contract. */
export namespace CompanionProtocol {
  export const PAIRING_VERSION = 2
  export const MIN_VERSION = 2
  export const CURRENT_VERSION = 3

  export const Capability = z.enum([
    "core.sync",
    "core.snapshot",
    "identity.v1",
    "events.cursor",
    "actions.signed",
    "permissions.resolve",
    "questions.reply",
    "sessions.manage",
    "missions.control",
    "chat.send",
    "models.list",
    "directories.list",
    "transfers.v1",
    "transfers.v2",
    "previews.v1",
    "previews.v2",
  ])
  export type Capability = z.infer<typeof Capability>
  export const CAPABILITIES = Capability.options

  export const PeerIdentity = z.object({
    machine_id: z.string().uuid(),
    process_id: z.string().uuid(),
    bridge_id: z.string().uuid(),
    machine_name: z.string().min(1).optional(),
    project_directory: z.string().min(1).optional(),
  })
  export type PeerIdentity = z.infer<typeof PeerIdentity>

  export const EventCursor = z.object({
    bridge_epoch: z.string().uuid(),
    seq_id: z.number().int().min(0),
  })
  export type EventCursor = z.infer<typeof EventCursor>

  export const PairingPayload = z.object({
    v: z.literal(PAIRING_VERSION),
    endpoints: z.array(z.string().url()).min(1),
    pairing_token: z.string().min(1),
    http_pair: z.string().url(),
  })
  export type PairingPayload = z.infer<typeof PairingPayload>

  export const AuthChallenge = z.object({
    type: z.literal("auth_challenge"),
    /** Legacy alias retained for protocol v2 clients. */
    protocol: z.number().int().positive(),
    protocol_version: z.number().int().positive(),
    protocol_min: z.number().int().positive(),
    capabilities: z.array(Capability),
    identity: PeerIdentity,
    challenge: z.string().uuid(),
    expires_at: z.number().int().positive(),
  })
  export type AuthChallenge = z.infer<typeof AuthChallenge>

  export const Authenticate = z.object({
    type: z.literal("authenticate"),
    challenge: z.string().uuid(),
    timestamp: z.number().int().positive(),
    device_name: z.string().min(1).max(100),
    device_id: z.string().min(1).max(128).optional(),
    protocol_version: z.number().int().positive().optional(),
    /** Unknown future capabilities are ignored during negotiation. */
    capabilities: z.array(z.string()).optional(),
    signature: z.string().min(1),
  })
  export type Authenticate = z.infer<typeof Authenticate>

  export const AuthOk = z.object({
    type: z.literal("auth_ok"),
    protocol_version: z.number().int().positive(),
    capabilities: z.array(Capability),
    identity: PeerIdentity,
    bridge_epoch: z.string().uuid(),
    connection_id: z.string().uuid(),
    endpoints: z.array(z.string().url()),
  })
  export type AuthOk = z.infer<typeof AuthOk>

  export const SignedFields = {
    signature: z.string().min(1),
    device_name: z.string().min(1).max(100),
    device_id: z.string().min(1).max(128).optional(),
    connection_id: z.string().uuid(),
    counter: z.number().int().positive(),
    timestamp: z.number().int().positive(),
    client_request_id: z.string().uuid().optional(),
  }

  export const SyncMessage = z.object({
    type: z.literal("sync"),
    last_seq_id: z.number().int().min(0),
    bridge_epoch: z.string().uuid().optional(),
    cursor: EventCursor.optional(),
  })
  export const PingMessage = z.object({ type: z.literal("ping"), timestamp: z.number().int().positive() })
  export const SnapshotMessage = z.object({ type: z.literal("request_snapshot") })
  export const PermissionResolveMessage = z.object({
    type: z.literal("permission_resolve"),
    id: z.string(),
    resolution: z.enum(["allow", "allow_once", "allow_always", "autonomous", "deny", "intervene"]),
    directory: z.string().optional(),
    intervention_params: z.string().optional(),
    ...SignedFields,
  })
  export const CommandMessage = z.object({
    type: z.literal("command"),
    action: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
    ...SignedFields,
  })
  export const ChatMessage = z.object({
    type: z.literal("chat_message"),
    session_id: z.string(),
    text: z.string(),
    attachments: z.array(z.string()).max(10).optional(),
    ...SignedFields,
    model: z.string().optional(),
    agent: z.string().optional(),
    variant: z.string().optional(),
    directory: z.string().optional(),
  })
  export const CreateSessionMessage = z.object({
    type: z.literal("create_session"),
    text: z.string().optional(),
    ...SignedFields,
    model: z.string().optional(),
    agent: z.string().optional(),
    variant: z.string().optional(),
    directory: z.string().optional(),
  })
  export const GetMessagesMessage = z.object({
    type: z.literal("get_messages"),
    session_id: z.string(),
    directory: z.string().optional(),
    client_request_id: z.string().uuid().optional(),
  })
  export const ListDirectoriesMessage = z.object({
    type: z.literal("list_directories"),
    path: z.string().optional(),
    client_request_id: z.string().uuid().optional(),
  })
  export const GetModelsMessage = z.object({ type: z.literal("get_models") })
  export const QuestionReplyMessage = z.object({
    type: z.literal("question_reply"),
    id: z.string(),
    answers: z.array(z.array(z.string())),
    directory: z.string().optional(),
    ...SignedFields,
  })
  export const QuestionRejectMessage = z.object({
    type: z.literal("question_reject"),
    id: z.string(),
    directory: z.string().optional(),
    ...SignedFields,
  })
  export const UnpairMessage = z.object({ type: z.literal("unpair"), ...SignedFields })
  export const AbortSessionMessage = z.object({
    type: z.literal("abort_session"),
    session_id: z.string(),
    directory: z.string().optional(),
    ...SignedFields,
  })
  export const PauseSessionMessage = z.object({
    type: z.literal("pause_session"),
    session_id: z.string(),
    directory: z.string().optional(),
    ...SignedFields,
  })
  export const DeleteSessionMessage = z.object({
    type: z.literal("delete_session"),
    session_id: z.string(),
    directory: z.string().optional(),
    ...SignedFields,
  })
  export const CreateUploadMessage = z.object({
    type: z.literal("create_upload"),
    session_id: z.string(),
    filename: z.string().min(1).max(255),
    mime: z.string().max(255),
    size: z.number().int().nonnegative(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    model: z.string().optional(),
    agent: z.string().optional(),
    variant: z.string().optional(),
    directory: z.string().optional(),
    ...SignedFields,
  })
  export const DeleteArtifactMessage = z.object({
    type: z.literal("artifact_delete"),
    artifact_id: z.string().min(1),
    directory: z.string().optional(),
    ...SignedFields,
  })
  export const PreviewStopMessage = z.object({
    type: z.literal("preview_stop"),
    preview_id: z.string(),
    directory: z.string().optional(),
    ...SignedFields,
  })
  export const PreviewLogsMessage = z.object({
    type: z.literal("preview_logs"),
    preview_id: z.string(),
    directory: z.string().optional(),
    client_request_id: z.string().uuid().optional(),
  })
  export const PreviewAccessMessage = z.object({
    type: z.literal("preview_access"),
    preview_id: z.string(),
    directory: z.string().optional(),
    ...SignedFields,
  })

  export const InboundMessage = z.discriminatedUnion("type", [
    Authenticate,
    SyncMessage,
    PingMessage,
    SnapshotMessage,
    PermissionResolveMessage,
    CommandMessage,
    ChatMessage,
    CreateSessionMessage,
    GetMessagesMessage,
    GetModelsMessage,
    ListDirectoriesMessage,
    QuestionReplyMessage,
    QuestionRejectMessage,
    UnpairMessage,
    AbortSessionMessage,
    PauseSessionMessage,
    DeleteSessionMessage,
    CreateUploadMessage,
    DeleteArtifactMessage,
    PreviewStopMessage,
    PreviewLogsMessage,
    PreviewAccessMessage,
  ])
  export type InboundMessage = z.infer<typeof InboundMessage>

  export function negotiateVersion(requested = MIN_VERSION) {
    if (requested < MIN_VERSION || requested > CURRENT_VERSION) return undefined
    return requested
  }

  export function negotiateCapabilities(requested?: readonly string[]) {
    if (!requested) return []
    const supported = new Set<Capability>(CAPABILITIES)
    return requested.filter((capability): capability is Capability => supported.has(capability as Capability))
  }
}
