import { Alert, Modal, Typography } from "antd";

// Shown right after a key/secret is created or rotated. The server never returns it again.
export const OneTimeSecret = ({ title, secret, onClose }: { title: string; secret: string | null; onClose: () => void }) => (
  <Modal open={secret !== null} title={title} onOk={onClose} onCancel={onClose} okText="I've stored it" cancelButtonProps={{ style: { display: "none" } }} maskClosable={false}>
    <Alert type="warning" showIcon message="Copy it now. It won't be shown again." style={{ marginBottom: 16 }} />
    <Typography.Paragraph code copyable={{ text: secret ?? "" }} style={{ wordBreak: "break-all" }}>
      {secret}
    </Typography.Paragraph>
  </Modal>
);
