export type SourceState = "ok" | "empty" | "error" | "skipped";

export interface SourceStatus {
  id: string;
  label: string;
  state: SourceState;
  fetchedCount: number;
  acceptedCount: number;
  detail?: string;
}

interface CreateSourceStatusInput {
  id: string;
  label: string;
  fetchedCount: number;
  acceptedCount: number;
  error?: string;
  skipped?: string;
}

export function createSourceStatus(input: CreateSourceStatusInput): SourceStatus {
  const { id, label, fetchedCount, acceptedCount } = input;
  if (input.error) {
    return { id, label, state: "error", fetchedCount, acceptedCount, detail: input.error };
  }
  if (input.skipped) {
    return { id, label, state: "skipped", fetchedCount, acceptedCount, detail: input.skipped };
  }
  return {
    id,
    label,
    state: acceptedCount > 0 ? "ok" : "empty",
    fetchedCount,
    acceptedCount,
  };
}
