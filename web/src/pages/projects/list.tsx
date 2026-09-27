import { CreateButton, List, ShowButton, useTable } from "@refinedev/antd";
import { Input, Space, Table, Tag, Typography } from "antd";
import { Counts, DateCell } from "../../components/format";
import { StatusTag } from "../../components/status";

export type AdminProject = {
  id: string;
  name: string;
  enabled: boolean;
  firebaseProjectID: string | null;
  clientEmail: string | null;
  credentialStatus: "MISSING" | "OK" | "ERROR";
  credentialError: string | null;
  apiKeyPrefix: string | null;
  apiKeyCreatedAt: string | null;
  webhookUrl: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  last24h: { notifications: number; success: number; invalid: number; failed: number };
};

export const ProjectsList = () => {
  const { tableProps, setFilters } = useTable<AdminProject>({ resource: "projects", syncWithLocation: true });

  return (
    <List headerButtons={<CreateButton />}>
      <Input.Search
        placeholder="Search by name"
        allowClear
        style={{ maxWidth: 320, marginBottom: 16 }}
        onSearch={(value) => setFilters([{ field: "search", operator: "eq", value }], "replace")}
      />
      <Table {...tableProps} rowKey="id" scroll={{ x: true }}>
        <Table.Column<AdminProject>
          title="Name"
          dataIndex="name"
          render={(name, project) => (
            <Space direction="vertical" size={0}>
              <Typography.Text strong>{name}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {project.firebaseProjectID ?? "no service account"}
              </Typography.Text>
            </Space>
          )}
        />
        <Table.Column<AdminProject>
          title="Enabled"
          dataIndex="enabled"
          render={(enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "enabled" : "disabled"}</Tag>}
        />
        <Table.Column<AdminProject> title="Credential" dataIndex="credentialStatus" render={(status) => <StatusTag status={status} />} />
        <Table.Column<AdminProject>
          title="Sent 24h (ok / invalid / failed)"
          render={(_, project) => <Counts {...project.last24h} />}
        />
        <Table.Column<AdminProject>
          title="Last error"
          dataIndex="lastError"
          render={(error, project) =>
            error ? (
              <Space direction="vertical" size={0} style={{ maxWidth: 320 }}>
                <Typography.Text type="danger" ellipsis={{ tooltip: error }}>
                  {error}
                </Typography.Text>
                <DateCell value={project.lastErrorAt} />
              </Space>
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )
          }
        />
        <Table.Column<AdminProject> title="" render={(_, project) => <ShowButton hideText size="small" recordItemId={project.id} />} />
      </Table>
    </List>
  );
};
