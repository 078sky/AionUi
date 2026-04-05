import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import { Alert, Button, Space, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

type AcpConnectionBannerProps = {
  agentName?: string;
  backend: string;
  retrying?: boolean;
  onRetry: () => void;
};

const AcpConnectionBanner: React.FC<AcpConnectionBannerProps> = ({ agentName, backend, retrying = false, onRetry }) => {
  const { t } = useTranslation();

  const displayName =
    agentName ||
    ACP_BACKENDS_ALL[backend as keyof typeof ACP_BACKENDS_ALL]?.name ||
    backend.charAt(0).toUpperCase() + backend.slice(1);

  return (
    <Alert
      type='error'
      closable={false}
      data-testid='acp-disconnected-banner'
      title={t('acp.status.disconnected', { agent: displayName })}
      content={
        <Space direction='vertical' size='small' style={{ width: '100%' }}>
          <Text>{t('acp.connection.disconnectedHint', { agent: displayName })}</Text>
          <Space>
            <Button type='primary' size='mini' loading={retrying} onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </Space>
        </Space>
      }
      style={{ marginBottom: 12 }}
    />
  );
};

export default AcpConnectionBanner;
