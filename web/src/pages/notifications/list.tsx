import { CreateButton, List, ShowButton, useSelect, useTable } from "@refinedev/antd";
import type { CrudFilters } from "@refinedev/core";
import { Button, DatePicker, Form, Input, Select, Space, Table, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { DateCell, Mono } from "../../components/format";
import { StatusTag, statusOptions } from "../../components/status";

export type AdminNotification = {
  id: string;
  projectID: string;
  Project: { id: string; name: string };
  status: string;
  externalID: string | null;
  totalTokens: number;
  uniqueTokens: number;
  successCount: number;
  invalidCount: number;
  failedCount: number;
  pendingCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type Search = { projectID?: string; status?: string; externalID?: string; range?: [Dayjs, Dayjs] };

export const NOTIFICATION_STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "PARTIALLY_FAILED", "FAILED", "CANCELED"];

export const NotificationsList = () => {
  const { tableProps, searchFormProps } = useTable<AdminNotification, any, Search>({
    resource: "notifications",
    syncWithLocation: true,
    queryOptions: { refetchInterval: 5000 },
    onSearch: (values): CrudFilters => [
      { field: "projectID", operator: "eq", value: values.projectID },
      { field: "status", operator: "eq", value: values.status },
      { field: "externalID", operator: "eq", value: values.externalID?.trim() },
      { field: "createdFrom", operator: "eq", value: values.range?.[0]?.startOf("day").toISOString() },
      { field: "createdTo", operator: "eq", value: values.range?.[1]?.endOf("day").toISOString() },
    ],
  });
  const { selectProps: projectSelect } = useSelect({
    resource: "projects",
    optionLabel: "name",
    optionValue: "id",
    pagination: { mode: "off" },
  });

  return (
    <List headerButtons={<CreateButton>Send notification</CreateButton>}>
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16, rowGap: 8 }}>
        <Form.Item name="projectID">
          <Select {...projectSelect} allowClear placeholder="Project" style={{ minWidth: 180 }} />
        </Form.Item>
        <Form.Item name="status">
          <Select allowClear placeholder="Status" options={statusOptions(NOTIFICATION_STATUSES)} style={{ minWidth: 160 }} />
        </Form.Item>
        <Form.Item name="range">
          <DatePicker.RangePicker />
        </Form.Item>
        <Form.Item name="externalID">
          <Input placeholder="externalId" allowClear />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          Filter
        </Button>
      </Form>
      <Table {...tableProps} rowKey="id" scroll={{ x: true }}>
        <Table.Column<AdminNotification>
          title="Notification"
          dataIndex="id"
          render={(id, n) => (
            <Space direction="vertical" size={0}>
              <Mono>{id}</Mono>
              {n.externalID && <Typography.Text type="secondary">ext: {n.externalID}</Typography.Text>}
            </Space>
          )}
        />
        <Table.Column<AdminNotification> title="Project" render={(_, n) => n.Project.name} />
        <Table.Column<AdminNotification> title="Status" dataIndex="status" render={(status) => <StatusTag status={status} />} />
        <Table.Column<AdminNotification>
          title="Tokens"
          render={(_, n) => (
            <Space size={4} wrap style={{ whiteSpace: "nowrap" }}>
              <Typography.Text>{n.uniqueTokens}</Typography.Text>
              <Typography.Text type="secondary">→</Typography.Text>
              <Typography.Text type="success">{n.successCount} ok</Typography.Text>
              <Typography.Text style={{ color: "#fa8c16" }}>{n.invalidCount} invalid</Typography.Text>
              <Typography.Text type="danger">{n.failedCount} failed</Typography.Text>
              {n.pendingCount > 0 && <Typography.Text type="secondary">{n.pendingCount} pending</Typography.Text>}
            </Space>
          )}
        />
        <Table.Column<AdminNotification> title="Created" dataIndex="createdAt" render={(v) => <DateCell value={v} />} />
        <Table.Column<AdminNotification> title="" render={(_, n) => <ShowButton hideText size="small" recordItemId={n.id} />} />
      </Table>
    </List>
  );
};
