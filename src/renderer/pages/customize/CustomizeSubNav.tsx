/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Left sub-navigation panel for Customize page.
 * Shows "Skills" and "Tools" tab options.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Left, Lightning, Toolkit } from '@icon-park/react';
import classNames from 'classnames';
import styles from './customize.module.css';

type CustomizeTab = 'skills' | 'tools';

interface CustomizeSubNavProps {
  activeTab: CustomizeTab;
}

const CustomizeSubNav: React.FC<CustomizeSubNavProps> = ({ activeTab }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const tabs: Array<{ id: CustomizeTab; label: string; icon: React.ReactElement }> = [
    {
      id: 'skills',
      label: t('customize.skills', { defaultValue: 'Skills' }),
      icon: <Lightning theme='outline' size='18' />,
    },
    {
      id: 'tools',
      label: t('customize.tools', { defaultValue: 'Connectors' }),
      icon: <Toolkit theme='outline' size='18' />,
    },
  ];

  const handleBack = () => {
    void navigate('/guid');
  };

  const handleTabClick = (tab: CustomizeTab) => {
    void navigate(`/customize/${tab}`, { replace: true });
  };

  return (
    <div className={styles.subNav}>
      {/* Header with back button */}
      <div className={styles.subNavHeader}>
        <div className={styles.subNavBackBtn} onClick={handleBack} role='button' tabIndex={0}>
          <Left theme='outline' size='18' />
        </div>
        <span>{t('customize.pageTitle', { defaultValue: 'Customize' })}</span>
      </div>

      {/* Tab items */}
      <div className='flex flex-col gap-2px'>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={classNames(styles.subNavItem, activeTab === tab.id && styles.subNavItemActive)}
            onClick={() => handleTabClick(tab.id)}
          >
            <span className={styles.subNavItemIcon}>{tab.icon}</span>
            <span>{tab.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomizeSubNav;
