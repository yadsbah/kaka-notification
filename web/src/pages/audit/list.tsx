import { List, useTable } from "@refinedev/antd";
import { Input, Table, Typography } from "antd";
import { formatDate, Mono } from "../../components/format";

type AuditLog = {
  id: number;
  action: string;
  targetType: string | null;
  targetID: string | null;
  details: unknown;
  createdAt: string;
  Admin: { id: number; email: string } | null;
};

export const AuditList = () => {
  const { tableProps, setFilters } = useTable<AuditLog>({ resource: "audit", syncWithLocation: true });

  return (
    <List title="Audit log">
      <Input.Search
        allowClear
        placeholder="Filter by target id (prj_…, ntf_…, job_…)"
        style={{ maxWidth: 420, marginBottom: 16 }}
        onSearch={(value) => setFilters([{ field: "targetID", operator: "eq", value: value.trim() }], "replace")}
      />
      <Table {...tableProps} rowKey="id" scroll={{ x: true }}>
        <Table.Column<AuditLog> title="When" dataIndex="createdAt" render={(v) => formatDate(v)} />
        <Table.Column<AuditLog> title="Admin" render={(_, log) => log.Admin?.email ?? <Typography.Text type="secondary">deleted admin</Typography.Text>} />
        <Table.Column<AuditLog> title="Action" dataIndex="action" render={(a) => <Typography.Text code>{a}</Typography.Text>} />
        <Table.Column<AuditLog> title="Target" render={(_, log) => (log.targetID ? <Mono>{log.targetID}</Mono> : "—")} />
        <Table.Column<AuditLog>
          title="Details"
          dataIndex="details"
          render={(details) => (details ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{JSON.stringify(details)}</Typography.Text> : "—")}
        />
      </Table>
    </List>
  );
};
