
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { Container, TextInput, PasswordInput, Button, Paper, Text, Title, Alert} from '@mantine/core'
import { useState } from 'react'

import { useApi } from '../api'
import { showNotification } from '@mantine/notifications'
import { useNavigate} from 'react-router-dom'

import MainLayout from '../layouts/MainLayout';
import { useEffect } from 'react'
import { IconInfoCircle } from '@tabler/icons-react';

export default function Login() {
  const params = new URLSearchParams(location.search)
  const redirectUrl = params.get('q') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const api = useApi()
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/v1/users/me')
      .then((res) => {
        if (res.status === 200) {
          // User is logged in, redirect to the specified URL
          navigate(redirectUrl)
          showNotification({
            id: `login-success-${crypto.randomUUID()}`,
            position: 'top-right',
            autoClose: 3000,
            title: "Login Successful",
            message: '',
            color: 'green',
            loading: false,
          });
        } else {
          // User is not logged in, do nothing
        }
      })
      .catch(() => {
        // Handle error if needed, do nothing

      });
  }, [api, navigate, redirectUrl]);

  const handleLogin = async () => {
    try {
      const formData = new URLSearchParams()
      formData.append('username', email)
      formData.append('password', password)

      const response = await api.post('/v1/auth/jwt/login', formData)

      localStorage.setItem('fiabtoken', response.data.access_token)
      navigate(redirectUrl)
    } catch (err) {
        showNotification({
            id: `login-error-form-${crypto.randomUUID()}`,
            position: 'top-right',
            autoClose: 3000,
            title: "Login Failed",
            message: '',
            color: 'red',
            loading: false,
          });
      setError('Login failed. Please check your credentials.')
    }

  }
  const handleSSO = async () => {
    try {
      const response = await api.get('/v1/auth/oidc/authorize')
      if (response.data && response.data.authorization_url) {
        window.location.href = response.data.authorization_url;
      } else {
        showNotification({
          id: `sso-error-${crypto.randomUUID()}`,
          position: 'top-right',
          autoClose: 3000,
          title: "SSO Failed",
          message: 'Could not initiate SSO login.',
          color: 'red',
          loading: false,
        });
      }
    } catch (err) {
      showNotification({
        id: `sso-error-${crypto.randomUUID()}`,
        position: 'top-right',
        autoClose: 3000,
        title: "SSO Failed",
        message: 'Could not initiate SSO login.',
        color: 'red',
        loading: false,
      });
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('fiabtoken')

    if (token) {
      navigate(redirectUrl)
    }
  }, [navigate, redirectUrl])

  return (
    <MainLayout>
      <Container size={420} my={40}>
        <Title style={{ textAlign: 'center' }} mb="lg">Login</Title>
        <Paper withBorder shadow="md" p={30} radius="md">
          <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required />
          <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required mt="md" />
          <Text ta="center" mt="md" size="sm">
            {/* Don&apos;t have an account? <Link to="/signup">Sign up</Link> */}
          </Text>
            <Button fullWidth mt="xl" onClick={handleLogin}>Login</Button>
          <Button fullWidth mt="sm" variant="outline" onClick={handleSSO}>Login with ECMWF</Button>
        </Paper>
        <Alert variant="filled" color="red" title="Restricted Access" icon={<IconInfoCircle />} >
            As this is still an early prototype, access is restricted to authorised users only.
        </Alert>
      </Container>
      </MainLayout>
  )
}
