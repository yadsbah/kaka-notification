import { CreateButton, DeleteButton, List, useModalForm, useTable } from "@refinedev/antd";
import { useGetIdentity } from "@refinedev/core";
import { App, Button, Form, Input, Modal, Space, Table, Tag } from "antd";
import { useState } from "react";
import { DateCell } from "../../components/format";
import { api } from "../../providers/api";

type Admin = { id: number; email: string; lastLoginAt: string | null; lockedUntil: string | null; createdAt: string };

const passwordRules = [{ required: true }, { min: 10, message: "At least 10 characters" }];

export const AdminsList = () => {
  const { message } = App.useApp();
  const { data: me } = useGetIdentity<{ id: number }>();
  const { tableProps } = useTable<Admin>({ resource: "admins" });
  const { modalProps, formProps, show } = useModalForm<Admin>({ resource: "admins", action: "create" });
  const [passwordFor, setPasswordFor] = useState<Admin | null>(null);
  const [passwordForm] = Form.useForm<{ password: string }>();

  const changePassword = async ({ password }: { password: string }) => {
    try {
      await api("PATCH", `/api/admin/admins/${passwordFor!.id}/password`, { body: { password } });
      message.success(passwordFor!.id === me?.id ? "Password changed; other sessions signed out" : "Password changed; they've been signed out");
      setPasswordFor(null);
      passwordForm.resetFields();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <List title="Admins" headerButtons={<CreateButton onClick={() => show()}>Add admin</CreateButton>}>
      <Table {...tableProps} rowKey="id" scroll={{ x: true }}>
        <Table.Column<Admin>
          title="Email"
          dataIndex="email"
          render={(email, admin) => (
            <Space>
              {email}
              {admin.id === me?.id && <Tag color="blue">you</Tag>}
              {admin.lockedUntil && new Date(admin.lockedUntil) > new Date() && <Tag color="red">locked</Tag>}
            </Space>
          )}
        />
        <Table.Column<Admin> title="Last login" dataIndex="lastLoginAt" render={(v) => <DateCell value={v} />} />
        <Table.Column<Admin> title="Added" dataIndex="createdAt" render={(v) => <DateCell value={v} />} />
        <Table.Column<Admin>
          title=""
          render={(_, admin) => (
            <Space>
              <Button size="small" onClick={() => setPasswordFor(admin)}>
                Change password
              </Button>
              {admin.id !== me?.id && <DeleteButton size="small" hideText resource="admins" recordItemId={admin.id} confirmTitle={`Remove ${admin.email}?`} />}
            </Space>
          )}
        />
      </Table>

      <Modal {...modalProps} title="Add admin">
        <Form {...formProps} layout="vertical">
          <Form.Item label="Email" name="email" rules={[{ required: true, type: "email" }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={passwordRules}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={passwordFor !== null} title={`Change password for ${passwordFor?.email}`} onCancel={() => setPasswordFor(null)} onOk={() => passwordForm.submit()} destroyOnClose>
        <Form form={passwordForm} layout="vertical" onFinish={changePassword}>
          <Form.Item label="New password" name="password" rules={passwordRules}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </List>
  );
};
