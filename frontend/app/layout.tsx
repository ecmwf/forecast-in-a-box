import "@mantine/core/styles.css";
import React from "react";
import {
  MantineProvider,
  ColorSchemeScript,
  mantineHtmlProps,
  AppShell,
} from "@mantine/core";

import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';

import { theme } from "../theme";

import Header from './header';
import Footer from './footer';

import './global.css';


export const metadata = {
  title: "Forecast in a Box",
  description: "Pain",
};

export default function RootLayout({ children }: { children: any }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
        <link rel="shortcut icon" href="/favicon.svg" />
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
        />
          <style>
        </style>
      </head>
      <body>
      <MantineProvider theme={theme}>
       <Notifications />
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <Header />
          <main style={{ flex: 1 }}>{children}</main>
          <Footer />
        </div>
      </MantineProvider>
      </body>
    </html>
  );
}
