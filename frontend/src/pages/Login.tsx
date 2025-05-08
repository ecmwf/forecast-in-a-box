"use client";

import { Container, TextInput, PasswordInput, Button, Paper, Text, Title } from '@mantine/core'
import { useState } from 'react'

import { useApi } from '../api'
import { showNotification } from '@mantine/notifications'
import { useNavigate, Link } from 'react-router-dom'

import MainLayout from '../layouts/MainLayout';


export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const api = useApi()
  const navigate = useNavigate()

  const handleLogin = async () => {
    try {
      const formData = new URLSearchParams()
      formData.append('username', email)
      formData.append('password', password)

      const response = await api.post('/v1/auth/jwt/login', formData)

      localStorage.setItem('token', response.data.access_token)
      navigate('/')
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
  }

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
      </Container>
      </MainLayout>
  )
}