import { useParams } from "react-router-dom";
import { fetchSession } from "../api";
import { fmtDateTime } from "../format";
import { useAsync } from "../lib/useAsync";
import { Chrome, ErrorBox, Loading } from "../components/Chrome";
import { OverviewTree } from "../components/OverviewTree";
import { Stat } from "../components/ui";

export function SessionOverviewPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const { loading, error, data } = useAsync(
    () => fetchSession(sessionId),
    [sessionId]
  );

  return (
    <Chrome breadcrumb={<span>Session #{sessionId}</span>}>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <div className="mb-6 flex flex-wrap gap-x-8 gap-y-3 rounded-xl border border-border bg-surface p-4">
            <Stat label="requests" value={data.entries.length} />
            <Stat
              label="conversations"
              value={
                new Set(data.entries.map((e) => e.conversation_id)).size
              }
            />
            <Stat label="started" value={fmtDateTime(data.startedAt)} />
            <Stat label="ended" value={fmtDateTime(data.endedAt)} />
          </div>
          <h1 className="mb-1 text-xl font-bold">Agentic loop</h1>
          <p className="mb-5 text-sm text-muted">
            Conversations in chronological order — each one is an agent loop,
            its requests shown as steps from top to bottom.
          </p>
          <OverviewTree sessionId={sessionId} roots={data.overview} />
        </>
      )}
    </Chrome>
  );
}
