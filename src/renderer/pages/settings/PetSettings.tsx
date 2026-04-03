/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Radio, Switch } from '@arco-design/web-react';
import { systemSettings } from '@/common/adapter/ipcBridge';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import PreferenceRow from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/PreferenceRow';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '@/renderer/components/settings/SettingsModal/settingsViewContext';

const PetSettings: React.FC = () => {
  const [enabled, setEnabled] = useState(true);
  const [size, setSize] = useState(280);
  const [dnd, setDnd] = useState(false);
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  // Load initial values
  useEffect(() => {
    systemSettings.getPetEnabled
      .invoke()
      .then((val) => setEnabled(val))
      .catch(() => {});
  }, []);

  useEffect(() => {
    systemSettings.getPetSize
      .invoke()
      .then((val) => setSize(val))
      .catch(() => {});
  }, []);

  useEffect(() => {
    systemSettings.getPetDnd
      .invoke()
      .then((val) => setDnd(val))
      .catch(() => {});
  }, []);

  const handleEnabledChange = useCallback((checked: boolean) => {
    setEnabled(checked);
    systemSettings.setPetEnabled.invoke({ enabled: checked }).catch(() => {
      setEnabled(!checked);
    });
  }, []);

  const handleSizeChange = useCallback((val: number) => {
    setSize(val);
    systemSettings.setPetSize.invoke({ size: val }).catch(() => {
      // Revert on error
    });
  }, []);

  const handleDndChange = useCallback((checked: boolean) => {
    setDnd(checked);
    systemSettings.setPetDnd.invoke({ dnd: checked }).catch(() => {
      setDnd(!checked);
    });
  }, []);

  const preferenceItems = [
    {
      key: 'enabled',
      label: 'Enable Desktop Pet',
      component: <Switch checked={enabled} onChange={handleEnabledChange} />,
    },
    {
      key: 'size',
      label: 'Pet Size',
      component: (
        <Radio.Group value={size} onChange={handleSizeChange} disabled={!enabled}>
          <Radio value={200}>Small (200px)</Radio>
          <Radio value={280}>Medium (280px)</Radio>
          <Radio value={360}>Large (360px)</Radio>
        </Radio.Group>
      ),
    },
    {
      key: 'dnd',
      label: 'Do Not Disturb',
      description: 'Pet stays idle, ignores AI events',
      component: <Switch checked={dnd} onChange={handleDndChange} disabled={!enabled} />,
    },
  ];

  return (
    <SettingsPageWrapper>
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-12px'>
            <div className='w-full flex flex-col divide-y divide-border-2'>
              {preferenceItems.map((item) => (
                <PreferenceRow key={item.key} label={item.label} description={item.description}>
                  {item.component}
                </PreferenceRow>
              ))}
            </div>
          </div>
        </div>
      </AionScrollArea>
    </SettingsPageWrapper>
  );
};

export default PetSettings;
