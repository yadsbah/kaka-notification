import { List, useSelect, useTable } from "@refinedev/antd";
import { useInvalidate, useNavigation } from "@refinedev/core";
import { App, Button, Popconfirm, Select, Space, Table, Typography } from "antd";
import { DateCell, Mono } from "../../components/format";
import { StatusTag, statusOptions } from "../../components/status";
import { api } from "../../providers/api";

type AdminJob = {
  id: string;
  notificationID: string;
  Project: { id: string; name: string };
  parentJobID: string | null;
  chunkIndex: number;
  tokenCount: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedBy: string | null;
  lockedUntil: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
};

export const JobsList = () => {
  const { message } = App.useApp();
  const invalidate = useInvalidate();
  const { show } = useNavigation();
  const { tableProps, setFilters, filters } = useTable<AdminJob>({
    resource: "jobs",
    syncWithLocation: true,
    queryOptions: { refetchInterval: 5000 },
  });
  const { selectProps: projectSelect } = useSelect({ resource: "projects", optionLabel: "name", optionValue: "id", pagination: { mode: "off" } });
  const current = (field: string) => filters.find((f) => "field" in f && f.field === field)?.value;
  const setFilter = (field: string, value?: string) =>
    setFilters((prev) => [...prev.filter((f) => !("field" in f) || f.field !== field), { field, operator: "eq", value }]);

  const act = async (job: AdminJob, action: "requeue" | "fail") => {
    try {
      await api("POST", `/api/admin/jobs/${job.id}/${action}`, action === "fail" ? { body: {} } : {});
      message.success(action === "requeue" ? "Failed tokens requeued" : "Job marked as failed");
      invalidate({ resource: "jobs", invalidates: ["list"] });
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <List title="Jobs / Queue">
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Status"
          style={{ minWidth: 160 }}
          value={current("status")}
          options={statusOptions(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELED"])}
          onChange={(value) => setFilter("status", value)}
        />
        <Select {...projectSelect} allowClear placeholder="Project" style={{ minWidth: 180 }} value={current("projectID")} onChange={(value) => setFilter("projectID", value as unknown as string)} />
      </Space>
      <Table {...tableProps} rowKey="id" scroll={{ x: true }}>
        <Table.Column<AdminJob>
          title="Job"
          dataIndex="id"
          render={(id, job) => (
            <Space direction="vertical" size={0}>
              <Mono>{id}</Mono>
              <Typography.Link onClick={() => show("notifications", job.notificationID)} style={{ fontSize: 12 }}>
                {job.notificationID}
              </Typography.Link>
            </Space>
          )}
        />
        <Table.Column<AdminJob> title="Project" render={(_, job) => job.Project.name} />
        <Table.Column<AdminJob> title="Chunk" render={(_, job) => `#${job.chunkIndex}${job.parentJobID ? " retry" : ""} · ${job.tokenCount} tokens`} />
        <Table.Column<AdminJob> title="Status" dataIndex="status" render={(s) => <StatusTag status={s} />} />
        <Table.Column<AdminJob> title="Attempts" render={(_, job) => `${job.attempts}/${job.maxAttempts}`} />
        <Table.Column<AdminJob>
          title="Next run / lease"
          render={(_, job) =>
            job.status === "PENDING" ? <DateCell value={job.runAfter} /> : job.status === "PROCESSING" ? <>lease ends <DateCell value={job.lockedUntil} /></> : "—"
          }
        />
        <Table.Column<AdminJob>
          title="Last error"
          render={(_, job) =>
            job.lastErrorCode ? (
              <Typography.Text type="danger" ellipsis={{ tooltip: job.lastErrorMessage }} style={{ maxWidth: 240 }}>
                {job.lastErrorCode}
              </Typography.Text>
            ) : (
              "—"
            )
          }
        />
        <Table.Column<AdminJob> title="Worker" dataIndex="lockedBy" render={(w) => <Mono>{w}</Mono>} />
        <Table.Column<AdminJob>
          title=""
          render={(_, job) => (
            <Space>
              {job.status === "FAILED" && (
                <Popconfirm title="Resend this job's failed tokens?" onConfirm={() => act(job, "requeue")}>
                  <Button size="small">Requeue</Button>
                </Popconfirm>
              )}
              {(job.status === "PENDING" || job.status === "PROCESSING") && (
                <Popconfirm title="Mark this job failed? Its tokens are recorded as failed and can be retried later." onConfirm={() => act(job, "fail")}>
                  <Button size="small" danger>
                    Fail
                  </Button>
                </Popconfirm>
              )}
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
