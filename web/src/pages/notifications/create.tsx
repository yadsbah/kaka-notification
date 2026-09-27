import { DeleteOutlined, PlusOutlined, SendOutlined } from "@ant-design/icons";
import { Create, useForm, useSelect } from "@refinedev/antd";
import { Alert, Button, Card, Col, Collapse, Form, Input, InputNumber, Row, Select, Space, Typography } from "antd";
import { useSearchParams } from "react-router";

type FormValues = {
  projectID: string;
  tokens: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  dataPairs?: { key?: string; value?: string }[];
  priority?: "high" | "normal";
  ttlSeconds?: number;
  collapseKey?: string;
  channelId?: string;
  sound?: string;
  badge?: number;
  link?: string;
  externalId?: string;
};

const splitTokens = (text = "") => text.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);

// Drops empty strings/undefined and objects left with no keys, so the strict API schema only sees what was filled in.
const compact = <T extends Record<string, unknown>>(value: T) => {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

const toPayload = (values: FormValues) => {
  const data = Object.fromEntries(
    (values.dataPairs ?? []).filter((pair) => pair?.key).map((pair) => [pair.key!.trim(), pair.value ?? ""])
  );
  return compact({
    projectID: values.projectID,
    tokens: splitTokens(values.tokens),
    notification: compact({ title: values.title, body: values.body, imageUrl: values.imageUrl }),
    data: Object.keys(data).length ? data : undefined,
    android: compact({ priority: values.priority, ttlSeconds: values.ttlSeconds, collapseKey: values.collapseKey, channelId: values.channelId }),
    apns: compact({ sound: values.sound, badge: values.badge }),
    webpush: compact({ link: values.link }),
    externalId: values.externalId,
  });
};

export const NotificationCreate = () => {
  const [params] = useSearchParams();
  const { formProps, saveButtonProps, form } = useForm<{ id: string }, any, FormValues>({
    resource: "notifications",
    action: "create",
    redirect: "show",
    successNotification: (data) => ({
      type: "success",
      message: "Queued",
      description: `${(data?.data as { uniqueTokens?: number })?.uniqueTokens ?? ""} tokens queued; the worker is sending them now.`,
    }),
  });
  const { selectProps: projectSelect } = useSelect({
    resource: "projects",
    optionLabel: "name",
    optionValue: "id",
    pagination: { mode: "off" },
  });

  const tokensText = Form.useWatch("tokens", form);
  const tokens = splitTokens(tokensText);
  const unique = new Set(tokens).size;

  return (
    <Create
      title="Send notification"
      saveButtonProps={{ ...saveButtonProps, icon: <SendOutlined />, children: "Queue notification" }}
    >
      <Form
        {...formProps}
        layout="vertical"
        initialValues={{ projectID: params.get("projectID") ?? undefined, dataPairs: [] }}
        onFinish={(values) => formProps.onFinish?.(toPayload(values as FormValues) as any)}
      >
        <Row gutter={[16, 0]}>
          <Col xs={24} lg={12}>
            <Card title="Who" size="small" style={{ marginBottom: 16 }}>
              <Form.Item label="Project" name="projectID" rules={[{ required: true, message: "Pick the project to send as" }]}>
                <Select {...projectSelect} placeholder="Project" showSearch />
              </Form.Item>
              <Form.Item
                label="Device tokens"
                name="tokens"
                rules={[{ required: true, message: "Paste at least one token" }]}
                extra={
                  tokens.length > 0
                    ? `${tokens.length} tokens, ${unique} unique${tokens.length !== unique ? " (duplicates are sent once)" : ""}`
                    : "One per line (commas or spaces also work)."
                }
              >
                <Input.TextArea rows={8} placeholder={"fcm_token_1\nfcm_token_2"} style={{ fontFamily: "monospace", fontSize: 12 }} />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title="Message" size="small" style={{ marginBottom: 16 }}>
              <Form.Item label="Title" name="title">
                <Input placeholder="New order" maxLength={1024} />
              </Form.Item>
              <Form.Item label="Body" name="body">
                <Input.TextArea rows={2} placeholder="Order #123 received" maxLength={4096} />
              </Form.Item>
              <Form.Item label="Image URL" name="imageUrl" rules={[{ pattern: /^https:\/\//, message: "Must be an https URL" }]}>
                <Input placeholder="https://example.com/image.png" />
              </Form.Item>

              <Typography.Text strong>Data</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                Key/value pairs delivered to the app. Values are always strings.
              </Typography.Paragraph>
              <Form.List name="dataPairs">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((field) => (
                      <Space key={field.key} align="baseline" style={{ display: "flex" }}>
                        <Form.Item name={[field.name, "key"]} rules={[{ required: true, message: "Key" }]}>
                          <Input placeholder="orderId" />
                        </Form.Item>
                        <Form.Item name={[field.name, "value"]}>
                          <Input placeholder="123" />
                        </Form.Item>
                        <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label="Remove" />
                      </Space>
                    ))}
                    <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} block>
                      Add data field
                    </Button>
                  </>
                )}
              </Form.List>
            </Card>
          </Col>
        </Row>

        <Collapse
          style={{ marginBottom: 16 }}
          items={[
            {
              key: "advanced",
              label: "Platform options and reference",
              children: (
                <Row gutter={16}>
                  <Col xs={24} md={8}>
                    <Typography.Title level={5}>Android</Typography.Title>
                    <Form.Item label="Priority" name="priority">
                      <Select allowClear placeholder="default" options={[{ value: "high" }, { value: "normal" }]} />
                    </Form.Item>
                    <Form.Item label="TTL (seconds)" name="ttlSeconds">
                      <InputNumber min={0} max={2_419_200} style={{ width: "100%" }} placeholder="up to 2419200 (28 days)" />
                    </Form.Item>
                    <Form.Item label="Collapse key" name="collapseKey">
                      <Input />
                    </Form.Item>
                    <Form.Item label="Channel id" name="channelId">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Typography.Title level={5}>iOS (APNs)</Typography.Title>
                    <Form.Item label="Sound" name="sound">
                      <Input placeholder="default" />
                    </Form.Item>
                    <Form.Item label="Badge" name="badge">
                      <InputNumber min={0} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Typography.Title level={5}>Web push</Typography.Title>
                    <Form.Item label="Click link" name="link" rules={[{ pattern: /^https:\/\//, message: "Must be an https URL" }]}>
                      <Input placeholder="https://example.com/orders/123" />
                    </Form.Item>
                    <Typography.Title level={5}>Tracking</Typography.Title>
                    <Form.Item label="External id" name="externalId" extra="Your own reference; searchable in the notifications list.">
                      <Input placeholder="campaign-2026-09" />
                    </Form.Item>
                  </Col>
                </Row>
              ),
            },
          ]}
        />

        <Alert
          type="info"
          showIcon
          message="This is a real send. It goes through the queue like an API request; results, retries and invalid tokens show up on the notification's page. Use Test send on a project page for a validate-only dry run."
        />
      </Form>
    </Create>
  );
};
