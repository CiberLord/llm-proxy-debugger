import { Card } from "@heroui/react";
import { Link } from "react-router-dom";
import { fetchSessions } from "../api";
import { fmtDateTime, fmtTokens } from "../format";
import { useAsync } from "../lib/useAsync";
import type { SessionSummary } from "../types";
import { Chrome, ErrorBox, Loading } from "../components/Chrome";
import { TagChip } from "../components/chips";
import { Stat } from "../components/ui";

function SessionCard({ session }: { session: SessionSummary }) {
  return (
    <Link to={`/session/${session.id}`} className="no-underline">
      <Card variant="default" className="h-full transition hover:shadow-overlay">
        <Card.Content className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold">Session #{session.id}</span>
            {session.errorCount > 0 && (
              <TagChip color="danger">{session.errorCount} errors</TagChip>
            )}
          </div>
          <div className="text-xs text-muted">
            {fmtDateTime(session.startedAt)}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="requests" value={session.requestCount} />
            <Stat label="conversations" value={session.conversationCount} />
            <Stat
              label="tokens"
              value={`↑${fmtTokens(session.tokens.input)} ↓${fmtTokens(
                session.tokens.output
              )}`}
            />
          </div>
          {session.models.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {session.models.map((m) => (
                <TagChip key={m}>{m}</TagChip>
              ))}
            </div>
          )}
          {session.agents.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {session.agents.map((a) => (
                <TagChip key={a} color="accent">
                  {a}
                </TagChip>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </Link>
  );
}

export function SessionsPage() {
  const { loading, error, data } = useAsync(() => fetchSessions(), []);
  return (
    <Chrome>
      <h1 className="mb-1 text-xl font-bold">Sessions</h1>
      <p className="mb-4 text-sm text-muted">
        Each session is one proxy run with an AI agent's recorded requests.
      </p>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && data.length === 0 && (
        <div className="text-muted">No recorded sessions.</div>
      )}
      {data && data.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </Chrome>
  );
}
