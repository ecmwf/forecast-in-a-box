

import { AppShell, Burger, Button, Container, Group, rem, Space, Stack, Title, UnstyledButton } from "@mantine/core";
import { useDisclosure, useHeadroom } from '@mantine/hooks';

import { IconBox } from '@tabler/icons-react';

import { useApi } from '../api';
import { useNavigate } from 'react-router-dom';
import { showNotification } from '@mantine/notifications';

import Header from '../components/header';
import Footer from '../components/footer';
import Banner from '../components/Banner';
import { useEffect, useState } from "react";

export default function MainLayout({ children }: { children: React.ReactNode }) {
    const pinned = useHeadroom({ fixedAt: 120 });
    const [opened, { toggle }] = useDisclosure();
    
    const api = useApi();
    const navigate = useNavigate();
  
    const handleLogout = () => {
      api.post('/v1/auth/jwt/logout')
      .then(() => {
        localStorage.removeItem('token');
      })
      showNotification({
        id: `logout-success-${crypto.randomUUID()}`,
        position: 'top-right',
        autoClose: 3000,
        title: "Logout Successful",
        message: '',
        color: 'green',
        loading: false,
      });
      setLoggedIn(false);
      navigate('/')
    };
    const [loggedIn, setLoggedIn] = useState(false);
  
    const checkLogin = () => {
      api.get('/v1/users/me')
      .then((res) => {
        if (res.status === 200) {
        setLoggedIn(true);
        } else {
        setLoggedIn(false);
        }
      })
      .catch((err) => {
        setLoggedIn(false);
      });
    }
  
    useEffect(() => {
      checkLogin();
    }
    , []);

    return (
        <AppShell
            header={{ height: { base: 120 }}}
            navbar={{ width: 50, breakpoint: 'sm', collapsed: { desktop: true, mobile: !opened } }}
            footer={{ height: 60 }}
        >
            <AppShell.Header>
                <Banner />
                <Container bg="#202036" fluid w='100vw' pt='md' pb='md'>
                <Group h="100%" px="md">
                    <Group justify="space-between" style={{ flex: 1 }}>
                        <Group align="center" >
                            <a style={{"color":"white", "display":'inline'}} href="/"><img src='logos/fiab.png' width='50vw'/></a>
                            <Title style={{"color":"white"}} order={2} textWrap={'pretty'}>ECMWF Forecast In a Box</Title>
                        </Group>
                        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="white"/>
                        <Group ml="xl" gap={0} visibleFrom="sm">
                            {loggedIn ? (
                                <>
                                <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/settings'>Settings</Button>
                                <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/products'>Products</Button>
                                <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/job/status'>Job Status</Button>
                                <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" onClick={handleLogout}>Logout</Button>
                                </>
                            ) : (
                                <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/login'>Login</Button>
                            )}
                        </Group>
                    </Group>
                </Group>
                </Container>
            </AppShell.Header>
            <AppShell.Navbar>
                <Container bg="#202036" fluid w='100vw' pt='md' pb='md' h='100%' hiddenFrom="sm">
                    <Group justify="space-between" style={{ flex: 1 }} px="md" pt='md' align='top'>
                        <Stack>
                        {loggedIn ? (
                            <>
                            <UnstyledButton className="animated-button" size="md" c = 'white' component='a' href='/settings'>Settings</UnstyledButton>
                            <UnstyledButton className="animated-button" size="md" c = 'white' component='a' href='/products'>Products</UnstyledButton>
                            <UnstyledButton className="animated-button" size="md" c = 'white' component='a' href='/job/status'>Job Status</UnstyledButton>
                            <UnstyledButton className="animated-button" size="md" c = 'white' onClick={handleLogout}>Logout</UnstyledButton>
                            </>
                        ) : (
                            <UnstyledButton className="animated-button" size="md" c = 'white' component='a' href='/login'>Login</UnstyledButton>
                        )}
                        </Stack>
                <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="white"/>
                </Group>
                </Container>
            </AppShell.Navbar>
            
            <AppShell.Footer>
                <Footer /> 
            </AppShell.Footer>
            <AppShell.Main pt={`calc(${rem(120)} + var(--mantine-spacing-md))`}>
                <Space h='xl'/>
                {children}
            </AppShell.Main>
        </AppShell>
    );
    }