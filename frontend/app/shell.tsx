

import { AppShell } from "@mantine/core";

import Header from './header';
import Footer from './footer';


export function Shell({ children }: { children: React.ReactNode }) {
    return (
        <AppShell
            padding=""
            header={{ height: 60 }}
            footer={{ height: 60 }}
        >
            <AppShell.Header>
                <Header />
            </AppShell.Header>
            <AppShell.Footer>
                <Footer /> 
            </AppShell.Footer>
            <AppShell.Main>{children}</AppShell.Main>
        </AppShell>
    );
    }