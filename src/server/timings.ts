export type TimingMark =
  | "received_at"
  | "upstream_sent_at"
  | "upstream_first_byte_at"
  | "upstream_done_at"
  | "responded_to_client_at";

export interface MetaJson {
  received_at?: string;
  upstream_sent_at?: string;
  upstream_first_byte_at?: string;
  upstream_done_at?: string;
  responded_to_client_at?: string;
  duration_ms?: number;
  ttfb_ms?: number;
  upstream_duration_ms?: number;
}

export class Timings {
  private marks = new Map<TimingMark, number>();
  private clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  mark(name: TimingMark): void {
    if (!this.marks.has(name)) this.marks.set(name, this.clock());
  }

  get(name: TimingMark): number | undefined {
    return this.marks.get(name);
  }

  toMeta(): MetaJson {
    const out: MetaJson = {};
    const set = (k: keyof MetaJson, v: number | undefined) => {
      if (v !== undefined) (out as Record<string, unknown>)[k] = new Date(v).toISOString();
    };
    const received = this.marks.get("received_at");
    const upstreamSent = this.marks.get("upstream_sent_at");
    const upstreamFirstByte = this.marks.get("upstream_first_byte_at");
    const upstreamDone = this.marks.get("upstream_done_at");
    const responded = this.marks.get("responded_to_client_at");

    set("received_at", received);
    set("upstream_sent_at", upstreamSent);
    set("upstream_first_byte_at", upstreamFirstByte);
    set("upstream_done_at", upstreamDone);
    set("responded_to_client_at", responded);

    if (received !== undefined && responded !== undefined) {
      out.duration_ms = responded - received;
    }
    if (upstreamSent !== undefined && upstreamFirstByte !== undefined) {
      out.ttfb_ms = upstreamFirstByte - upstreamSent;
    }
    if (upstreamSent !== undefined && upstreamDone !== undefined) {
      out.upstream_duration_ms = upstreamDone - upstreamSent;
    }
    return out;
  }
}
