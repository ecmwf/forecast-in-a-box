"use client";

import { createTheme, Title } from "@mantine/core";

export const theme = createTheme({
  colors: {},
  components: {
    Title: Title.extend({
      defaultProps: {
        style: {color: "#424270"},
      },
    }),
  },
  fontFamily: "Varela Round, Open Sans, sans-serif",
});