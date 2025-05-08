"use client";

import React, { useEffect } from 'react';
import { Container, Space, Image, Button, Group, Title} from '@mantine/core';

import { IconBox } from '@tabler/icons-react';

import { useApi } from '../api';
import { useNavigate } from 'react-router-dom';
import { showNotification } from '@mantine/notifications';


const Header = () => {
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
  const [loggedIn, setLoggedIn] = React.useState(false);

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
    <Container bg="#202036" fluid w='100vw'>
      <Space h="md" />
        <Group justify="space-between">
          <Group>
            <a style={{"color":"white", "display":'inline'}} href="/"><IconBox/></a>
            <Title style={{"color":"white"}} order={1} textWrap={'pretty'}>ECMWF Forecast In a Box</Title>
          </Group>
          <Group gap='sm' grow preventGrowOverflow={false}>
          {/* <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/'>Home</Button> */}

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
      <Space h="md" />
    </Container>
  )
}

export default Header;