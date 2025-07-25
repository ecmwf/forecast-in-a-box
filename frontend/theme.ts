
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import {
  createTheme,
  DEFAULT_THEME,
  Title,
} from '@mantine/core';

import './NebulaSans/NebulaSans.css';

export const theme = createTheme({
  // colors: {},
  components: {
    Title: Title.extend({
      defaultProps: {
        style: {color: "#424270"},
      },
    }),
  },
  fontFamily: 'NebulaSans, sans-serif',
  fontFamilyMonospace: 'Monaco, Courier, monospace',
  headings: {
    fontFamily: `NebulaSans, ${DEFAULT_THEME.fontFamily}`,
  },
});
