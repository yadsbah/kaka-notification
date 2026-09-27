import { useCustom, useNavigation } from "@refinedev/core";
import { Alert, Badge, Card, Col, Empty, List as AntList, Row, Space, Statistic, Table, Typography } from "antd";
import { DateCell, Mono } from "../components/format";
import { StatusTag } from "../components/status";

type Overview = {
  queue: { pending: number; processing: number };
  last24h: { notifications: number; success: number; invalid: number; failed: number; pending: number };
  workers: { id: string; hostname: string; pid: number; alive: boolean; lastSeen: string; jobsProcessed: number; currentJobID: string | null }[];
  recentErrors: {
    id: string;
    notificationID: string;
    status: string;
    attempts: number;
    lastErrorCode: string;
    lastErrorMessage: string;
    updatedAt: string;
    Project: { id: string; name: string };
  }[];
  credentialProblems: { id: string; name: string; credentialError: string | null; lastErrorAt: string | null }[];
};

export const Overview = () => {
  const { show } = useNavigation();
  const { query } = useCustom<Overview>({
    url: "/api/admin/overview",
    method: "get",
    queryOptions: { refetchInterval: 5000 },
  });
  // Refine's `result.data` is a placeholder object while loading; the query data is undefined until real.
  const data = query.data?.data as Overview | undefined;
  const loading = query.isLoading;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Overview
      </Typography.Title>

      {data?.credentialProblems.map((project) => (
        <Alert
          key={project.id}
          type="error"
          showIcon
          message={`${project.name}: credential problem, sending is paused`}
          description={project.credentialError}
          action={<Typography.Link onClick={() => show("projects", project.id)}>Fix</Typography.Link>}
        />
      ))}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic title="Pending jobs" value={data?.queue.pending} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic title="Processing jobs" value={data?.queue.processing} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card loading={loading}>
            <Statistic title="Delivered (24h)" value={data?.last24h.success} valueStyle={{ color: "#52c41a" }} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card loading={loading}>
            <Statistic title="Invalid tokens (24h)" value={data?.last24h.invalid} valueStyle={{ color: "#fa8c16" }} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card loading={loading}>
            <Statistic title="Failed (24h)" value={data?.last24h.failed} valueStyle={{ color: "#ff4d4f" }} />
          </Card>
        </Col>
      </Row>

      <Card title="Workers" loading={loading}>
        {data?.workers.length ? (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            scroll={{ x: true }}
            dataSource={data.workers}
            columns={[
              {
                title: "Status",
                dataIndex: "alive",
                render: (alive: boolean) => <Badge status={alive ? "success" : "error"} text={alive ? "alive" : "dead"} />,
              },
              { title: "Worker", dataIndex: "id", render: (id: string) => <Mono>{id}</Mono> },
              { title: "Host", render: (_, w) => `${w.hostname} (pid ${w.pid})` },
              { title: "Last heartbeat", dataIndex: "lastSeen", render: (v: string) => <DateCell value={v} /> },
              { title: "Jobs processed", dataIndex: "jobsProcessed" },
              { title: "Current job", dataIndex: "currentJobID", render: (v: string | null) => <Mono>{v}</Mono> },
            ]}
          />
        ) : (
          <Empty description="No worker is running. Start one with WORKER_ENABLED=true or `bun run worker`." />
        )}
      </Card>

      <Card title="Recent errors" loading={loading}>
        {data?.recentErrors.length ? (
          <AntList
            dataSource={data.recentErrors}
            renderItem={(job) => (
              <AntList.Item
                actions={[<Typography.Link key="open" onClick={() => show("notifications", job.notificationID)}>Open</Typography.Link>]}
              >
                <AntList.Item.Meta
                  title={
                    <Space wrap>
                      <StatusTag status={job.status} />
                      <Typography.Text strong>{job.Project.name}</Typography.Text>
                      <Mono>{job.lastErrorCode}</Mono>
                      <DateCell value={job.updatedAt} />
                    </Space>
                  }
                  description={<Typography.Text type="secondary" ellipsis>{job.lastErrorMessage}</Typography.Text>}
                />
              </AntList.Item>
            )}
          />
        ) : (
          <Empty description="No recent errors" />
        )}
      </Card>
    </Space>
  );
};
