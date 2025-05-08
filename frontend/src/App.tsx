import '@mantine/core/styles.css';

import { MantineProvider } from '@mantine/core';
import { Router } from './Router';
import { theme } from '../theme';

import { Notifications } from '@mantine/notifications';
import {SettingsProvider} from './SettingsContext';

// import './index.css';

export default function App() {
  return (
    <MantineProvider theme={theme}>
      <Notifications/>
      <SettingsProvider>
        <Router />
      </SettingsProvider>
    </MantineProvider>
  );
}