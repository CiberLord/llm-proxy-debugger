import * as crypto from "node:crypto";

const SEP = "::CONV-SEP::";

export function conversationIdFor(systemText: string, firstUserText: string): string {
  return crypto
    .createHash("sha1")
    .update(systemText + SEP + firstUserText)
    .digest("hex");
}
