
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.



import { AppShell, Burger, Button, Container, Group, Stack, Title, UnstyledButton } from "@mantine/core";
import { useDisclosure, useHeadroom } from '@mantine/hooks';

import { useApi } from '../api';
import { useNavigate } from 'react-router-dom';
import { showNotification } from '@mantine/notifications';

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
        localStorage.removeItem('fiabtoken');
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
    const [isSuperuser, setIsSuperuser] = useState(false);
  
    const checkLogin = () => {
        const token = localStorage.getItem('fiabtoken');
        if (!token) {
            setLoggedIn(false);
        } else {    
            setLoggedIn(true);
        }
        api.get('/v1/users/me')
        .then((res) => {
            if (res.status === 200) {
                setLoggedIn(true);
                setIsSuperuser(res.data.is_superuser);
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
            header={{ height: 80 }}
            navbar={{ width: 50, breakpoint: 'sm', collapsed: { desktop: true, mobile: !opened } }}
            footer={{ height: 50 }}
        >
            <AppShell.Header>
                <Container bg="#202036" fluid pt='md' pb='md'>
                <Group px="md">
                    <Group justify="space-between" style={{ flex: 1 }}>
                        <Group align="center" >
                            <a style={{"color":"white", "display":'inline'}} href="/"><img src='/logos/fiab.png' width='50vw'/></a>
                            <Title style={{"color":"white"}} order={2} textWrap={'pretty'}>Forecast In a Box</Title>
                        </Group>
                        <Banner />
                        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="white"/>
                        <Group ml="xl" gap={0} visibleFrom="sm">
                            {loggedIn ? (
                                <>
                                {loggedIn && isSuperuser && (
                                    <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/admin'>Admin</Button>
                                )} 
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
                <Burger opened={opened} onClick={toggle} hiddenFrom="md" size="sm" color="white"/>
                </Group>
                </Container>
            </AppShell.Navbar>
            
            <AppShell.Footer>
                <Footer /> 
            </AppShell.Footer>
            <AppShell.Main>
                {children}
            </AppShell.Main>
        </AppShell>
    );
    }