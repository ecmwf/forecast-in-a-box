
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.


import { MantineProvider } from '@mantine/core';
import { Router } from './Router';
import { theme } from '../theme';

import { Notifications } from '@mantine/notifications';
import {SettingsProvider} from './SettingsContext';

import './index.css';
import '@mantine/notifications/styles.css';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';

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