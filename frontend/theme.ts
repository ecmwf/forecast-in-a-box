"use client";

import {
  createTheme,
  DEFAULT_THEME,
  Title,
} from '@mantine/core';

import './NebulaSans/NebulaSans.css';

export const theme = createTheme({
  colors: {},
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