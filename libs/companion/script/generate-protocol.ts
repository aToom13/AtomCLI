import { dirname, join } from "node:path"
import { mkdir } from "node:fs/promises"
import z from "zod"
import { CompanionProtocol } from "../src/protocol"

const packageRoot = dirname(import.meta.dir)
const schemaPath = join(packageRoot, "protocol", "companion.schema.json")
const dartPath = join(packageRoot, "..", "..", "companion", "lib", "generated", "companion_protocol.g.dart")
const check = process.argv.includes("--check")

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://atomcli.ai/schema/companion-protocol.json",
  title: "AtomCLI Companion Protocol",
  "x-atomcli-protocol": {
    pairingVersion: CompanionProtocol.PAIRING_VERSION,
    minimumVersion: CompanionProtocol.MIN_VERSION,
    currentVersion: CompanionProtocol.CURRENT_VERSION,
    capabilities: CompanionProtocol.CAPABILITIES,
  },
  $defs: {
    pairingPayload: z.toJSONSchema(CompanionProtocol.PairingPayload),
    authChallenge: z.toJSONSchema(CompanionProtocol.AuthChallenge),
    authenticate: z.toJSONSchema(CompanionProtocol.Authenticate),
    authOk: z.toJSONSchema(CompanionProtocol.AuthOk),
    eventCursor: z.toJSONSchema(CompanionProtocol.EventCursor),
    inboundMessage: z.toJSONSchema(CompanionProtocol.InboundMessage),
  },
  oneOf: [
    { $ref: "#/$defs/pairingPayload" },
    { $ref: "#/$defs/authChallenge" },
    { $ref: "#/$defs/authenticate" },
    { $ref: "#/$defs/authOk" },
    { $ref: "#/$defs/inboundMessage" },
  ],
}

const schemaOutput = `${JSON.stringify(schema, null, 2)}\n`
const capabilityLines = CompanionProtocol.CAPABILITIES.map(
  (capability) => `  static const String ${camelCase(capability)} = '${capability}';`,
).join("\n")
const capabilityValues = CompanionProtocol.CAPABILITIES.map((capability) => `    '${capability}',`).join("\n")

const dartOutput = `// GENERATED FILE. DO NOT EDIT.
// Source: libs/companion/src/protocol.ts

abstract final class CompanionProtocolVersion {
  static const int pairing = ${CompanionProtocol.PAIRING_VERSION};
  static const int minimum = ${CompanionProtocol.MIN_VERSION};
  static const int current = ${CompanionProtocol.CURRENT_VERSION};

  static bool supports(int version) => version >= minimum && version <= current;
}

abstract final class CompanionCapability {
${capabilityLines}

  static const Set<String> supported = {
${capabilityValues}
  };
}

class CompanionPeerIdentity {
  final String machineId;
  final String processId;
  final String bridgeId;
  final String? machineName;
  final String? projectDirectory;

  const CompanionPeerIdentity({
    required this.machineId,
    required this.processId,
    required this.bridgeId,
    this.machineName,
    this.projectDirectory,
  });

  factory CompanionPeerIdentity.fromJson(Map<String, dynamic> json) {
    return CompanionPeerIdentity(
      machineId: json['machine_id'] as String,
      processId: json['process_id'] as String,
      bridgeId: json['bridge_id'] as String,
      machineName: json['machine_name'] as String?,
      projectDirectory: json['project_directory'] as String?,
    );
  }
}

class CompanionAuthChallenge {
  final int protocolVersion;
  final int protocolMinimum;
  final Set<String> capabilities;
  final CompanionPeerIdentity? identity;
  final String challenge;
  final int expiresAt;

  const CompanionAuthChallenge({
    required this.protocolVersion,
    required this.protocolMinimum,
    required this.capabilities,
    this.identity,
    required this.challenge,
    required this.expiresAt,
  });

  factory CompanionAuthChallenge.fromJson(Map<String, dynamic> json) {
    final version =
        json['protocol_version'] as int? ?? json['protocol'] as int? ?? 2;
    final rawIdentity = json['identity'];
    return CompanionAuthChallenge(
      protocolVersion: version,
      protocolMinimum: json['protocol_min'] as int? ?? version,
      capabilities: (json['capabilities'] as List? ?? const [])
          .whereType<String>()
          .toSet(),
      identity: rawIdentity is Map
          ? CompanionPeerIdentity.fromJson(
              Map<String, dynamic>.from(rawIdentity),
            )
          : null,
      challenge: json['challenge'] as String,
      expiresAt: json['expires_at'] as int? ?? 0,
    );
  }
}

class CompanionAuthOk {
  final int protocolVersion;
  final Set<String> capabilities;
  final CompanionPeerIdentity? identity;
  final String bridgeEpoch;
  final String connectionId;
  final List<String> endpoints;

  const CompanionAuthOk({
    required this.protocolVersion,
    required this.capabilities,
    this.identity,
    required this.bridgeEpoch,
    required this.connectionId,
    required this.endpoints,
  });

  factory CompanionAuthOk.fromJson(Map<String, dynamic> json) {
    final rawIdentity = json['identity'];
    return CompanionAuthOk(
      protocolVersion: json['protocol_version'] as int? ?? 2,
      capabilities: (json['capabilities'] as List? ?? const [])
          .whereType<String>()
          .toSet(),
      identity: rawIdentity is Map
          ? CompanionPeerIdentity.fromJson(
              Map<String, dynamic>.from(rawIdentity),
            )
          : null,
      bridgeEpoch: json['bridge_epoch'] as String,
      connectionId: json['connection_id'] as String,
      endpoints: (json['endpoints'] as List? ?? const [])
          .whereType<String>()
          .toList(),
    );
  }
}
`

await output(schemaPath, schemaOutput)
await output(dartPath, dartOutput)

async function output(path: string, content: string) {
  if (check) {
    const existing = await Bun.file(path)
      .text()
      .catch(() => "")
    if (existing !== content) throw new Error(`Generated protocol artifact is stale: ${path}`)
    return
  }
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, content)
}

function camelCase(value: string) {
  return value.replace(/[^a-zA-Z0-9]+(.)/g, (_, character: string) => character.toUpperCase())
}
