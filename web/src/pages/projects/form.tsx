import { Create, Edit, useForm } from "@refinedev/antd";
import { Form, Input, Switch } from "antd";
import type { AdminProject } from "./list";

const ProjectFields = () => (
  <>
    <Form.Item label="Name" name="name" rules={[{ required: true, max: 100 }]}>
      <Input placeholder="Orders App" />
    </Form.Item>
    <Form.Item
      label="Webhook URL"
      name="webhookUrl"
      extra="Optional. Receives a signed summary when each notification finishes. Must be https."
      rules={[{ type: "url", pattern: /^https:\/\//, message: "Must be an https URL" }]}
      normalize={(value: string) => (value === "" ? null : value)}
    >
      <Input placeholder="https://api.example.com/hooks/notifications" />
    </Form.Item>
    <Form.Item label="Enabled" name="enabled" valuePropName="checked" initialValue={true}>
      <Switch />
    </Form.Item>
  </>
);

export const ProjectCreate = () => {
  // After creating, go to the project page to upload the service account and generate the API key.
  const { formProps, saveButtonProps } = useForm<AdminProject>({ resource: "projects", redirect: "show" });
  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical" style={{ maxWidth: 560 }}>
        <ProjectFields />
      </Form>
    </Create>
  );
};

export const ProjectEdit = () => {
  const { formProps, saveButtonProps } = useForm<AdminProject>({ resource: "projects", redirect: "show" });
  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical" style={{ maxWidth: 560 }}>
        <ProjectFields />
      </Form>
    </Edit>
  );
};
