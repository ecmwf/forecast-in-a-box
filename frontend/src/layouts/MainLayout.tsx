

import { AppShell, Space } from "@mantine/core";

import Header from '../components/header';
import Footer from '../components/footer';
import Banner from '../components/Banner';

export default function MainLayout({ children }: { children: React.ReactNode }) {
    return (
        <AppShell
            header={{ height: 140 }}
            footer={{ height: 60 }}
        >
            <AppShell.Header>
                <Banner />
                <Header />
            </AppShell.Header>
            <AppShell.Footer>
                <Footer /> 
            </AppShell.Footer>
            <AppShell.Main>
                <Space h="md" />
                {children}
            </AppShell.Main>
        </AppShell>
    );
    }