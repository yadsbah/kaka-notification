import { InboxOutlined, KeyOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { DeleteButton, EditButton, Show } from "@refinedev/antd";
import { useInvalidate, useShow } from "@refinedev/core";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useState } from "react";
import { Counts, DateCell, formatDate, Mono } from "../../components/format";
import { OneTimeSecret } from "../../components/OneTimeSecret";
import { StatusTag } from "../../components/status";
import { api } from "../../providers/api";
import type { AdminProject } from "./list";

type TestResult = { token: string; success: boolean; messageId?: string | null; category?: string; code?: string; message?: string };

export const ProjectShow = () => {
  const { message } = App.useApp();
  const invalidate = useInvalidate();
  const { result: project, query } = useShow<AdminProject>({ resource: "projects" });
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  const refresh = () => invalidate({ resource: "projects", invalidates: ["detail", "list"], id: project?.id });

  const run = async <T,>(key: string, action: () => Promise<T>) => {
    setBusy(key);
    try {
      return await action();
    } catch (error) {
      message.error((error as Error).message);
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  if (!project) return <Show isLoading={query.isLoading} />;
  const base = `/api/admin/projects/${project.id}`;

  const uploadCredential = async (file: File) => {
    const serviceAccount = await file.text();
    const updated = await run("upload", () => api("PUT", `${base}/credential`, { body: { serviceAccount } }));
    if (updated) {
      message.success("Service account saved and encrypted");
      refresh();
    }
    return false; // we already sent it; stop antd's own upload
  };

  const rotateKey = async () => {
    const response = await run("key", () => api<{ apiKey: string }>("POST", `${base}/api-key`));
    if (response) {
      setSecret({ title: "API key", value: response.apiKey });
      refresh();
    }
  };

  const rotateWebhookSecret = async () => {
    const response = await run("webhook", () => api<{ webhookSecret: string }>("POST", `${base}/webhook-secret`));
    if (response) setSecret({ title: "Webhook signing secret", value: response.webhookSecret });
  };

  const testSend = async (values: { tokens: string; title?: string; body?: string; dryRun: boolean }) => {
    const tokens = values.tokens.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
    const response = await run("test", () =>
      api<{ results: TestResult[]; credentialStatus: string }>("POST", `${base}/test-send`, {
        body: { tokens, title: values.title || undefined, body: values.body || undefined, dryRun: values.dryRun },
      })
    );
    if (response) {
      setTestResults(response.results);
      if (response.credentialStatus !== project.credentialStatus) refresh();
    }
  };

  return (
    <Show
      isLoading={query.isLoading}
      title={project.name}
      headerButtons={
        <Space wrap>
          <Button type="primary" icon={<SendOutlined />} href={`/notifications/create?projectID=${project.id}`} disabled={!project.enabled || project.credentialStatus === "MISSING"}>
            Send notification
          </Button>
          <EditButton recordItemId={project.id} />
          <DeleteButton
            recordItemId={project.id}
            confirmTitle="Delete this project with all its notifications, jobs and results?"
            confirmOkText="Delete everything"
          />
        </Space>
      }
    >
      <OneTimeSecret title={secret?.title ?? ""} secret={secret?.value ?? null} onClose={() => setSecret(null)} />
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {project.credentialStatus === "ERROR" && (
          <Alert
            type="error"
            showIcon
            message="Credential problem: sending is paused for this project"
            description={
              <>
                <Mono>{project.credentialError}</Mono>
                <br />
                Upload a working service account, or run a validate-only test send once the problem is fixed in Firebase. Pending jobs resume automatically.
              </>
            }
          />
        )}
        {project.credentialStatus === "MISSING" && (
          <Alert type="warning" showIcon message="Upload the Firebase service account JSON before sending." />
        )}

        <Descriptions bordered size="small" column={{ xs: 1, xl: 2 }}>
          <Descriptions.Item label="Status">
            <Tag color={project.enabled ? "green" : "default"}>{project.enabled ? "enabled" : "disabled"}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Credential">
            <StatusTag status={project.credentialStatus} />
          </Descriptions.Item>
          <Descriptions.Item label="Firebase project">
            <Mono>{project.firebaseProjectID}</Mono>
          </Descriptions.Item>
          <Descriptions.Item label="Service account">
            <Mono>{project.clientEmail}</Mono>
          </Descriptions.Item>
          <Descriptions.Item label="API key">
            {project.apiKeyPrefix ? (
              <Space direction="vertical" size={0}>
                <Mono>{project.apiKeyPrefix}</Mono>
                <Typography.Text type="secondary">created {formatDate(project.apiKeyCreatedAt)}</Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">none yet</Typography.Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Webhook">
            <Mono>{project.webhookUrl}</Mono>
          </Descriptions.Item>
          <Descriptions.Item label="Sent 24h (ok / invalid / failed)">
            <Counts {...project.last24h} />
          </Descriptions.Item>
          <Descriptions.Item label="Last error">
            {project.lastError ? (
              <Space direction="vertical" size={0}>
                <Typography.Text type="danger">{project.lastError}</Typography.Text>
                <DateCell value={project.lastErrorAt} />
              </Space>
            ) : (
              "—"
            )}
          </Descriptions.Item>
        </Descriptions>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="Service account" style={{ height: "100%" }}>
              <Upload.Dragger accept=".json,application/json" showUploadList={false} beforeUpload={uploadCredential} disabled={busy === "upload"}>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">{project.firebaseProjectID ? "Replace" : "Upload"} the service-account JSON</p>
                <p className="ant-upload-hint">
                  Firebase Console → Project settings → Service accounts → Generate new private key. Stored encrypted; never shown again.
                </p>
              </Upload.Dragger>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="Keys" style={{ height: "100%" }}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Popconfirm
                  title={project.apiKeyPrefix ? "Rotate the API key? The current key stops working immediately." : "Generate an API key?"}
                  onConfirm={rotateKey}
                >
                  <Button icon={<KeyOutlined />} loading={busy === "key"} block>
                    {project.apiKeyPrefix ? "Rotate API key" : "Generate API key"}
                  </Button>
                </Popconfirm>
                <Popconfirm title="Regenerate the webhook secret? Update your receiver right after." onConfirm={rotateWebhookSecret}>
                  <Button icon={<ReloadOutlined />} loading={busy === "webhook"} block>
                    Regenerate webhook secret
                  </Button>
                </Popconfirm>
                <Typography.Text type="secondary">
                  Send with <Typography.Text code>Authorization: Bearer &lt;key&gt;</Typography.Text> to{" "}
                  <Typography.Text code>POST /api/v1/notifications</Typography.Text>.
                </Typography.Text>
              </Space>
            </Card>
          </Col>
        </Row>

        <Card title="Test send">
          <Form layout="vertical" onFinish={testSend} initialValues={{ dryRun: true }} disabled={project.credentialStatus === "MISSING"}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item label="Device tokens (one per line)" name="tokens" rules={[{ required: true }]}>
                  <Input.TextArea rows={4} placeholder="fcm_token_1&#10;fcm_token_2" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="Title" name="title">
                  <Input placeholder="Test notification" />
                </Form.Item>
                <Form.Item label="Body" name="body">
                  <Input placeholder="Hello from Notification Manager" />
                </Form.Item>
              </Col>
            </Row>
            <Space wrap>
              <Form.Item name="dryRun" valuePropName="checked" noStyle>
                <Switch checkedChildren="validate only" unCheckedChildren="really send" />
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={busy === "test"}>
                Send
              </Button>
            </Space>
          </Form>
          {testResults && (
            <Table
              style={{ marginTop: 16 }}
              size="small"
              rowKey="token"
              pagination={false}
              scroll={{ x: true }}
              dataSource={testResults}
              columns={[
                { title: "Token", dataIndex: "token", render: (t: string) => <Mono>{t}</Mono> },
                { title: "Result", render: (_, r) => <StatusTag status={r.success ? "SUCCESS" : r.category === "INVALID_TOKEN" ? "INVALID" : "FAILED"} /> },
                { title: "Detail", render: (_, r) => (r.success ? <Mono>{r.messageId}</Mono> : `${r.code}: ${r.message}`) },
              ]}
            />
          )}
        </Card>
      </Space>
    </Show>
  );
};
