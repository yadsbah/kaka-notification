import { DownloadOutlined, RedoOutlined, StopOutlined } from "@ant-design/icons";
import { Show } from "@refinedev/antd";
import { useInvalidate, useShow } from "@refinedev/core";
import { App, Button, Card, Descriptions, Input, Modal, Popconfirm, Select, Space, Statistic, Row, Col, Table, Timeline, Typography } from "antd";
import { useEffect, useState } from "react";
import { DateCell, formatDate, Mono } from "../../components/format";
import { StatusTag, statusOptions } from "../../components/status";
import { api } from "../../providers/api";
import type { AdminNotification } from "./list";

type Job = {
  id: string;
  chunkIndex: number;
  parentJobID: string | null;
  tokenCount: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lockedBy: string | null;
  durationMs: number | null;
};
type Detail = AdminNotification & {
  payload: unknown;
  jobs: Job[];
  jobSummary: Record<string, number>;
  errors: { code: string | null; category: string | null; outcome: string; count: number }[];
  webhookDeliveries: { id: number; attempt: number; status: string; statusCode: number | null; responseSnippet: string | null; createdAt: string }[];
};
type TokenResult = {
  id: number;
  token: string;
  outcome: string;
  errorCategory: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  messageID: string | null;
  attempt: number;
  createdAt: string;
};

