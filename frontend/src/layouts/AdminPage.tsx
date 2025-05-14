
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import { AppShell, Container, Burger,  Badge, NavLink, Image, Group, Affix, Skeleton, Grid, rem, Card, Title, Divider, Space} from '@mantine/core'

import { IconSettings, IconGalaxy } from '@tabler/icons-react';

import MainLayout from './MainLayout';
import { useEffect } from 'react';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';

import { useApi } from '../api';
import { showNotification } from '@mantine/notifications';

import classes from './Navbar.module.css';

const data = [
  { link: '/admin/settings', label: 'Settings', icon: IconSettings },
  { link: '/admin/gateway', label: 'Gateway', icon: IconGalaxy },
];

export function NavbarSimple() {

  const location = useLocation();

  const links = data.map((item) => (
    <NavLink
      className={classes.link}
      active={item.link === location.pathname}
      href={item.link}
      key={item.label}
      label={item.label}
      leftSection={<item.icon className={classes.linkIcon} size={16} stroke={1.5} />}
    >
    </NavLink>
  ));

  return (
    <nav className={classes.navbar}>
      <div className={classes.navbarMain}>
        <Group className={classes.header} justify="space-between">
          <Title order={3} className={classes.title}>
            Admin Panel
        </Title>
        </Group>
        {links}
      </div>

      {/* <div className={classes.footer}>
        <a href="#" className={classes.link} onClick={(event) => event.preventDefault()}>
          <IconSwitchHorizontal className={classes.linkIcon} stroke={1.5} />
          <span>Change account</span>
        </a>

        <a href="#" className={classes.link} onClick={(event) => event.preventDefault()}>
          <IconLogout className={classes.linkIcon} stroke={1.5} />
          <span>Logout</span>
        </a>
      </div> */}
    </nav>
  );
}


export default function AdminLayout({ children }: { children: React.ReactNode }) {

    const token = localStorage.getItem('token')
    const navigate = useNavigate();
    const api = useApi();

    useEffect(() => {
        if (!token) {
            navigate('/login');
        }
    }, [token, navigate]);

    useEffect(() => {
        api.get('/v1/users/me')
        .then((res) => {
            if (res.status === 200 && res.data.is_superuser) {
                // User is logged in and is a superuser
            } else {
                navigate('/login');
            }
        })
        .catch(() => {
            showNotification({
                id: 'login-error',
                title: 'Error',
                message: 'Failed to fetch user data',
                color: 'red',
                autoClose: 3000,
                loading: false,
            });
            navigate('/login');
        });
    }, [api, navigate]);

    return (
      <MainLayout>
            <Grid>
            <Grid.Col span={{ xxs: 12, xs: 6, sm: 5, md: 4, lg: 3 }}>
                <Affix position={{ top: `calc(${rem(80)} + var(--mantine-spacing-md))`}}>
                    <NavbarSimple/>
                </Affix>
            </Grid.Col>
            <Grid.Col span={{ xxs: 4, xs: 6, sm: 7, md: 8,  }}>
                {children || <Outlet />}
            </Grid.Col>
            </Grid>
      </MainLayout>
  );
}
