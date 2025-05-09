
import { MantineProvider } from '@mantine/core';
import { Router } from './Router';
import { theme } from '../theme';

import { Notifications } from '@mantine/notifications';
import {SettingsProvider} from './SettingsContext';

import './index.css';
import '@mantine/notifications/styles.css';
import '@mantine/core/styles.css';


export default function App() {
  return (
    <MantineProvider theme={theme}>
      <SettingsProvider>
      <Notifications/>
        <Router />
      </SettingsProvider>
    </MantineProvider>
  );
}