import { Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

export const DateCell = ({ value }: { value?: string | null }) =>
  value ? (
    <Tooltip title={dayjs(value).format("YYYY-MM-DD HH:mm:ss")}>
      <span>{dayjs(value).fromNow()}</span>
    </Tooltip>
  ) : (
    <Typography.Text type="secondary">—</Typography.Text>
  );

export const formatDate = (value?: string | null) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—");

export const Mono = ({ children, copyable }: { children?: string | null; copyable?: boolean }) =>
  children ? (
    <Typography.Text code copyable={copyable} style={{ wordBreak: "break-all" }}>
      {children}
    </Typography.Text>
  ) : (
    <Typography.Text type="secondary">—</Typography.Text>
  );

export const Counts = ({ success, invalid, failed }: { success: number; invalid: number; failed: number }) => (
  <span style={{ whiteSpace: "nowrap" }}>
    <Typography.Text type="success">{success}</Typography.Text>
    {" / "}
    <Typography.Text style={{ color: "#fa8c16" }}>{invalid}</Typography.Text>
    {" / "}
    <Typography.Text type="danger">{failed}</Typography.Text>
  </span>
);
