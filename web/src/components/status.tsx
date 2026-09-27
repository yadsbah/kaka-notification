import { Tag } from "antd";

const COLORS: Record<string, string> = {
  // notifications
  QUEUED: "default",
  PROCESSING: "processing",
  COMPLETED: "success",
  PARTIALLY_FAILED: "warning",
  FAILED: "error",
  CANCELED: "default",
  // jobs
  PENDING: "default",
  // credentials
  OK: "success",
  MISSING: "warning",
  ERROR: "error",
  // token outcomes
  SUCCESS: "success",
  INVALID: "orange",
  // webhooks
  SUCCEEDED: "success",
};

const LABELS: Record<string, string> = {
  PARTIALLY_FAILED: "partially failed",
  ERROR: "credential problem",
};

export const StatusTag = ({ status }: { status?: string | null }) =>
  status ? <Tag color={COLORS[status] ?? "default"}>{LABELS[status] ?? status.toLowerCase().replaceAll("_", " ")}</Tag> : null;

export const statusOptions = (values: string[]) =>
  values.map((value) => ({ value, label: LABELS[value] ?? value.toLowerCase().replaceAll("_", " ") }));
