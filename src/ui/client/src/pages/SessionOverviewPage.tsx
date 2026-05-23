import { useParams } from "react-router-dom";
import { fetchSession } from "../api";
import { fmtDateTime, fmtTokens } from "../format";
import { useAsync } from "../lib/useAsync";
import { Chrome, ErrorBox, Loading } from "../components/Chrome";
import { StepCard } from "../components/StepCard";
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
          {(() => {
            const tokens = data.entries.reduce(
              (acc, e) => ({
                input: acc.input + (e.tokens?.input ?? 0),
                cacheRead: acc.cacheRead + (e.tokens?.cache_read ?? 0),
                output: acc.output + (e.tokens?.output ?? 0),
              }),
              { input: 0, cacheRead: 0, output: 0 }
            );
            return (
              <div className="mb-6 flex flex-wrap gap-x-8 gap-y-3 rounded-xl border border-border bg-surface p-4">
                <Stat label="requests" value={data.entries.length} />
                <Stat label="input" value={`↑${fmtTokens(tokens.input)}`} />
                <Stat label="cache read" value={`↑${fmtTokens(tokens.cacheRead)}`} />
                <Stat label="output" value={`↓${fmtTokens(tokens.output)}`} />
                <Stat label="started" value={fmtDateTime(data.startedAt)} />
                <Stat label="ended" value={fmtDateTime(data.endedAt)} />
              </div>
            );
          })()}
          {data.steps.length === 0 ? (
            <div className="text-sm text-muted">No requests in this session.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {data.steps.map((step) => (
                <StepCard key={step.requestId} sessionId={sessionId} step={step} />
              ))}
            </div>
          )}
        </>
      )}
    </Chrome>
  );
}