const TokenResults = ({ notificationID, errorCodes }: { notificationID: string; errorCodes: string[] }) => {
  const [filters, setFilters] = useState<{ outcome?: string; errorCode?: string; search?: string }>({});
  const [page, setPage] = useState({ current: 1, pageSize: 20 });
  const [data, setData] = useState<{ results: TokenResult[]; count: number }>({ results: [], count: 0 });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<TokenResult | null>(null);

  useEffect(() => {
    setLoading(true);
    api<{ results: TokenResult[]; count: number }>("GET", `/api/admin/notifications/${notificationID}/results`, {
      query: { ...filters, limit: page.pageSize, offset: (page.current - 1) * page.pageSize },
    })
      .then(setData)
      .finally(() => setLoading(false));
  }, [notificationID, filters, page]);

  const openDetail = async (id: number) => setDetail(await api("GET", `/api/admin/notifications/${notificationID}/results/${id}`));
  const update = (next: typeof filters) => {
    setFilters({ ...filters, ...next });
    setPage({ ...page, current: 1 });
  };

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Outcome" style={{ minWidth: 140 }} options={statusOptions(["SUCCESS", "INVALID", "FAILED"])} onChange={(outcome) => update({ outcome })} />
        <Select allowClear placeholder="Error code" style={{ minWidth: 280 }} options={errorCodes.map((code) => ({ value: code, label: code }))} onChange={(errorCode) => update({ errorCode })} />
        <Input.Search allowClear placeholder="Token contains…" onSearch={(search) => update({ search: search || undefined })} />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data.results}
        scroll={{ x: true }}
        onRow={(row) => ({ onClick: () => openDetail(row.id), style: { cursor: "pointer" } })}
        pagination={{ ...page, total: data.count, showSizeChanger: true, onChange: (current, pageSize) => setPage({ current, pageSize }) }}
        columns={[
          { title: "Token", dataIndex: "token", render: (t: string) => <Mono>{t}</Mono> },
          { title: "Outcome", dataIndex: "outcome", render: (o: string) => <StatusTag status={o} /> },
          { title: "Error", render: (_, r) => (r.errorCode ? <Mono>{r.errorCode}</Mono> : "—") },
          { title: "Attempt", dataIndex: "attempt" },
          { title: "At", dataIndex: "createdAt", render: (v: string) => <DateCell value={v} /> },
        ]}
      />
      <Modal open={detail !== null} title="Token result" footer={null} onCancel={() => setDetail(null)} width={720}>
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Token">
              <Mono copyable>{detail.token}</Mono>
            </Descriptions.Item>
            <Descriptions.Item label="Outcome">
              <StatusTag status={detail.outcome} />
            </Descriptions.Item>
            <Descriptions.Item label="FCM message id">
              <Mono>{detail.messageID}</Mono>
            </Descriptions.Item>
            <Descriptions.Item label="Error">{detail.errorCode ? `${detail.errorCategory} · ${detail.errorCode}` : "—"}</Descriptions.Item>
            <Descriptions.Item label="Message">{detail.errorMessage ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Attempt">{detail.attempt}</Descriptions.Item>
            <Descriptions.Item label="Recorded">{formatDate(detail.createdAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </>
  );
};

export const NotificationShow = () => {
  const { message } = App.useApp();
  const invalidate = useInvalidate();
  const { result: n, query } = useShow<Detail>({ resource: "notifications", queryOptions: { refetchInterval: 5000 } });
  const [busy, setBusy] = useState<string | null>(null);

  if (!n) return <Show isLoading={query.isLoading} />;

  const action = async (key: string, path: string, success: (data: any) => string) => {
    setBusy(key);
    try {
      const data = await api("POST", `/api/admin/notifications/${n.id}/${path}`);
      message.success(success(data));
      invalidate({ resource: "notifications", invalidates: ["detail", "list"], id: n.id });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Show
      isLoading={query.isLoading}
      title={<Mono>{n.id}</Mono>}
      headerButtons={
        <Space wrap>
          {!n.finishedAt && (
            <Popconfirm title="Cancel all pending jobs? Jobs already sending will finish." onConfirm={() => action("cancel", "cancel", (d) => `Canceled ${d.canceledTokens} tokens`)}>
              <Button danger icon={<StopOutlined />} loading={busy === "cancel"}>
                Cancel pending
              </Button>
            </Popconfirm>
          )}
          {n.failedCount > 0 && (
            <Popconfirm title={`Resend the ${n.failedCount} failed tokens? Invalid tokens are never retried.`} onConfirm={() => action("retry", "retry-failed", (d) => `Queued ${d.tokens} tokens in ${d.jobs} jobs`)}>
              <Button icon={<RedoOutlined />} loading={busy === "retry"}>
                Retry failed
              </Button>
            </Popconfirm>
          )}
          <Button icon={<DownloadOutlined />} href={`/api/admin/notifications/${n.id}/invalid-tokens.csv`} disabled={n.invalidCount === 0}>
            Invalid tokens CSV
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={4}><Statistic title="Status" valueRender={() => <StatusTag status={n.status} />} /></Col>
          <Col xs={12} md={4}><Statistic title="Unique tokens" value={n.uniqueTokens} suffix={<Typography.Text type="secondary" style={{ fontSize: 14 }}>of {n.totalTokens}</Typography.Text>} /></Col>
          <Col xs={12} md={4}><Statistic title="Delivered" value={n.successCount} valueStyle={{ color: "#52c41a" }} /></Col>
          <Col xs={12} md={4}><Statistic title="Invalid" value={n.invalidCount} valueStyle={{ color: "#fa8c16" }} /></Col>
          <Col xs={12} md={4}><Statistic title="Failed" value={n.failedCount} valueStyle={{ color: "#ff4d4f" }} /></Col>
          <Col xs={12} md={4}><Statistic title="Pending" value={n.pendingCount} /></Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card title="Timeline" size="small" style={{ height: "100%" }}>
              <Timeline
                items={[
                  { color: "gray", children: `Queued ${formatDate(n.createdAt)}` },
                  { color: n.startedAt ? "blue" : "gray", children: `Started ${formatDate(n.startedAt)}` },
                  { color: n.finishedAt ? "green" : "gray", children: `Finished ${formatDate(n.finishedAt)}` },
                ]}
              />
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Project">{n.Project.name}</Descriptions.Item>
                <Descriptions.Item label="externalId">{n.externalID ?? "—"}</Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
          <Col xs={24} md={16}>
            <Card title="Payload" size="small" style={{ height: "100%" }}>
              <pre style={{ margin: 0, maxHeight: 260, overflow: "auto", fontSize: 12 }}>{JSON.stringify(n.payload, null, 2)}</pre>
            </Card>
          </Col>
        </Row>

        <Card title="Errors by code" size="small">
          <Table
            rowKey={(row) => `${row.outcome}-${row.code}`}
            size="small"
            pagination={false}
            dataSource={n.errors}
            locale={{ emptyText: "No errors" }}
            columns={[
              { title: "Code", dataIndex: "code", render: (c: string) => <Mono>{c}</Mono> },
              { title: "Category", dataIndex: "category" },
              { title: "Outcome", dataIndex: "outcome", render: (o: string) => <StatusTag status={o} /> },
              { title: "Tokens", dataIndex: "count" },
            ]}
          />
        </Card>

        <Card title={`Jobs (${n.jobs.length})`} size="small">
          <Table
            rowKey="id"
            size="small"
            dataSource={n.jobs}
            scroll={{ x: true }}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            columns={[
              { title: "Chunk", dataIndex: "chunkIndex", render: (c: number, job) => (job.parentJobID ? `#${c} retry` : `#${c}`) },
              { title: "Tokens", dataIndex: "tokenCount" },
              { title: "Status", dataIndex: "status", render: (s: string) => <StatusTag status={s} /> },
              { title: "Attempts", render: (_, job) => `${job.attempts}/${job.maxAttempts}` },
              { title: "Next run", dataIndex: "runAfter", render: (v: string, job) => (job.status === "PENDING" ? <DateCell value={v} /> : "—") },
              {
                title: "Last error",
                render: (_, job) =>
                  job.lastErrorCode ? (
                    <Typography.Text type="danger" ellipsis={{ tooltip: job.lastErrorMessage }} style={{ maxWidth: 260 }}>
                      {job.lastErrorCode}
                    </Typography.Text>
                  ) : (
                    "—"
                  ),
              },
              { title: "Worker", dataIndex: "lockedBy", render: (w: string | null) => <Mono>{w}</Mono> },
              { title: "Duration", dataIndex: "durationMs", render: (d: number | null) => (d === null ? "—" : `${d} ms`) },
            ]}
          />
        </Card>

        <Card title="Token results" size="small">
          <TokenResults notificationID={n.id} errorCodes={n.errors.map((e) => e.code).filter((c): c is string => Boolean(c))} />
        </Card>

        {n.webhookDeliveries.length > 0 && (
          <Card title="Webhook deliveries" size="small">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={n.webhookDeliveries}
              columns={[
                { title: "Attempt", dataIndex: "attempt" },
                { title: "Status", dataIndex: "status", render: (s: string) => <StatusTag status={s} /> },
                { title: "HTTP", dataIndex: "statusCode", render: (c: number | null) => c ?? "—" },
                { title: "Response", dataIndex: "responseSnippet", render: (s: string | null) => <Typography.Text ellipsis={{ tooltip: s }} style={{ maxWidth: 360 }}>{s ?? "—"}</Typography.Text> },
                { title: "At", dataIndex: "createdAt", render: (v: string) => <DateCell value={v} /> },
              ]}
            />
          </Card>
        )}
      </Space>
    </Show>
  );
};
